#!/usr/bin/env python3
"""
The World Map's three Wikidata layers (plan M53, Oct 21, 2026): nuclear power
plants, military bases and spaceports, written to apps/web/public/geo/ as
GeoJSON. Wikidata is CC0, so the files can be served and changed freely; the
map credits it anyway.

Run by hand when the layers should be refreshed (a few times a year):
    python3 scripts/map-data/wikidata-layers.py
It asks query.wikidata.org three questions (about a minute in all), keeps
what the map can show honestly and prints what it kept and why it left the
rest out. Then check a sample on the map and commit the three files.

What it keeps:
- Nuclear power plants: every plant with a place, except those never built
  (cancelled, proposed, postponed). Status as Wikidata gives it: operating,
  under construction, shut down, or "status not recorded" (often operating).
- Military bases: articles in 3+ Wikipedias, not marked closed or ended, of a
  military kind (air base, naval base, barracks...); forts, castles, towers
  and heritage sites are left out, and so are civilian airports.
- Spaceports: every launch site with a place, except those never built.
"""
import collections, json, os, re, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'apps', 'web', 'public', 'geo')
UA = 'WorldPulse-map-data/1.0 (https://world-pulse.io; open-source news map)'
LANGS = 'en,fr,de,es,it,pt,ru,uk,zh,ja,ko,ar'

QUERIES = {
    'nuclear': f"""SELECT ?item ?itemLabel ?coord ?countryLabel ?statusLabel ?watts ?operatorLabel ?retired ?dissolved WHERE {{
  ?item wdt:P31/wdt:P279* wd:Q134447 ; wdt:P625 ?coord .
  OPTIONAL {{ ?item wdt:P17 ?country }}
  OPTIONAL {{ ?item wdt:P5817 ?status }}
  OPTIONAL {{ ?item p:P2109/psn:P2109/wikibase:quantityAmount ?watts }}
  OPTIONAL {{ ?item wdt:P137 ?operator }}
  OPTIONAL {{ ?item wdt:P730 ?retired }}
  OPTIONAL {{ ?item wdt:P576 ?dissolved }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "{LANGS}". }}
}}""",
    'spaceports': f"""SELECT ?item ?itemLabel ?coord ?countryLabel ?statusLabel ?operatorLabel ?dissolved WHERE {{
  ?item wdt:P31/wdt:P279* wd:Q194188 ; wdt:P625 ?coord .
  OPTIONAL {{ ?item wdt:P17 ?country }}
  OPTIONAL {{ ?item wdt:P5817 ?status }}
  OPTIONAL {{ ?item wdt:P137 ?operator }}
  OPTIONAL {{ ?item wdt:P576 ?dissolved }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "{LANGS}". }}
}}""",
    'bases': f"""SELECT ?item ?itemLabel ?coord ?countryLabel ?typeLabel ?statusLabel ?operatorLabel ?heritage WHERE {{
  ?item wdt:P31/wdt:P279* wd:Q245016 ; wdt:P625 ?coord ; wikibase:sitelinks ?sl .
  FILTER(?sl >= 3)
  FILTER NOT EXISTS {{ ?item wdt:P576 [] }}
  FILTER NOT EXISTS {{ ?item wdt:P582 [] }}
  ?item wdt:P31 ?type .
  OPTIONAL {{ ?item wdt:P17 ?country }}
  OPTIONAL {{ ?item wdt:P5817 ?status }}
  OPTIONAL {{ ?item wdt:P137 ?operator }}
  OPTIONAL {{ ?item wdt:P1435 ?heritage }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "{LANGS}". }}
}}""",
}

NEVER_BUILT = {'cancelled', 'proposed building or structure', 'postponed', 'project'}
SHUT = {'decommissioned', 'nuclear decommissioning', 'permanently closed', 'abandoned', 'out of service', 'not in operation'}
BUILDING = {'building or structure under construction', 'starting up'}
RUNNING = {'in use', 'in partial operation', 'active'}
POINT = re.compile(r'^Point\((-?[\d.]+(?:e-?\d+)?) (-?[\d.]+(?:e-?\d+)?)\)$', re.I)

MILITARY = {
    'airbase': 'air base', 'military base': 'base', 'barracks': 'barracks', 'naval base': 'naval base',
    'Royal Air Force station': 'air base', 'naval airbase': 'naval air base', 'Canadian Forces base': 'base',
    'garrison': 'garrison', 'submarine base': 'naval base', 'naval arsenal': 'naval base',
    'naval shore establishment': 'naval base', 'listening station': 'listening station',
    'United States military base in Okinawa': 'base', 'Royal Canadian Air Force Wing': 'air base',
    'military radar station': 'radar station', 'military training area': 'training area',
    'military installation': 'base', 'forward operating base': 'base', 'Heeresflugplatz': 'air base',
    'military airfield': 'air base', 'air force base': 'air base', 'army base': 'base',
    'naval station': 'naval base', 'air station': 'air base', 'military port': 'naval base',
    'cantonment': 'base', 'missile base': 'missile base', 'naval air station': 'naval air base',
    'Royal Navy shore establishment': 'naval base', 'United States Army installation': 'base',
    'United States Air Force base': 'air base', 'Marine Corps base': 'base', 'military camp': 'base',
}
HISTORIC_TYPES = re.compile(r'\b(castle|fort|fortress|fortification|tower|museum|monument|ruins?|archaeological|heritage|historic|bastion|citadel|redoubt|battery)\b', re.I)
HISTORIC_OPERATOR = re.compile(r'heritage|historic|tourism|culture|national trust|museum|parks?\b', re.I)
SOURCE = 'Wikidata (CC0), query.wikidata.org'


