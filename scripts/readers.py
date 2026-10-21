#!/usr/bin/env python3
"""
WorldPulse readers: how many people read world-pulse.io each day, and where
they came from (plan G1, Oct 11, 2026). Run by scripts/ops-status.sh, which
puts the result in /ops-status.json for the autopilot and the HQ.

Nothing that identifies anyone is kept or published. Each run reads the
lines nginx logged since the last run (`docker logs --timestamps wp_nginx`)
and counts page views of world-pulse.io (not the API, scripts, pictures or
Next.js's background requests), leaving out bots. A visitor is a hash of a
random daily key plus their address and browser; the key and the hashes are
thrown away when the day ends (UTC), leaving only the day's totals. Like
Plausible's counting: no cookies, no addresses stored.

Many bots call themselves a browser. A visitor only counts once their browser
also ran the page: it called the API (api.world-pulse.io), as every page's
top bar does as soon as it loads (TopNav asks for /signals/count and
/signals/headlines). Page views from browser names that never did are
reported as "unconfirmed". Until Oct 20, 2026 loading the site's scripts
(/_next/static/) counted too, and that day 917 "people" were counted: 910
"direct", one page each, 492 of them in one hour, reading the same kinds of
pages as the bots (entity and sign-in pages) — most likely a crawler calling
itself a browser that downloads a page's files without running them.
Browsers that loaded the scripts but never called the API are now reported
as "scripts_only", and that day's count is shown as not known (LOOSE_DAYS;
the server's log of that morning is gone, so it can't be counted again). The people counted are also summed by browser and system
("Chrome 129 · Windows") and by the part of the site they read, so the next
look can tell readers from a farm of look-alike browsers (counts only).
Requests for things only attackers look for (/wp-login.php, /.env…) never
count.

Views per visitor (plan G18, Oct 20, 2026): the day's page views, overall
and by the channel that brought each visitor ("channel_views" and
"channel_views_per_visitor"), so the report can say whether readers from X,
search or a post read a second story. Counts only.

A visitor's channel is where their first page view of the day came from:
the link's utm_source if it has one (our posts and Share buttons add it),
else the website that sent them (x.com, linkedin.com, google…), else
"direct". Our own addresses never count as a website that sent people
(Oct 18, 2026): world-pulse.io, world-pulse.app (same server) and bare IP
addresses, such as the server's own when the site is opened by its
number. Bots are counted apart: search engines, AI assistants, and the
link-preview fetchers of X, LinkedIn, Telegram and others (a proxy for
shares). Since Oct 18, 2026 (Devon: "We're getting a lot of visits by bots,
break this down for me") each bot is also named, from the name it gives
itself in its user agent (AhrefsBot, python-requests, HeadlessChrome…), with
the parts of the site bots read ("bots", "bot_pages"). Bots only: nothing
about people changes.

For HQ's cause-and-effect timeline and morning summary (Oct 11, 2026): the
hour (UTC) each visitor arrived, by channel, for today and yesterday
("hourly"), and which post or email brought them ("posts"): links in HQ's
ready-to-post drafts and the email briefing carry utm_campaign (hq,
briefing, weekly) and utm_content (the story's first 8 characters).

Usage: readers.py <state file>   (prints one JSON object)
"""

import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

HISTORY_DAYS = 30
CONTAINER = os.environ.get('READERS_CONTAINER', 'wp_nginx')
SITE_HOST = 'world-pulse.io'
SITE_HOSTS = (SITE_HOST, 'www.' + SITE_HOST)
API_HOST = 'api.' + SITE_HOST
OWN_SITES = (SITE_HOST, 'world-pulse.app')   # world-pulse.app points at the same server
IP_ADDRESS = re.compile(r'^\d{1,3}(?:\.\d{1,3}){3}$|^[0-9a-f]*:[0-9a-f:.]*$')
STATE_VERSION = 3
# Days counted before the API rule whose count a crawler clearly inflated: shown as not known (the
# server's log no longer covers the day, so it can't be counted again); the old number is kept apart
LOOSE_DAYS = ('2026-10-20',)
LOOSE_NOTE = ('not known: a crawler that called itself a browser was counted as people '
              '(fixed the evening of Oct 20, 2026; the old count is visitors_loose)')

