"""
The map's towns and provinces from Natural Earth (apps/scraper/src/pipeline/world-gazetteer.ts; Nov 6, 2026). On
Nov 6, of each country's 10 largest towns the place-finder knew fewer than half in 72 of the 202 places WorldPulse
counts, and about 1 in 4 of the world's provinces and states: a Reuters story naming only "Mandeville" or
"Queensland" landed nowhere, and "Baja California" landed in California. Natural Earth is in the public domain
(naturalearthdata.com). To make the file again, from the repository's root:

  # 1. the data, each in its own new folder (Natural Earth 5.1, and the word lists that say which names are words)
  D=$(mktemp -d); cd $D
  curl -sSO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson
  curl -sSO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/10m_cultural/ne_10m_admin_1_states_provinces.dbf
  curl -sS -o en.txt https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt
  for l in en es fr pt de it nl; do curl -sS -o ${l}_50k.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/$l/${l}_50k.txt; done
  curl -sSO https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt
  curl -sSO https://raw.githubusercontent.com/fivethirtyeight/data/master/most-common-name/surnames.csv
  cd -
  # 2. the candidates, for the countries to map ("all", or codes: AE,AG,...)
  python3 -I scripts/places/make_gazetteer.py candidates $D <countries> /tmp/candidates.json
  # 3. what the place-finder makes of each name today: with world-gazetteer.ts emptied to its two empty tables
  (cd apps/scraper && npx tsx ../../scripts/places/known-places.ts /tmp/candidates.json /tmp/verdicts.json)
  # 4. the file
  python3 -I scripts/places/make_gazetteer.py emit $D /tmp/candidates.json /tmp/verdicts.json apps/scraper/src/pipeline/world-gazetteer.ts

A name goes on the map everywhere (WORLD_TOWNS) only when it can't be anything else: one country's, not a common word
in the feeds' languages, not a first name or a common surname, not the name of a country, a US state or a place the
map already puts elsewhere. Otherwise it is read for that country's own outlets only (HOME_TOWNS): a Jamaican outlet's
"Mandeville" or "Kingston" is the Jamaican town; Reuters' "Kingston" stays unplaced.
"""
import json, re, sys, unicodedata, collections, struct, os

MIN_POP = 15_000          # towns of at least this many people, and every capital, national or provincial
MAX_TOWNS = 60            # at most this many towns a country (the largest), besides its capitals
MIN_TOWNS = 12            # at least this many, for small countries
WORLD_MIN_POP = 30_000    # read everywhere: towns of at least this many people, and capitals; smaller ones at home only
TOWN_CLASSES = {'Admin-0 capital', 'Admin-0 capital alt', 'Admin-1 capital', 'Admin-1 region capital',
                'Admin-0 region capital', 'Populated place'}