def ask(query):
    url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': query})
    req = urllib.request.Request(url, headers={'Accept': 'application/sparql-results+json', 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=240) as res:
        return json.load(res)['results']['bindings']


def value(row, name):
    return row.get(name, {}).get('value')


def group(rows):
    """One item per Wikidata entity: its first coordinate and every value seen"""
    items = collections.OrderedDict()
    for r in rows:
        q = value(r, 'item').rsplit('/', 1)[-1]
        it = items.setdefault(q, {'q': q, 'name': value(r, 'itemLabel') or q, 'coords': [], 'country': None, 'status': set(),
                                  'types': set(), 'operator': None, 'watts': [], 'retired': False, 'heritage': False})
        m = POINT.match(value(r, 'coord') or '')
        if m:
            c = (round(float(m.group(1)), 4), round(float(m.group(2)), 4))
            if c not in it['coords']:
                it['coords'].append(c)
        it['country'] = it['country'] or value(r, 'countryLabel')
        it['operator'] = it['operator'] or value(r, 'operatorLabel')
        for field, key in (('statusLabel', 'status'), ('typeLabel', 'types')):
            if value(r, field):
                it[key].add(value(r, field))
        if value(r, 'watts'):
            try:
                it['watts'].append(float(value(r, 'watts')))
            except ValueError:
                pass
        it['retired'] = it['retired'] or bool(value(r, 'retired') or value(r, 'dissolved'))
        it['heritage'] = it['heritage'] or bool(value(r, 'heritage'))
    return items


def state(it):
    s = it['status']
    if s & NEVER_BUILT and not (s & (RUNNING | SHUT | BUILDING)):
        return None
    if s & SHUT or it['retired']:
        return 'shut down'
    if s & BUILDING:
        return 'under construction'
    if s & RUNNING:
        return 'operating'
    return 'status not recorded'


def placeable(it):
    if not it['coords'] or re.fullmatch(r'Q\d+', it['name'] or ''):
        return False
    lng, lat = it['coords'][0]
    return abs(lat) <= 90 and abs(lng) <= 180 and not (lat == 0 and lng == 0)


def feature(it, props):
    lng, lat = it['coords'][0]
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lng, lat]},
            'properties': {'name': it['name'], 'country': it['country'], 'wikidata': it['q'], **props}}


def write(name, features, about):
    path = os.path.join(OUT, name)
    with open(path, 'w') as f:
        json.dump({'type': 'FeatureCollection', 'about': about, 'features': features}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{name}: {len(features)} points, {os.path.getsize(path):,} bytes')


def main():
    when = __import__('datetime').date.today().strftime('%b %d, %Y').replace(' 0', ' ')

    nuclear, states = [], collections.Counter()
    for it in group(ask(QUERIES['nuclear'])).values():
        st = state(it)
        if st is None or not placeable(it):
            continue
        mw = round(max(it['watts']) / 1e6) if it['watts'] else None
        if mw is not None and not (1 <= mw <= 9000):   # a plant is ~1 to ~8,000 MW: others are unit mistakes
            mw = None
        states[st] += 1
        nuclear.append(feature(it, {'status': st, 'mw': mw, 'operator': it['operator']}))
    print('nuclear:', dict(states))
    write('nuclear-plants.v1.geojson', nuclear, f'Nuclear power plants. {SOURCE}, {when}. Plants never built (cancelled, proposed) left out.')

    ports, states = [], collections.Counter()
    for it in group(ask(QUERIES['spaceports'])).values():
        st = state(it)
        if st is None or not placeable(it):
            continue
        st = 'active or not recorded' if st == 'status not recorded' else st
        states[st] += 1
        ports.append(feature(it, {'status': st, 'operator': it['operator']}))
    print('spaceports:', dict(states))
    write('spaceports.v1.geojson', ports, f'Spaceports and launch sites. {SOURCE}, {when}.')

    bases, kinds, dropped = [], collections.Counter(), collections.Counter()
    for it in group(ask(QUERIES['bases'])).values():
        kind = next((MILITARY[t] for t in sorted(it['types']) if t in MILITARY), None)
        if kind is None:
            dropped['not a military kind'] += 1
        elif it['heritage'] or any(HISTORIC_TYPES.search(t) for t in it['types']) or HISTORIC_OPERATOR.search(it['operator'] or ''):
            dropped['historic site'] += 1
        elif state(it) in (None, 'shut down'):
            dropped['closed or never built'] += 1
        elif not placeable(it):
            dropped['no name or place'] += 1
        else:
            kinds[kind] += 1
            bases.append(feature(it, {'kind': kind, 'operator': it['operator']}))
    print('bases:', dict(kinds), 'left out:', dict(dropped))
    write('military-bases.v1.geojson', bases, f"Military bases with articles in 3+ Wikipedias, not marked closed. {SOURCE}, {when}. Incomplete: some countries' bases are missing and a few closed ones may remain.")


if __name__ == '__main__':
    sys.exit(main())
