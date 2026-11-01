#!/usr/bin/env python3
"""
The outlet directory (plan 15, Oct 22, 2026): every news feed WorldPulse reads,
by the website its articles come from, with the outlet's name, home country
and kind (news agency, international, national, local, specialist, aggregator
or official), and whether a government runs it. Written to
apps/api/src/lib/outlet-directory.ts for the API: the public signals' site_info,
a story's outlets, the MCP server and the under-reported crises (which outlets
cover a crisis from abroad).

From two files:
- apps/scraper/src/sources/news-rss.ts, the feeds (name, feed address, home
  country, the state-media label);
- scripts/outlets/outlet-kinds.json, kept by hand: each feed's kind (a feed
  not listed is a national outlet), names and websites where the feed's own
  differ, and well-known outlets WorldPulse sees through GDELT but doesn't
  read directly (Reuters, AP...).

Run after adding feeds:  python3 scripts/outlets/build-outlet-directory.py

It also writes apps/api/src/lib/feed-history.ts (Oct 31, 2026): how many news feeds
each country has had since Oct 14, 2026, by the day feeds were added (the dated
"// ── ... Mon D, YYYY" headers in the feed list), and the place names its reports
use: a place whose feeds just grew reports more than its usual for a few weeks,
and counts over time can allow for that.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FEEDS = os.path.join(ROOT, 'apps', 'scraper', 'src', 'sources', 'news-rss.ts')
KINDS = os.path.join(ROOT, 'scripts', 'outlets', 'outlet-kinds.json')
OUT = os.path.join(ROOT, 'apps', 'api', 'src', 'lib', 'outlet-directory.ts')
HISTORY_OUT = os.path.join(ROOT, 'apps', 'api', 'src', 'lib', 'feed-history.ts')
COUNTRIES = os.path.join(ROOT, 'apps', 'scraper', 'src', 'pipeline', 'world-countries.ts')
GEO = os.path.join(ROOT, 'apps', 'scraper', 'src', 'pipeline', 'geo.ts')
# Feeds added before this day count as each country's base
HISTORY_SINCE = '2026-10-14'
KIND_NAMES = ('agency', 'international', 'national', 'local', 'specialist', 'aggregator', 'official')
# A feed's own address prefixes that aren't the website's
FEED_PREFIXES = ('www.', 'feeds.', 'feed.', 'rss.', 'rssfeeds.')

STR = r"'((?:[^'\\]|\\.)*)'"


def unescape(s):
    return re.sub(r"\\(.)", r"\1", s)


def feeds():
    text = open(FEEDS, encoding='utf-8').read()
    body = text[text.index('export const NEWS_SOURCE_REGISTRY'):]
    out = []
    for m in re.finditer(r"\{\s*\n\s*id:\s*'([^']+)',(.*?)\n\s*\},", body, re.S):
        blk = m.group(2)
        def field(name):
            f = re.search(name + r":\s*" + STR, blk)
            return unescape(f.group(1)) if f else None
        out.append({'id': m.group(1), 'name': field('name'), 'feed': field('feedUrl') or '',
                    'bias': field('biasLabel'), 'country': field('countryCode')})
    return out


def site_of_feed(url):
    host = re.sub(r'^https?://', '', url).split('/')[0].split(':')[0].lower()
    changed = True
    while changed:
        changed = False
        for p in FEED_PREFIXES:
            if host.startswith(p) and host.count('.') >= 2:
                host, changed = host[len(p):], True
    return host


def clean_name(name):
    """ "The Guardian — World" → "The Guardian"; "Radio Dabanga (Sudan)" → "Radio Dabanga" """
    n = re.split(r'\s+[—–-]\s+', name)[0].strip()
    n = re.sub(r'\s*\([^)]*\)$', '', n).strip()
    return n or name


MONTHS = {m: i + 1 for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}
HEADER_DAY = re.compile(r'^\s*//\s*──.*?\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (20\d\d)')


def dated_feeds():
    """Each feed's country, home place and the day it was added: the date of the last dated section header above it"""
    text = open(FEEDS, encoding='utf-8').read()
    body = text[text.index('export const NEWS_SOURCE_REGISTRY'):]
    body = body[:body.index('\n]\n')]
    out, day = [], ''
    for m in re.finditer(r"^[^\n]*$", body, re.M):
        line = m.group(0)
        h = HEADER_DAY.match(line)
        if h:
            day = f'{h.group(3)}-{MONTHS[h.group(1)]:02d}-{int(h.group(2)):02d}'
            continue
        f = re.match(r"\s*id:\s*" + STR, line)
        if f:
            out.append({'id': unescape(f.group(1)), 'day': day, 'country': None, 'home': None})
            continue
        if out:
            c = re.match(r"\s*countryCode:\s*" + STR, line)
            if c and out[-1]['country'] is None:
                out[-1]['country'] = unescape(c.group(1)).upper()
            loc = re.match(r"\s*defaultLocation:\s*" + STR, line)
            if loc and out[-1]['home'] is None:
                out[-1]['home'] = unescape(loc.group(1))
    return out