# Natural Earth's codes for places it leaves without one
NO_CODE = {'Somaliland': 'SO', 'Kosovo': 'XK', 'Northern Cyprus': 'CY', 'France': 'FR', 'Norway': 'NO'}
COUNTRY_ALIASES = {
    'United States': 'US', 'United Kingdom': 'GB', 'Russia': 'RU', 'Czech Republic': 'CZ', 'Republic of the Congo': 'CG',
    'Democratic Republic of the Congo': 'CD', 'Ivory Coast': 'CI', 'Macedonia': 'MK', 'Palestinian Territory': 'PS',
    'South Korea': 'KR', 'North Korea': 'KP', 'Laos': 'LA', 'Vietnam': 'VN', 'Syria': 'SY', 'Iran': 'IR', 'Bolivia': 'BO',
    'Venezuela': 'VE', 'Tanzania': 'TZ', 'Moldova': 'MD', 'Taiwan': 'TW', 'Brunei': 'BN', 'Cape Verde': 'CV',
    'East Timor': 'TL', 'Swaziland': 'SZ', 'Micronesia': 'FM', 'Vatican': 'VA', 'Myanmar': 'MM', 'Bahamas': 'BS',
    'Gambia': 'GM', 'Hong Kong': 'HK', 'Macao': 'MO', 'Kosovo': 'XK', 'Curacao': 'CW', 'Reunion': 'RE',
    'Saint Kitts and Nevis': 'KN', 'Saint Lucia': 'LC', 'Saint Vincent and the Grenadines': 'VC', 'Bosnia and Herzegovina': 'BA',
    'Turkey': 'TR', 'Libya': 'LY', 'Sao Tome and Principe': 'ST', 'Guinea-Bissau': 'GW', 'Central African Republic': 'CF',
    'Equatorial Guinea': 'GQ', 'Dominican Republic': 'DO', 'Trinidad and Tobago': 'TT', 'Antigua and Barbuda': 'AG',
    'Falkland Islands': 'FK', 'U.S. Virgin Islands': 'VI', 'British Virgin Islands': 'VG', 'Puerto Rico': 'PR',
    'Western Sahara': 'EH', 'South Sudan': 'SS', 'Eswatini': 'SZ', 'North Macedonia': 'MK',
}
# Regions and peoples' words a province is named after, that headlines use for the region itself (Nov 6, 2026: Turkmenistan's
# Balkan province took Balkan Insight's "Week in Review" and "EU and the Western Balkans")
REGION_WORDS = {
    'balkan', 'balkans', 'baltic', 'caucasus', 'caucasian', 'sahel', 'sahara', 'saharan', 'andes', 'andean', 'alps',
    'alpine', 'caribbean', 'pacific', 'atlantic', 'arctic', 'antarctic', 'gulf', 'levant', 'maghreb', 'patagonia',
    'siberia', 'siberian', 'amazon', 'amazonas', 'amazonia', 'himalaya', 'himalayas', 'himalayan', 'mediterranean',
    'scandinavia', 'nordic', 'iberia', 'anatolia', 'mesopotamia', 'balkanski', 'dinaric', 'carpathian', 'carpathians',
    'pannonia', 'kurdistan', 'baluchistan', 'pashtunistan', 'transylvania', 'bessarabia', 'galicia', 'lapland',
    'chaco',                 # the Gran Chaco: Argentina's, Paraguay's and Bolivia's
}
# Names read for their own country's outlets only, though nothing else in the data says so
HOME_ONLY = {
    ('MW', 'Balaka'),        # also the Central African Republic's Anti-Balaka militias
}
# English names Natural Earth lacks
EXTRA_NAMES = {
    ('AE', 'Al Ayn'): ['Al Ain'],
}
# Words that alone name no one place: a province called "Central" or "Upper East" is several countries'
GENERIC = {
    'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western', 'central', 'centre', 'center',
    'upper', 'lower', 'middle', 'north-east', 'north-west', 'south-east', 'south-west', 'northeast', 'northwest',
    'southeast', 'southwest', 'nord', 'sud', 'est', 'ouest', 'norte', 'sur', 'este', 'oeste', 'centro', 'oriental',
    'occidental', 'coast', 'coastal', 'littoral', 'lakes', 'lake', 'islands', 'island', 'capital', 'region',
    'province', 'district', 'state', 'city', 'municipality', 'territory', 'federal', 'national', 'greater', 'new',
    'old', 'great', 'little', 'interior', 'highlands', 'lowlands', 'plateau', 'mountains', 'valley', 'river',
    'delta', 'savanes', 'plateaux', 'maritime', 'grand', 'haut', 'bas', 'alto', 'bajo', 'de', 'del', 'la', 'el',
    'los', 'las', 'du', 'des', 'le', 'and', 'of', 'the', 'saint', 'san', 'santa', 'st', 'st.', 'sainte',
}
# A province's kind, after its name: "Kasese District", "Ontario Province"; left off the key
KIND_BEFORE = re.compile(r'^(?:emirate|province|region|state|governorate|department|county|municipality|city|'
                         r'republic|prefecture|district|canton|parish|oblast)\s+of\s+(?:the\s+)?', re.I)