# docker logs --timestamps: "<RFC3339Nano> <nginx line>"; nginx's "main" format
LINE = re.compile(
    r'^(?P<ts>\S+) (?P<ip>\S+) - \S+ \[[^\]]+\] "(?P<method>[A-Z]+) (?P<target>\S+) [^"]*" (?P<status>\d{3}) \S+ '
    r'"(?P<ref>[^"]*)" "(?P<ua>[^"]*)"(?P<rest>.*)$')
HOST = re.compile(r'\bhost=(\S+)')

# Not page views: the API, Next.js assets and data requests, files, health checks
NOT_PAGE = re.compile(
    r'^/(?:api|_next|ws|uploads|health|ops-status\.json|socket\.io|\.well-known|embed|fonts|icons|images|static)(?:/|$|\?)'
    r'|^/[^?]*\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|json|xml|txt|webmanifest)(?:\?|$)'
    r'|/(?:opengraph|twitter)-image(?:\?|$)')
# Paths only scanners ask for (they get the profile page, a 200, so they would count)
PROBE = re.compile(
    r'(?:^|/)(?:wp-|wordpress|xmlrpc|cgi-bin|phpmyadmin|pma\b|vendor/|boaform|hnap1|owa/|autodiscover|actuator|solr|geoserver|cdn-cgi|\.[a-z])'
    r'|\.(?:php\d?|aspx?|jsp|cgi|env|git|sql|bak|old|zip|tar|gz|rar|7z|ini|ya?ml|conf|log|sh|pl|py|rb)(?:[?/]|$)', re.I)

CRAWLERS = [
    ('google', re.compile(r'googlebot|google-inspectiontool|googleother|adsbot-google|storebot-google|google-extended', re.I)),
    ('bing', re.compile(r'bingbot|bingpreview|msnbot', re.I)),
    ('ai', re.compile(r'gptbot|oai-searchbot|chatgpt-user|claudebot|claude-user|claude-searchbot|anthropic-ai|perplexitybot|perplexity-user'
                      r'|ccbot|bytespider|amazonbot|applebot|youbot|cohere-ai|meta-externalagent|duckassistbot|mistralai', re.I)),
    ('social', re.compile(r'twitterbot|facebookexternalhit|facebookcatalog|linkedinbot|telegrambot|whatsapp|slackbot|discordbot'
                          r'|bluesky|cardyb|redditbot|pinterest|skypeuripreview|mastodon|embedly|iframely|vkshare', re.I)),
]
OTHER_BOT = re.compile(
    r'bot\b|bot/|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|python|curl|wget|go-http|java/|okhttp|axios|node-fetch'
    r'|httpclient|libwww|scrapy|monitor|uptime|pingdom|statuscake|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baiduspider'
    r'|seznam|sogou|censys|zgrab|masscan|nmap|nuclei|expanse|undici|^node|^-?$', re.I)

# A bot's name: the word it calls itself ("AhrefsBot/7.0" -> AhrefsBot), else the tool it was made
# with (python-requests, curl, HeadlessChrome…), else what follows "compatible;", else its first word
BOT_TOKEN = re.compile(r'([A-Za-z][\w.\-]*?(?:bot|crawler|spider|slurp))(?=[\s/;)+,(]|$)', re.I)
BOT_TOOLS = ('HeadlessChrome', 'Chrome-Lighthouse', 'Lighthouse', 'PageSpeed', 'python-requests', 'python-httpx', 'aiohttp',
             'Python-urllib', 'curl', 'Wget', 'Go-http-client', 'okhttp', 'axios', 'node-fetch', 'undici', 'libwww-perl',
             'Scrapy', 'UptimeRobot', 'Pingdom', 'StatusCake', 'facebookexternalhit', 'WhatsApp', 'Bluesky', 'Cardyb',
             'Embedly', 'Iframely', 'Censys', 'zgrab', 'masscan', 'Nmap', 'Nuclei', 'Expanse', 'ChatGPT-User', 'OAI-SearchBot',
             'Claude-User', 'Claude-SearchBot', 'Perplexity-User', 'meta-externalagent', 'DuckAssistBot',
             'Google-InspectionTool', 'GoogleOther', 'Google-Extended', 'BingPreview', 'Java')