def country_names():
    """Code → [name, capital] from the place-finder's country list (world-countries.ts) and capitals from geo.ts"""
    names = {}
    for m in re.finditer(r"^\s*c\('([A-Z]{2})',\s*" + r"('(?:[^'\\]|\\.)*'|\"[^\"]*\")" + r",\s*/.*?/[a-z]*,\s*" + STR,
                         open(COUNTRIES, encoding='utf-8').read(), re.M):
        name = m.group(2)[1:-1].replace("\\'", "'")
        names.setdefault(m.group(1), []).extend([name, unescape(m.group(3))])
    geo = open(GEO, encoding='utf-8').read()
    cent = geo[geo.index('const COUNTRY_CENTROIDS'):]
    cent = cent[:cent.index('\n}')]
    for m in re.finditer(r"^\s*([A-Z]{2}):\s*\{[^}]*name:\s*" + STR, cent, re.M):
        names.setdefault(m.group(1), []).append(unescape(m.group(2)))
    return names


# Home places that name a region or an organisation, not a country (Al-Monitor's "Middle East", UN News's "United Nations")
NOT_PLACES = {'united nations', 'middle east', 'eurasia', 'pan-african', 'africa', 'asia', 'europe', 'global', 'world',
              'worldwide', 'caribbean', 'pacific', 'gulf', 'latin america', 'central asia', 'balkans', 'sahel',
              'west africa', 'east africa', 'southern africa', 'central africa', 'arctic', 'online'}


def display_names(codes):
    """English names of country codes, as Node's Intl gives them ("United States", "Türkiye")"""
    import subprocess
    js = ("const n=new Intl.DisplayNames(['en'],{type:'region'});const o={};"
          "for(const c of process.argv.slice(1)){try{o[c]=n.of(c)}catch(e){}}console.log(JSON.stringify(o))")
    try:
        return json.loads(subprocess.run(['node', '-e', js] + sorted(codes), capture_output=True, text=True, timeout=30).stdout or '{}')
    except Exception:
        return {}


def write_feed_history():
    rows = [r for r in dated_feeds() if r['country']]
    known = country_names()
    by = {}
    for r in rows:
        by.setdefault(r['country'], []).append(r)
    for cc, name in display_names(by).items():
        if name and name != cc:
            known.setdefault(cc, []).append(name)
    known_owner = {}
    for cc, ns in known.items():
        for n_ in ns:
            known_owner.setdefault(n_.lower(), cc)
    home_owners = {}
    for r in rows:
        for part in (r['home'] or '').split(','):
            home_owners.setdefault(part.strip().lower(), set()).add(r['country'])

    def usable(part, cc):
        low = part.lower()
        return (len(part) > 2 and '/' not in part and low not in NOT_PLACES
                and known_owner.get(low, cc) == cc and home_owners.get(low, {cc}) == {cc})
    lines = [
        '/**',
        ' * How many news feeds each country has had since Oct 14, 2026, by the day feeds',
        ' * were added, and the place names its reports use (its name, capital and its',
        " * feeds' home places). Written by scripts/outlets/build-outlet-directory.py from",
        " * the news feeds (apps/scraper/src/sources/news-rss.ts): don't edit by hand, run",
        ' * the script. Countries whose feeds have not changed since then are left out.',
        ' */',
        '',
        'export interface FeedHistory {',
        '  /** place names, as reports name places ("Doha, Qatar" has the parts Doha and Qatar) */',
        '  names: string[]',
        '  /** news feeds homed in the country before the first step */',
        '  base: number',
        '  /** [day feeds were added (YYYY-MM-DD), feeds from that day on], oldest first */',
        '  steps: Array<[string, number]>',
        '}',
        '',
        f"export const FEED_HISTORY_SINCE = '{HISTORY_SINCE}'",
        '',
        '/** By country (ISO 3166-1 alpha-2) */',
        'export const FEED_HISTORY: Readonly<Record<string, FeedHistory>> = {',
    ]
    shown = 0
    for cc in sorted(by):
        feeds_ = by[cc]
        base = sum(1 for r in feeds_ if not r['day'] or r['day'] < HISTORY_SINCE)
        days = sorted({r['day'] for r in feeds_ if r['day'] and r['day'] >= HISTORY_SINCE})
        if not days:
            continue
        steps, n = [], base
        for d in days:
            n += sum(1 for r in feeds_ if r['day'] == d)
            steps.append([d, n])
        names = []
        for n_ in known.get(cc, []) + [part.strip() for r in feeds_ for part in (r['home'] or '').split(',') if usable(part.strip(), cc)]:
            if n_ and n_ not in names:
                names.append(n_)
        lines.append(f"  {cc}: {{ names: {json.dumps(names, ensure_ascii=False)}, base: {base}, steps: {json.dumps(steps)} }},")
        shown += 1
    lines += ['}', '']
    open(HISTORY_OUT, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'{shown} countries whose feeds changed since {HISTORY_SINCE} → {os.path.relpath(HISTORY_OUT, ROOT)}')