KIND_WORDS = re.compile(r'\s+(?:province|region|district|governorate|county|department|département|state|oblast|'
                        r'prefecture|parish|municipality|division|canton|emirate|aymag|aimag|hot|wilaya|vilayet|'
                        r'velayat|rayon|raion|krai|kray|okrug|republic|commune|zone|area)$', re.I)


def fold(s):
    return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn')


def read_dbf(path):
    with open(path, 'rb') as fh:
        n, header_len, record_len = struct.unpack('<xxxxLHH20x', fh.read(32))
        specs = []
        while True:
            d = fh.read(32)
            if d[0] == 0x0D:
                break
            specs.append((d[:11].split(b'\0', 1)[0].decode('ascii'), chr(d[11]), d[16]))
        fh.seek(header_len)
        rows = []
        for _ in range(n):
            rec = fh.read(record_len)
            if not rec or rec[0] == 0x1A:
                break
            pos, row = 1, {}
            for name, kind, length in specs:
                text = rec[pos:pos + length].decode('utf-8', errors='replace').replace('\x00', '').strip()
                pos += length
                if kind in 'NF':
                    try:
                        row[name] = float(text) if text else None
                    except ValueError:
                        row[name] = None
                else:
                    row[name] = text
            rows.append(row)
        return rows


def good_name(s):
    """A name as headlines write it: letters, spaces, hyphens and dots, and an apostrophe only in "'s" or a
    French or Italian elision ("Côte d'Ivoire") or a West African "N'" ("N'Zérékoré"); no transliteration marks ("Gow'altai"), backticks or broken characters"""
    if not s or len(s) < 3 or not re.fullmatch(r"[^\W\d_](?:[^\W\d_]|[ .\-'’])*", s):
        return False
    return all(re.search(r"(?:^|[\s-])[dlnDLN]['’]\S|['’]s(?:\s|$)", s[max(0, i - 2): i + 3]) for i, ch in enumerate(s) if ch in "'’")


def variants(*names):
    out = []
    for n in names:
        for part in (n or '').split('|'):
            part = re.sub(r'\s+', ' ', part.strip().strip('.'))
            if not good_name(part):
                continue
            forms = [part]
            # "Saint Ann", "St Ann", "St. Ann" (and Sainte, Ste)
            m = re.match(r'^(Saint|Sainte|St\.?|Ste\.?)\s+(.+)$', part)
            if m:
                female = m.group(1).lower().startswith(('sainte', 'ste'))
                forms += [f"{'Sainte' if female else 'Saint'} {m.group(2)}", f"{'Ste' if female else 'St'} {m.group(2)}",
                          f"{'Ste' if female else 'St'}. {m.group(2)}"]
            for f in forms:
                out.append(f)
                if fold(f) != f and good_name(fold(f)):
                    out.append(fold(f))
    return list(dict.fromkeys(out))