COMPATIBLE = re.compile(r'compatible;\s*([A-Za-z][\w.\-]*)', re.I)
FIRST_WORD = re.compile(r'^([A-Za-z][\w.\-]*)')
MAX_BOT_NAMES = 60       # a day's distinct names kept; the rest are counted as "(other names)"
MAX_BOT_SECTIONS = 30
SECTION = re.compile(r'^/([a-z][a-z-]{0,23})(?:/|$)')

CHANNEL_SITES = [
    ('x', re.compile(r'(^|\.)(t\.co|x\.com|twitter\.com)$')),
    ('linkedin', re.compile(r'(^|\.)(linkedin\.com|lnkd\.in)$')),
    ('google', re.compile(r'(^|\.)google\.[a-z.]+$')),
    ('bing', re.compile(r'(^|\.)bing\.com$')),
    ('duckduckgo', re.compile(r'(^|\.)duckduckgo\.com$')),
    ('reddit', re.compile(r'(^|\.)reddit\.com$')),
    ('hacker news', re.compile(r'(^|\.)news\.ycombinator\.com$')),
    ('telegram', re.compile(r'(^|\.)(t\.me|telegram\.org|telegram\.me)$')),
    ('bluesky', re.compile(r'(^|\.)bsky\.app$')),
    ('facebook', re.compile(r'(^|\.)(facebook\.com|fb\.com|fb\.me)$')),
    ('whatsapp', re.compile(r'(^|\.)whatsapp\.com$')),
    ('ai assistants', re.compile(r'(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$')),
]