def main():
    conf = json.load(open(KINDS, encoding='utf-8'))
    kind_of = {}
    for kind, ids in conf['kinds'].items():
        assert kind in KIND_NAMES, kind
        for i in ids:
            assert i not in kind_of, ('two kinds for', i)
            kind_of[i] = kind
    rows = feeds()
    ids = {r['id'] for r in rows}
    unknown = sorted(set(kind_of) - ids) + sorted(set(conf.get('state', [])) - ids) + sorted(set(conf.get('hosts', {})) - ids)
    if unknown:
        sys.exit(f'outlet-kinds.json names feeds that news-rss.ts does not have: {unknown}')

    directory, why = {}, {}
    def put(host, entry, source):
        old = directory.get(host)
        if old and (old['kind'] != entry['kind'] or old['name'] != entry['name']):
            # two feeds of one website (DW World and DW Africa): the hand-kept host_kind decides, else the first
            hk = conf.get('host_kind', {}).get(host)
            if hk:
                old['kind'] = hk
            print(f'  {host}: {why[host]} ({old["kind"]}, {old["name"]}) and {source} ({entry["kind"]}, {entry["name"]})'
                  + ('' if hk else ': kept the first'))
            return
        if not old:
            directory[host] = entry
            why[host] = source

    for r in rows:
        kind = kind_of.get(r['id'], 'national')
        entry = {'name': conf.get('names', {}).get(r['id']) or clean_name(r['name'] or r['id']),
                 'country': conf.get('country', {}).get(r['id']) or (r['country'] or '').upper(),
                 'kind': kind}
        if r['bias'] == 'state-media' or r['id'] in conf.get('state', []):
            entry['state'] = True
        for host in conf.get('hosts', {}).get(r['id']) or [site_of_feed(r['feed'])]:
            put(host, dict(entry), r['id'])
    for e in conf.get('extra', []):
        assert e['kind'] in KIND_NAMES, e
        entry = {'name': e['name'], 'country': e['country'], 'kind': e['kind']}
        if e.get('state'):
            entry['state'] = True
        put(e['host'], entry, 'extra')
    for host, kind in conf.get('host_kind', {}).items():
        if host in directory:
            directory[host]['kind'] = kind

    lines = [
        '/**',
        ' * The outlet directory: each website WorldPulse counts as an outlet, with its',
        ' * name, home country (ISO 3166-1 alpha-2) and kind, and whether a government',
        ' * runs it (state). Written by scripts/outlets/build-outlet-directory.py from',
        ' * the news feeds (apps/scraper/src/sources/news-rss.ts) and the hand-kept',
        " * scripts/outlets/outlet-kinds.json: don't edit by hand, run the script.",
        ' */',
        '',
        "export type OutletKind = 'agency' | 'international' | 'national' | 'local' | 'specialist' | 'aggregator' | 'official'",
        '',
        'export interface OutletEntry { name: string; country: string; kind: OutletKind; state?: true }',
        '',
        '/** By website, without "www."; a website also stands for its subdomains (edition.cnn.com is cnn.com) */',
        'export const OUTLET_DIRECTORY: Readonly<Record<string, OutletEntry>> = {',
    ]
    for host in sorted(directory):
        e = directory[host]
        state = ', state: true' if e.get('state') else ''
        lines.append(f"  {json.dumps(host)}: {{ name: {json.dumps(e['name'], ensure_ascii=False)}, country: {json.dumps(e['country'])}, kind: '{e['kind']}'{state} }},")
    lines += ['}', '']
    open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))
    counts = {}
    for e in directory.values():
        counts[e['kind']] = counts.get(e['kind'], 0) + 1
    print(f'{len(rows)} feeds, {len(directory)} websites → {os.path.relpath(OUT, ROOT)}: {counts}, state {sum(1 for e in directory.values() if e.get("state"))}')
    write_feed_history()


if __name__ == '__main__':
    main()