def candidates(data, countries, out):
    places = [f['properties'] for f in json.load(open(f'{data}/ne_10m_populated_places_simple.geojson', encoding='utf-8'))['features']]
    admin1 = read_dbf(f'{data}/ne_10m_admin_1_states_provinces.dbf')
    code = lambda p: (p.get('iso_a2') if p.get('iso_a2') not in (None, '', '-99') else NO_CODE.get(p.get('adm0name') or p.get('admin')))
    want = None if countries == 'all' else set(countries.split(','))
    rows = []
    # provinces' capitals, to pin a province where its news happens
    capital_of = {}
    for p in places:
        if p.get('featurecla') in ('Admin-1 capital', 'Admin-1 region capital', 'Admin-0 capital') and p.get('adm1name'):
            capital_of.setdefault((code(p), p['adm1name']), p)
    for a in admin1:
        cc = code(a)
        if not cc or (want and cc not in want):
            continue
        cap = capital_of.get((cc, a.get('name')))
        lat, lng = (cap['latitude'], cap['longitude']) if cap else (a.get('latitude'), a.get('longitude'))
        if lat is None or lng is None:
            continue
        shown = KIND_BEFORE.sub('', a.get('name_en') or a.get('name'))
        names = variants(a.get('name_en'), a.get('name'), a.get('woe_name'), a.get('name_alt'))
        names = list(dict.fromkeys(KIND_WORDS.sub('', KIND_BEFORE.sub('', n)) for n in names))
        main = list(dict.fromkeys(KIND_WORDS.sub('', KIND_BEFORE.sub('', n)) for n in variants(a.get('name_en'), a.get('name'), a.get('woe_name'))))
        # Natural Earth's English name is now and then cut short ("Kam", Kampong Speu) or one word of the name ("Nacional",
        # Distrito Nacional): then the longest main name that holds it
        longer = [n for n in main if len(n) > len(shown) and fold(shown).lower() in fold(n).lower()]
        if longer and (len(shown) <= 4 or fold(shown).lower() in GENERIC | {'nacional', 'metropolitana', 'metropolitan'}):
            shown = max(longer, key=len) if len(shown) <= 4 else min(longer, key=len)
        rows.append({'cc': cc, 'kind': 'province', 'shown': shown, 'type': a.get('type_en') or '', 'lat': round(lat, 4),
                     'lng': round(lng, 4), 'names': names, 'main': main, 'pop': None, 'adm1': a.get('name'),
                     'country_name': a.get('admin') or ''})
    by = collections.defaultdict(list)
    for p in places:
        cc = code(p)
        if cc and (not want or cc in want) and p.get('featurecla') in TOWN_CLASSES:
            by[cc].append(p)
    for cc, ps in by.items():
        ps.sort(key=lambda p: -(p.get('pop_max') or 0))
        capitals = [p for p in ps if 'capital' in (p.get('featurecla') or '')]
        big = [p for p in ps if (p.get('pop_max') or 0) >= MIN_POP][:MAX_TOWNS]
        if len(big) < MIN_TOWNS:          # a small country's towns are small: its largest, whatever their size
            big = ps[:MIN_TOWNS]
        seen = set()
        for p in capitals + big:
            if id(p) in seen:
                continue
            seen.add(id(p))
            names = variants(p['name'], p.get('nameascii'), p.get('namealt'), *EXTRA_NAMES.get((cc, p['name']), []))
            main = variants(p['name'], p.get('nameascii'), *EXTRA_NAMES.get((cc, p['name']), []))
            rows.append({'cc': cc, 'kind': 'town', 'shown': p['name'], 'type': p.get('featurecla'), 'lat': round(p['latitude'], 4),
                         'lng': round(p['longitude'], 4), 'names': names, 'main': main, 'pop': p.get('pop_max'),
                         'adm1': p.get('adm1name'), 'country_name': p.get('adm0name') or ''})
    # every name Natural Earth gives any place or province, by country: a name in two countries is no one's alone
    everywhere = collections.defaultdict(set)
    for p in places:
        for n in variants(p['name'], p.get('nameascii'), p.get('namealt')):
            everywhere[n.lower()].add(code(p))
    for a in admin1:
        for n in variants(a.get('name_en'), a.get('name'), a.get('woe_name'), a.get('name_alt')):
            everywhere[KIND_WORDS.sub('', n).lower()].add(code(a))
    # and GeoNames' towns of about 15,000 people or more and their provinces (datasets/world-cities, CC BY 4.0): Natural
    # Earth has one Falmouth (Jamaica's), GeoNames England's too
    named = {p.get('adm0name'): code(p) for p in places if code(p)}
    named.update({a.get('admin'): code(a) for a in admin1 if code(a)})
    named.update(COUNTRY_ALIASES)
    import csv
    for row in csv.DictReader(open(f'{data}/world-cities.csv', encoding='utf-8')):
        cc = named.get(row['country']) or 'name:' + row['country']
        for n in variants(row['name']):
            everywhere[n.lower()].add(cc)
        for n in variants(row.get('subcountry') or ''):
            everywhere[KIND_WORDS.sub('', n).lower()].add(cc)
    for r in rows:
        r['countries_by_name'] = {n: sorted(c for c in everywhere.get(n.lower(), set()) if c) for n in r['names']}
    json.dump(rows, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
    print('candidates', len(rows), collections.Counter(r['kind'] for r in rows))


def word_lists(data):
    words = collections.defaultdict(set)          # language -> common words
    very = set()                                   # the most common words of any language
    for line in open(f'{data}/en.txt', encoding='utf-8'):
        if line.strip():
            words['en'].add(line.strip().lower())
    for lang, top in (('en', 40_000), ('es', 25_000), ('fr', 25_000), ('pt', 25_000), ('de', 20_000), ('it', 20_000),
                      ('nl', 20_000), ('sr', 25_000), ('hr', 25_000), ('bs', 25_000), ('sl', 25_000), ('sq', 25_000),
                      ('ca', 20_000), ('lt', 20_000), ('ro', 25_000), ('da', 20_000)):
        for i, line in enumerate(open(f'{data}/{lang}_50k.txt', encoding='utf-8')):
            if i >= top:
                break
            w = line.split(' ')[0].strip().lower()
            if w:
                words[lang].add(w)
                if i < 2_000:
                    very.add(w)
    common = set().union(*words.values())
    first = {l.strip().lower() for l in open(f'{data}/first-names.txt', encoding='utf-8') if l.strip()}
    surnames = set()
    for i, line in enumerate(open(f'{data}/surnames.csv', encoding='utf-8')):
        if i == 0:
            continue
        if i > 25_000:
            break
        surnames.add(line.split(',')[0].strip().lower())
    return common, very, first | surnames


ARTICLES = {'al', 'el', 'ad', 'as', 'ash', 'ar', 'az', 'an', 'at', 'ath', 'adh', 'aḑ', 'aş', 'aţ'}

US_STATES = {'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
             'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
             'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska',
             'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
             'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas',
             'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming'}


def emit(data, cand_path, verdict_path, out):
    rows = json.load(open(cand_path, encoding='utf-8'))
    verdicts = json.load(open(verdict_path, encoding='utf-8'))      # name -> {country, whole}
    common, very, people = word_lists(data)
    world, home, world_keys = {}, collections.defaultdict(dict), set()
    why = collections.Counter()
    for r in rows:
        cc = r['cc']
        place = {'lat': r['lat'], 'lng': r['lng'], 'country': cc, 'name': r['shown']}
        if r['kind'] == 'town' and r.get('adm1'):
            place['region'] = r['adm1']
        for n in r['names']:
            key = n.lower()
            words = re.findall(r"[^\W\d_]+", fold(key))
            if not words or all(w in GENERIC for w in words) or len(fold(key).replace(' ', '')) < 3:
                why['generic'] += 1
                continue
            v = verdicts.get(n) or verdicts.get(key) or {}
            if v.get('country') == cc:
                why['known'] += 1
                continue
            own = set(re.findall(r"[^\W\d_]+", fold(r.get('country_name', '')).lower()))
            if own and all(w in own or w in GENERIC for w in words):
                why['the country\'s own name'] += 1      # "Barbuda" is in "Antigua and Barbuda"
                continue
            # an Arabic article doesn't make a name two common words ("Al Ain", "As Suwayda")
            core = [w for w in words if w not in ARTICLES] or words
            risky = None
            if (cc, r['shown']) in HOME_ONLY or (cc, n) in HOME_ONLY:
                risky = 'kept at home by hand'
            elif n not in r.get('main', r['names']):
                risky = 'another name for it'
            elif any(w in REGION_WORDS for w in words):
                risky = 'a region\'s name'
            elif v.get('country') and v.get('whole'):
                risky = 'the map puts it elsewhere'
            elif len(r['countries_by_name'].get(n, [])) > 1:
                risky = 'in two countries'
            elif key in US_STATES:
                risky = 'a US state'
            elif len(core) == 1 and (core[0] in common or core[0] in people or (len(words) == 1 and key in common)):
                risky = 'a word or a name'
            elif len(core) == 2 and all(w in very or w in people or w in GENERIC for w in core):
                risky = 'common words'
            elif len(fold(key).replace(' ', '').replace('-', '')) < 4 or (len(words) == 1 and len(words[0]) <= 4
                    and (r.get('pop') or 0) < 100_000 and 'Admin-0' not in (r.get('type') or '')):
                risky = 'too short'          # "Yoro" (Honduras) is also a West African name: "Médina Yoro Foulah"
            elif r['kind'] == 'town' and (r.get('pop') or 0) < WORLD_MIN_POP and 'capital' not in (r.get('type') or ''):
                risky = 'a small town'
            if risky:
                why['home: ' + risky] += 1
                home[cc].setdefault(n, place)
            else:
                why['world'] += 1
                if key not in world_keys:
                    world_keys.add(key)
                    world[n] = place
    # a name both put on the map everywhere and kept for one country's outlets is the map's
    for cc in home:
        for n in [n for n in home[cc] if n.lower() in world_keys]:
            del home[cc][n]
    print(dict(why))
    print('world', len(world), 'home', sum(len(v) for v in home.values()), 'countries', len(home))
    write_ts(world, home, out)


def ts_place(p):
    parts = [f"lat: {p['lat']}", f"lng: {p['lng']}", f"country: '{p['country']}'", f"name: {json.dumps(p['name'], ensure_ascii=False)}"]
    if p.get('region'):
        parts.append(f"region: {json.dumps(p['region'], ensure_ascii=False)}")
    return '{ ' + ', '.join(parts) + ' }'


def write_ts(world, home, out):
    lines = [
        '/**',
        ' * Towns and provinces for the map, from Natural Earth (public domain; scripts/places/make_gazetteer.py, Nov 6,',
        ' * 2026): don\'t edit by hand. WORLD_TOWNS are read in every text, as written (geo.ts adds them to the gazetteer;',
        ' * its own entries come first); HOME_TOWNS only in the headlines of their own country\'s outlets: names that are also',
        ' * words, people, regions, US states or another country\'s places, small towns and other names for a place (a',
        ' * Jamaican outlet\'s "Mandeville" or "Kingston").',
        ' */',
        '',
        'export interface TownEntry { lat: number; lng: number; country: string; name: string; region?: string }',
        '',
        f'/** {len(world)} names */',
        'export const WORLD_TOWNS: Record<string, TownEntry> = {',
    ]
    for k in sorted(world, key=lambda k: (world[k]['country'], k.lower())):
        lines.append(f'  {json.dumps(k, ensure_ascii=False)}: {ts_place(world[k])},')
    lines += ['}', '', f'/** {sum(len(v) for v in home.values())} names, by country: each as written, read with its capitals */',
              'export const HOME_TOWNS: Record<string, Record<string, TownEntry>> = {']
    for cc in sorted(home):
        lines.append(f'  {cc}: {{')
        for n in sorted(home[cc]):
            lines.append(f'    {json.dumps(n, ensure_ascii=False)}: {ts_place(home[cc][n])},')
        lines.append('  },')
    lines += ['}', '']
    open(out, 'w', encoding='utf-8').write('\n'.join(lines))
    print('wrote', out)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'candidates':
        candidates(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == 'emit':
        emit(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    else:
        sys.exit('usage: make_gazetteer.py candidates|emit ...')