def ts_key(ts):
    """A docker timestamp that sorts as text: Go trims the fraction's zeros ("05.5Z"), so pad it to 9 digits"""
    m = re.match(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z$', ts)
    return f"{m.group(1)}.{(m.group(2) or '').ljust(9, '0')[:9]}Z" if m else ts


def page_kind(path):
    if path == '/':
        return 'home'
    if path == '/map' or path.startswith('/map/'):
        return 'map'
    if path.startswith('/signals/'):
        return 'story'
    if path in ('/briefing', '/briefings'):
        return 'briefing'
    return 'other'


def crawler_kind(ua):
    for name, pattern in CRAWLERS:
        if pattern.search(ua):
            return name
    return 'other' if OTHER_BOT.search(ua.strip()) else None


def bot_name(ua):
    """A short name for a bot from its user agent (bots only)"""
    ua = ua.strip()
    if not ua or ua == '-':
        return '(no name)'
    m = BOT_TOKEN.search(ua)
    if m:
        return m.group(1)[:40]
    low = ua.lower()
    for tool in BOT_TOOLS:
        if tool.lower() in low:
            return tool
    m = COMPATIBLE.search(ua)
    if m:
        return m.group(1)[:40]
    m = FIRST_WORD.match(ua)
    if m and m.group(1).lower() != 'mozilla':
        return m.group(1)[:40]
    kw = OTHER_BOT.search(ua)
    return 'browser-like: ' + kw.group(0).lower() if kw else '(other names)'


def bot_section(path):
    """Which part of the site a bot read: the page kinds people get, plus the site's sections"""
    kind = page_kind(path)
    if kind != 'other':
        return kind
    m = SECTION.match(path.lower())
    return m.group(1) if m else 'other'


def note_bot(day, ua, kind, path):
    """Counts one bot page view by name and by the part of the site it read"""
    names = day.setdefault('bots', {})
    name = bot_name(ua)
    key = name.lower()
    if key not in names and len(names) >= MAX_BOT_NAMES:
        name, key = '(other names)', '(other names)'
    entry = names.setdefault(key, [name, kind, 0])
    entry[2] += 1
    pages = day.setdefault('bot_pages', {})
    section = bot_section(path)
    if section not in pages and len(pages) >= MAX_BOT_SECTIONS:
        section = 'other'
    add(pages, section)


def top_bots(day, top=15):
    """[{"name", "kind", "n"}], the most active first"""
    rows = [{'name': v[0], 'kind': v[1], 'n': v[2]} for v in (day.get('bots') or {}).values()
            if isinstance(v, list) and len(v) == 3]
    return sorted(rows, key=lambda r: -r['n'])[:top]


def agent_family(ua):
    """'Chrome 129 · Windows': a browser's name, its major version and the system (people only; no address
    and not the full string, so it says which browsers read the site without telling anyone apart)"""
    u = ua or ''
    browser = 'other'
    for name, pattern in (('Edge', r'Edg(?:e|A|iOS)?/(\d+)'), ('Opera', r'OPR/(\d+)'), ('Samsung', r'SamsungBrowser/(\d+)'),
                          ('Firefox', r'(?:Firefox|FxiOS)/(\d+)'), ('Chrome', r'(?:Chrome|CriOS)/(\d+)'),
                          ('Safari', r'Version/(\d+)[\d.]*(?: Mobile/\S+)? Safari/')):
        m = re.search(pattern, u)
        if m:
            browser = f'{name} {m.group(1)}'
            break
    for name, pattern in (('iPhone', r'iPhone'), ('iPad', r'iPad'), ('Android', r'Android'), ('Windows', r'Windows NT'),
                          ('Mac', r'Mac OS X'), ('ChromeOS', r'CrOS'), ('Linux', r'Linux')):
        if re.search(pattern, u):
            return f'{browser} · {name}'
    return browser


def own_site(host):
    """One of our own addresses (world-pulse.io, world-pulse.app or a subdomain of either), or a bare IP
    address (the server's own, when someone opened the site by its number): not a website that sent people"""
    host = (host or '').lower()
    if host.startswith('www.'):
        host = host[4:]
    return not host or bool(IP_ADDRESS.match(host)) or any(host == s or host.endswith('.' + s) for s in OWN_SITES)


def channel(query, ref):
    """Where a visit came from: utm_source first, then the sending website"""
    src = (parse_qs(query).get('utm_source') or [''])[0].strip().lower()
    if src:
        return re.sub(r'[^a-z0-9 _-]', '', src)[:24] or 'other'
    if not ref or ref == '-':
        return 'direct'
    host = (urlsplit(ref).hostname or '').lower()
    if host.startswith('www.'):
        host = host[4:]
    if own_site(host):
        return 'direct'   # came back from one of our own pages
    for name, pattern in CHANNEL_SITES:
        if pattern.search(host):
            return name
    return 'other sites'


def post_key(query):
    """'hq:83b746ee' for a link from an HQ post draft or an email briefing, else None"""
    q = parse_qs(query)
    campaign = (q.get('utm_campaign') or [''])[0].strip().lower()
    content = (q.get('utm_content') or [''])[0].strip().lower()
    if campaign not in ('hq', 'briefing', 'weekly') or not re.fullmatch(r'[0-9a-f]{8}', content):
        return None
    return f'{campaign}:{content}'


def ref_site(ref):
    host = (urlsplit(ref).hostname or '').lower()
    return (host[4:] if host.startswith('www.') else host)[:60]


def empty_day(day):
    # visitors: hash -> {"c": channel, "s": sending website, "js": ran the page, "p": {page kind: views}}
    return {'day': day, 'salt': secrets.token_hex(16), 'visitors': {}, 'crawlers': {}, 'bots': {}, 'bot_pages': {},
            'bots_since': f'{day}T00:00:00Z'}


def add(counts, key, n=1):
    counts[key] = counts.get(key, 0) + n


def by_count(counts, top=None):
    return dict(sorted(counts.items(), key=lambda kv: -kv[1])[:top])


def per_visitor(views, people):
    """Page views per visitor, to two decimals (0 when nobody came)"""
    return round(views / people, 2) if people else 0


def summary(d):
    """The day's totals, counting only visitors whose browser ran the page"""
    channels, pages, sites, views, people, unconfirmed, scripts_only = {}, {}, {}, 0, 0, 0, 0
    hours, posts, agents, sections = {}, {}, {}, {}
    # Page views by the channel that brought each visitor (plan G18 (3), Oct 20, 2026):
    # whether readers who came from X, search or a post read a second story
    channel_views = {}
    for v in d['visitors'].values():
        if not isinstance(v, dict) or not v.get('p'):
            continue
        if not v.get('js'):
            # never called the API: never ran the page (loading the scripts alone isn't enough, Oct 20, 2026)
            if v.get('st'):
                scripts_only += 1
            else:
                unconfirmed += 1
            continue
        people += 1
        add(agents, v.get('a') or 'other')
        for section, n in (v.get('q') or {}).items():
            add(sections, section, n)
        ch, site = v.get('c') or 'direct', v.get('s')
        if site and own_site(site):
            ch, site = 'direct', None   # counted as a website before own_site (Oct 18)
        add(channels, ch)
        if site:
            add(sites, site)
        if v.get('h'):
            add(hours.setdefault(v['h'], {}), ch)
        if v.get('k'):
            add(posts, v['k'])
        for kind, n in v['p'].items():
            add(pages, kind, n)
            add(channel_views, ch, n)
            views += n
    return {'day': d['day'], 'visitors': people, 'views': views, 'channels': by_count(channels),
            'channel_views': by_count(channel_views),
            'views_per_visitor': per_visitor(views, people),
            'channel_views_per_visitor': {ch: per_visitor(channel_views.get(ch, 0), n) for ch, n in by_count(channels).items()},
            'sites': by_count(sites, 8), 'pages': by_count(pages), 'crawlers': by_count(d['crawlers']),
            'bots': top_bots(d), 'bot_pages': by_count(d.get('bot_pages') or {}, 12), 'bots_since': d.get('bots_since'),
            'unconfirmed': unconfirmed, 'scripts_only': scripts_only, 'rule': 'api',
            'people_agents': by_count(agents, 8), 'people_sections': by_count(sections, 12),
            'hours': dict(sorted(hours.items())), 'posts': by_count(posts, 20)}


def hourly(*days):
    """[{"t": "2026-10-11T19", "n": {channel: people}}] for the given day summaries, oldest first"""
    out = []
    for d in days:
        if isinstance(d, dict) and isinstance(d.get('hours'), dict):
            out += [{'t': f"{d['day']}T{h}", 'n': n} for h, n in sorted(d['hours'].items())]
    return out


def load(path, now):
    try:
        with open(path, encoding='utf-8') as fh:
            st = json.load(fh)
        if isinstance(st.get('today'), dict) and isinstance(st.get('history'), list):
            if st.get('v') != STATE_VERSION:
                # Counted the old way (v1: no check that the page ran; v2: loading the scripts counted):
                # count today again from midnight UTC, and show the inflated days as not known
                st.update(v=STATE_VERSION, today=empty_day(now.strftime('%Y-%m-%d')), since=now.strftime('%Y-%m-%dT00:00:00.000000000Z'))
                mark_loose_days(st['history'])
            return st
    except (OSError, ValueError):
        pass
    return {'v': STATE_VERSION, 'since': (now - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
            'today': empty_day(now.strftime('%Y-%m-%d')), 'history': []}


def mark_loose_days(history):
    """LOOSE_DAYS' counts become not known (None), the old ones kept as visitors_loose and views_loose"""
    for h in history:
        if isinstance(h, dict) and h.get('day') in LOOSE_DAYS and 'visitors_loose' not in h:
            h['visitors_loose'], h['views_loose'] = h.get('visitors'), h.get('views')
            h.update(visitors=None, views=None, views_per_visitor=None, channel_views=None,
                     channel_views_per_visitor=None, hours={}, note=LOOSE_NOTE)


def request_of(m):
    """(host, path, query, whether it is a page view of the site) for a parsed log line"""
    h = HOST.search(m['rest'])
    host = h.group(1).lower() if h else None   # lines from before nginx logged the host have none
    parts = urlsplit(m['target'])
    path, query = parts.path or '/', parts.query
    page = (m['method'] == 'GET' and m['status'] in ('200', '304') and (host is None or host in SITE_HOSTS)
            and not NOT_PAGE.search(m['target']) and not PROBE.search(path) and '_rsc=' not in query)
    return host, path, query, page


def backfill_bots(st, read_log):
    """
    Names the bots of the lines earlier runs already counted today, once, when
    the state comes from before bots had names. read_log(since, until) returns
    the log's lines or None. If the log can't be read, names start from now.
    """
    today = st['today']
    if 'bots' in today:
        return
    today['bots'], today['bot_pages'] = {}, {}
    until = st.get('since') or ''
    today['bots_since'] = until or None
    if not until.startswith(today['day']):
        return
    lines = read_log(f"{today['day']}T00:00:00Z", until)
    if lines is None:
        return
    limit = ts_key(until)
    for raw in lines:
        m = LINE.match(raw.rstrip('\n'))
        if not m or m['ts'][:10] != today['day'] or ts_key(m['ts']) > limit:
            continue
        _, path, _, page = request_of(m)
        bot = crawler_kind(m['ua'])
        if bot and page:
            note_bot(today, m['ua'], bot, path)
    today['bots_since'] = f"{today['day']}T00:00:00Z"


def docker_log(since, until=None, timeout=60):
    """The nginx container's log lines since a time (and before one), or None if it can't be read"""
    cmd = ['docker', 'logs', '--timestamps', '--since', since] + (['--until', until] if until else []) + [CONTAINER]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, errors='replace', timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    lines = (proc.stdout + proc.stderr).splitlines()
    lines.sort(key=lambda l: ts_key(l.split(' ', 1)[0]))   # stdout and stderr interleave
    return lines


def count(st, lines):
    """
    Adds log lines (oldest first) to the state and returns the newest
    timestamp seen. `docker logs --since` repeats the line at that time, so
    lines up to the last run's newest are skipped.
    """
    last = ts_key(st.get('since') or '')
    newest = None
    for raw in lines:
        m = LINE.match(raw.rstrip('\n'))
        if not m:
            continue
        ts = m['ts']
        if ts_key(ts) <= last:
            continue
        newest = ts
        day = ts[:10]
        today = st['today']
        if day > today['day']:
            st['history'] = (st['history'] + [summary(today)])[-HISTORY_DAYS:]
            today = st['today'] = empty_day(day)
        elif day < today['day']:
            continue   # an older line (clock or ordering): ignore
        host, path, query, page = request_of(m)
        ua = m['ua']
        bot = crawler_kind(ua)
        if bot:
            if page:
                add(today['crawlers'], bot)
                note_bot(today, ua, bot, path)
            continue
        who = hashlib.sha256(f"{today['salt']}|{m['ip']}|{ua}".encode()).hexdigest()[:16]
        # The browser ran the page: its top bar called the API as the page loaded
        if host == API_HOST or (host is None and path.startswith('/api/')):
            today['visitors'].setdefault(who, {'p': {}})['js'] = True
            continue
        # It only downloaded the site's scripts: not proof that it ran them (Oct 20, 2026)
        if path.startswith('/_next/static/'):
            today['visitors'].setdefault(who, {'p': {}})['st'] = True
            continue
        if not page:
            continue
        v = today['visitors'].setdefault(who, {'p': {}})
        if 'c' not in v:
            v['c'] = channel(query, m['ref'])
            if v['c'] == 'other sites':
                v['s'] = ref_site(m['ref'])
            v['h'] = ts[11:13]   # the hour (UTC) they arrived
            k = post_key(query)
            if k:
                v['k'] = k
            v['a'] = agent_family(ua)
        add(v['p'], page_kind(path))
        add(v.setdefault('q', {}), bot_section(path))
    return newest


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    now = datetime.now(timezone.utc)
    st = load(path, now)
    if st['today']['day'] < now.strftime('%Y-%m-%d'):
        st['history'] = (st['history'] + [summary(st['today'])])[-HISTORY_DAYS:]
        st['today'] = empty_day(now.strftime('%Y-%m-%d'))
    since = st.get('since') or (now - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    backfill_bots(st, lambda a, b: docker_log(a, b, timeout=25))
    lines = docker_log(since)
    ok = lines is not None
    newest = count(st, lines or [])
    if newest:
        st['since'] = newest
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(st, fh, separators=(',', ':'))
    os.replace(tmp, path)
    out = summary(st['today'])
    yesterday = st['history'][-1] if st['history'] else None
    out['hourly'] = hourly(yesterday, out)
    del out['hours']
    out['updated'] = now.isoformat(timespec='seconds')
    out['log_read'] = ok
    out['history'] = [{k: h.get(k) for k in ('day', 'visitors', 'views', 'channels', 'channel_views', 'views_per_visitor', 'posts', 'crawlers',
                                             'unconfirmed', 'scripts_only', 'rule', 'note', 'visitors_loose')} for h in st['history'][-14:]]
    print(json.dumps(out, separators=(',', ':')))


if __name__ == '__main__':
    main()
