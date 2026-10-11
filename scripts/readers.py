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
also ran the page: it loaded the site's scripts (/_next/static/) or called
the API (api.world-pulse.io), as every page does and almost no bot does.
Page views from browser names that never did are reported as "unconfirmed".
Requests for things only attackers look for (/wp-login.php, /.env…) never
count.

A visitor's channel is where their first page view of the day came from:
the link's utm_source if it has one (our posts and Share buttons add it),
else the website that sent them (x.com, linkedin.com, google…), else
"direct". Bots are counted apart: search engines, AI assistants, and the
link-preview fetchers of X, LinkedIn, Telegram and others (a proxy for
shares).

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
STATE_VERSION = 2

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
    if not host or host == SITE_HOST or host.endswith('.' + SITE_HOST):
        return 'direct'   # came back from one of our own pages
    for name, pattern in CHANNEL_SITES:
        if pattern.search(host):
            return name
    return 'other sites'


def ref_site(ref):
    host = (urlsplit(ref).hostname or '').lower()
    return (host[4:] if host.startswith('www.') else host)[:60]


def empty_day(day):
    # visitors: hash -> {"c": channel, "s": sending website, "js": ran the page, "p": {page kind: views}}
    return {'day': day, 'salt': secrets.token_hex(16), 'visitors': {}, 'crawlers': {}}


def add(counts, key, n=1):
    counts[key] = counts.get(key, 0) + n


def by_count(counts, top=None):
    return dict(sorted(counts.items(), key=lambda kv: -kv[1])[:top])


def summary(d):
    """The day's totals, counting only visitors whose browser ran the page"""
    channels, pages, sites, views, people, unconfirmed = {}, {}, {}, 0, 0, 0
    for v in d['visitors'].values():
        if not isinstance(v, dict) or not v.get('p'):
            continue
        if not v.get('js'):
            unconfirmed += 1
            continue
        people += 1
        add(channels, v.get('c') or 'direct')
        if v.get('s'):
            add(sites, v['s'])
        for kind, n in v['p'].items():
            add(pages, kind, n)
            views += n
    return {'day': d['day'], 'visitors': people, 'views': views, 'channels': by_count(channels),
            'sites': by_count(sites, 8), 'pages': by_count(pages), 'crawlers': by_count(d['crawlers']),
            'unconfirmed': unconfirmed}


def load(path, now):
    try:
        with open(path, encoding='utf-8') as fh:
            st = json.load(fh)
        if isinstance(st.get('today'), dict) and isinstance(st.get('history'), list):
            if st.get('v') != STATE_VERSION:
                # Counted the old way (no check that the page ran): count today again from midnight UTC
                st.update(v=STATE_VERSION, today=empty_day(now.strftime('%Y-%m-%d')), since=now.strftime('%Y-%m-%dT00:00:00.000000000Z'))
            return st
    except (OSError, ValueError):
        pass
    return {'v': STATE_VERSION, 'since': (now - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
            'today': empty_day(now.strftime('%Y-%m-%d')), 'history': []}


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
        h = HOST.search(m['rest'])
        host = h.group(1).lower() if h else None   # lines from before nginx logged the host have none
        parts = urlsplit(m['target'])
        path, query = parts.path or '/', parts.query
        ua = m['ua']
        page = (m['method'] == 'GET' and m['status'] in ('200', '304') and (host is None or host in SITE_HOSTS)
                and not NOT_PAGE.search(m['target']) and not PROBE.search(path) and '_rsc=' not in query)
        bot = crawler_kind(ua)
        if bot:
            if page:
                add(today['crawlers'], bot)
            continue
        who = hashlib.sha256(f"{today['salt']}|{m['ip']}|{ua}".encode()).hexdigest()[:16]
        # The browser ran the page: it fetched the site's scripts or called the API
        if host == API_HOST or path.startswith('/_next/static/') or (host is None and path.startswith('/api/')):
            today['visitors'].setdefault(who, {'p': {}})['js'] = True
            continue
        if not page:
            continue
        v = today['visitors'].setdefault(who, {'p': {}})
        if 'c' not in v:
            v['c'] = channel(query, m['ref'])
            if v['c'] == 'other sites':
                v['s'] = ref_site(m['ref'])
        add(v['p'], page_kind(path))
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
    try:
        proc = subprocess.run(['docker', 'logs', '--timestamps', '--since', since, CONTAINER],
                              capture_output=True, text=True, errors='replace', timeout=60)
        lines = (proc.stdout + proc.stderr).splitlines()
        lines.sort(key=lambda l: ts_key(l.split(' ', 1)[0]))   # stdout and stderr interleave
        ok = proc.returncode == 0
    except (OSError, subprocess.SubprocessError):
        lines, ok = [], False
    newest = count(st, lines)
    if newest:
        st['since'] = newest
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(st, fh, separators=(',', ':'))
    os.replace(tmp, path)
    out = summary(st['today'])
    out['updated'] = now.isoformat(timespec='seconds')
    out['log_read'] = ok
    out['history'] = [{k: h.get(k) for k in ('day', 'visitors', 'views', 'channels')} for h in st['history'][-14:]]
    print(json.dumps(out, separators=(',', ':')))


if __name__ == '__main__':
    main()
