#!/usr/bin/env python3
"""
The World Map's "Displaced people" layer (plan R4, Oct 21, 2026; Devon, 9:50
AM: "Add - added refugee and displacement data - onto the roadmap to compete
with WorldMonitor"): UNHCR's figures for each country, written to
apps/web/public/geo/unhcr-displacement.v1.geojson as one point a country.

UNHCR's population statistics (the Refugee Data Finder, api.unhcr.org) are
licensed under the Creative Commons Attribution 4.0 International licence, so
the file can be served on the site; the map credits UNHCR on every popup.
They are published twice a year (the end of the year's figures in June, the
middle of the year's later), so this is run by hand when new figures are out:
    python3 scripts/map-data/unhcr-displacement.py
It asks the API two questions (a few seconds), prints the largest figures for
a look, and writes the file; check a few countries on the map and commit it.

For each country, the newest year UNHCR has:
- inside: people displaced inside the country (UNHCR's internally displaced
  people of concern)
- abroad: its people who fled abroad: refugees, asylum-seekers and others in
  need of international protection, counted where they are (by origin)
- hosted: the same three groups from elsewhere, living in the country
- stateless: stateless people living in the country
- returned: refugees and displaced people who went home that year
The point sits at the middle of the country's largest land area (Natural
Earth's shapes, already on the site); countries too small for those shapes
are left off the map (they are few, and their figures small).
"""
import json, math, os, re, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEO = os.path.join(ROOT, 'apps', 'web', 'public', 'geo')
SHAPES = os.path.join(GEO, 'ne_110m_admin_0_countries.v1.geojson')
OUT = os.path.join(GEO, 'unhcr-displacement.v1.geojson')
API = 'https://api.unhcr.org/population/v1/'
UA = 'WorldPulse-map-data/1.0 (https://world-pulse.io; open-source news map)'
# Natural Earth's own codes where they differ from ISO's
NE_TO_ISO = {'SDS': 'SSD', 'PSX': 'PSE', 'SAH': 'ESH', 'KOS': 'XKX'}
# The names WorldPulse uses elsewhere (the API's COUNTRY_NAMES), else Natural Earth's
NAMES_FROM = os.path.join(ROOT, 'apps', 'api', 'src', 'routes', 'countries.ts')
NAME_FIXES = {'EH': 'Western Sahara', 'SZ': 'Eswatini', 'XK': 'Kosovo'}


def worldpulse_names():
    text = open(NAMES_FROM, encoding='utf-8').read()
    block = text[text.index('export const COUNTRY_NAMES'):]
    block = block[:block.index('}')]
    return dict(re.findall(r"\b([A-Z]{2}): ['\"]([^'\"]+)['\"]", block))


def get(path, **params):
    url = API + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def count(v):
    """UNHCR's figures come as numbers, "0" or "-" (not applicable)"""
    try:
        return max(0, int(v))
    except (TypeError, ValueError):
        return 0


def rows(year, by):
    data = get('population/', limit=500, yearFrom=year, yearTo=year, **{by: 'true'})
    if (data.get('maxPages') or 1) > 1:
        sys.exit(f'{by} {year}: more than one page; raise the limit')
    return data.get('items') or []


def ring_area_centroid(ring):
    """Area (signed) and centroid of one ring of [lng, lat] points (the shoelace formula)"""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if a == 0:
        xs, ys = [p[0] for p in ring], [p[1] for p in ring]
        return 0.0, (sum(xs) / len(xs), sum(ys) / len(ys))
    return a / 2, (cx / (3 * a), cy / (3 * a))


def middle_of_largest(geometry):
    polys = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    best = None
    for poly in polys:
        area, centre = ring_area_centroid([tuple(p[:2]) for p in poly[0]])
        if best is None or abs(area) > best[0]:
            best = (abs(area), centre)
    lng, lat = best[1]
    return [round(lng, 3), round(lat, 3)]


def main():
    year = None
    for y in range(int(os.environ.get('UNHCR_YEAR') or 2026), 2019, -1):
        origin = rows(y, 'coo_all')
        if origin:
            year = y
            break
    if year is None:
        sys.exit('UNHCR has no figures for the last few years: is the API answering?')
    asylum = rows(year, 'coa_all')

    figures = {}
    def entry(iso, name):
        return figures.setdefault(iso, {'iso3': iso, 'name': name, 'inside': 0, 'abroad': 0, 'hosted': 0, 'stateless': 0, 'returned': 0})
    for r in origin:
        iso = r.get('coo_iso') or r.get('coo')
        if not iso or iso == '-':
            continue
        e = entry(iso, r.get('coo_name'))
        e['inside'] += count(r.get('idps'))
        e['abroad'] += count(r.get('refugees')) + count(r.get('asylum_seekers')) + count(r.get('oip'))
        e['returned'] += count(r.get('returned_refugees')) + count(r.get('returned_idps'))
    for r in asylum:
        iso = r.get('coa_iso') or r.get('coa')
        if not iso or iso == '-':
            continue
        e = entry(iso, r.get('coa_name'))
        e['hosted'] += count(r.get('refugees')) + count(r.get('asylum_seekers')) + count(r.get('oip'))
        e['stateless'] += count(r.get('stateless'))

    countries = {c['iso']: c for c in get('countries/', limit=500).get('items') or []}
    names = worldpulse_names()
    shapes = json.load(open(SHAPES))['features']
    biggest = max((e['inside'] + e['abroad'] for e in figures.values()), default=1) or 1
    features, unplaced = [], []
    placed = set()
    for f in shapes:
        p = f['properties']
        iso = NE_TO_ISO.get(p['adm0_a3'], p['adm0_a3'])
        e = figures.get(iso)
        if not e or iso in placed:
            continue
        if max(e['inside'] + e['abroad'], e['hosted'], e['stateless']) < 1000:
            continue
        placed.add(iso)
        c = countries.get(iso) or {}
        iso2 = c.get('iso2') or (p['iso_a2'] if p['iso_a2'] != '-99' else None)
        displaced = e['inside'] + e['abroad']
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': middle_of_largest(f['geometry'])},
            'properties': {
                'iso3': iso, 'iso2': iso2, 'name': names.get(iso2) or NAME_FIXES.get(iso2) or p['name'],
                'inside': e['inside'], 'abroad': e['abroad'], 'hosted': e['hosted'],
                'stateless': e['stateless'], 'returned': e['returned'],
                # the circle's size: its area follows the people displaced from the country
                'size': round(math.sqrt(displaced / biggest), 4),
            },
        })
    for iso, e in figures.items():
        if iso not in placed and e['inside'] + e['abroad'] >= 100_000:
            unplaced.append((e['name'], e['inside'] + e['abroad']))
    features.sort(key=lambda x: -x['properties']['size'])
    out = {
        'type': 'FeatureCollection',
        'source': 'UNHCR Refugee Data Finder (api.unhcr.org), CC BY 4.0',
        'year': year,
        'features': features,
    }
    with open(OUT, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    print(f'{year}: {len(features)} countries on the map, {os.path.getsize(OUT):,} bytes')
    for x in features[:12]:
        p = x['properties']
        print(f"  {p['name']}: {p['inside']:,} inside, {p['abroad']:,} abroad, hosts {p['hosted']:,} at {x['geometry']['coordinates']}")
    if unplaced:
        print('  100,000 or more displaced but no shape on the map:', unplaced)


if __name__ == '__main__':
    main()
