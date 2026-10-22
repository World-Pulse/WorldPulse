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
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FEEDS = os.path.join(ROOT, 'apps', 'scraper', 'src', 'sources', 'news-rss.ts')
KINDS = os.path.join(ROOT, 'scripts', 'outlets', 'outlet-kinds.json')
OUT = os.path.join(ROOT, 'apps', 'api', 'src', 'lib', 'outlet-directory.ts')
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


if __name__ == '__main__':
    main()
