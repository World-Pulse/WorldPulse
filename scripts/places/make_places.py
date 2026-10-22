"""
The extra places for linking reports to the places they name
(apps/scraper/src/pipeline/world-places.ts), from GeoNames (geonames.org,
CC BY 4.0) through the geonamescache package (MIT). To make the file again:

  pip download geonamescache==3.0.2 --no-deps -d /tmp/gnc
  python3 -m zipfile -e /tmp/gnc/geonamescache-3.0.2-py3-none-any.whl /tmp/gnc/x
  python3 scripts/places/make_places.py /tmp/gnc/x/geonamescache/data apps/scraper/src/pipeline/world-places.ts
"""
import json, sys, unicodedata
src, out = sys.argv[1], sys.argv[2]
cities = json.load(open(f'{src}/cities15000.json'))
countries = json.load(open(f'{src}/countries.json'))
MIN_POP = 300_000
# Names that are also common words or people's names (in English, Spanish, Portuguese or French),
# or a sports club more often than a place in the news: left out
STOP = {
  # common words in English, Spanish, Portuguese or French, once capitalised at the start of a sentence
  'Male', 'Nice', 'Salé', 'Natal', 'Bello', 'Mobile', 'Reading', 'Split', 'Bath', 'Orange', 'Concord', 'Buffalo', 'Phoenix',
  'Aurora', 'Mesa', 'León', 'Soledad', 'Concepción', 'Trinidad', 'Libertad', 'Esperanza', 'Resistencia', 'Corrientes',
  'Posadas', 'Pasto', 'Florencia', 'Vitória', 'Mercedes', 'Pará', 'Salta', 'Contagem', 'Serra', 'Canoas', 'Diadema',
  'Paulista', 'Franca', 'Cascavel', 'Formosa', 'Tamale', 'Perm', 'Van', 'Batman', 'Mango', 'Pali', 'Delta', 'Plateau',
  'Rivers', 'Hope', 'Unity', 'Of', 'Bar', 'Sale', 'Colón', 'Sucre', 'Bolívar', 'Paraná', 'Guadalupe', 'Victoria',
  'Brent', 'Queens',
  # people's names (first names and surnames) more often than places in the news
  'Hamilton', 'Columbus', 'Charlotte', 'Medina', 'Pereira', 'Jackson', 'Lincoln', 'Madison', 'Austin', 'Houston', 'Dallas',
  'Florence', 'Regina', 'Eugene', 'Irvine', 'Arlington', 'Henderson', 'Chandler', 'Gilbert', 'Irving', 'Garland', 'Orlando',
  'Cleveland', 'Richmond', 'Durham', 'Laredo', 'Glendale', 'Fremont', 'Juárez', 'Matamoros', 'Hidalgo', 'Morelos', 'Rosario',
  'Trujillo', 'Salvador', 'Sagar', 'Anand', 'Sakai', 'Matsuyama', 'Miyazaki', 'Ichikawa', 'Okazaki', 'Fujisawa', 'Takamatsu',
  'Valenzuela', 'Kirov', 'Vladimir', 'Dzerzhinsk', 'Engels', 'Korolyov', 'Escobedo', 'General Escobedo', 'Benito Juárez',
  'Miguel Hidalgo', 'Álvaro Obregón', 'Gustavo A. Madero', 'Venustiano Carranza', 'Cuauhtémoc', 'Mandela', 'Santa Rosa',
  'San Pedro', 'San Miguel', 'San Juan', 'San José', 'Santa Cruz', 'Cartago', 'Palmira', 'Kawasaki', 'Toyota',
  'Gustavo Adolfo Madero', 'Mianzhu, Deyang, Sichuan',
  # football clubs more often than places when named alone
  'Liverpool', 'Manchester', 'Porto', 'Santos', 'Everton', 'Chelsea', 'Arsenal', 'Tottenham', 'Fulham', 'Celtic',
  # countries and city-states the country rules already handle, and a country's name inside a city's
  'Armenia', 'Georgia', 'Jordan', 'Chad', 'Niger', 'Liberia', 'Panama', 'Kuwait', 'Mexico', 'Guatemala', 'Djibouti',
  'Singapore', 'Monaco', 'San Marino', 'Luxembourg', 'Vatican City', 'Washington', 'Petersburg', 'Lusaka North',
}
def fold(s): return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn')
names = {}
for c in cities.values():
    if c.get('population', 0) < MIN_POP: continue
    n = c['name'].strip()
    if not n or n in STOP or fold(n) in {fold(s) for s in STOP}: continue
    if any(ch.isdigit() for ch in n) or len(fold(n)) < 4: continue
    if not all(ord(ch) < 0x250 or unicodedata.category(ch) in ('Zs', 'Pd', 'Po') for ch in n): continue   # Latin script only
    names.setdefault(n, (c['countrycode'], c['population']))
caps = 0
for cc, c in countries.items():
    n = (c.get('capital') or '').strip()
    if not n or n in STOP or fold(n) in {fold(s) for s in STOP} or len(fold(n)) < 4: continue
    if n not in names: names[n] = (cc, 0); caps += 1
# Smaller places that are often in world news (diplomacy, conflict, disasters)
EXTRA = ['Geneva', 'Davos', 'The Hague', 'Sharm el-Sheikh', 'Strasbourg', 'Bunia', 'Butembo', 'El Fasher', 'Nyala', 'Kadugli',
         'El Obeid', 'Wad Madani', 'Timbuktu', 'Kidal', 'Mopti', 'Agadez', 'Marib', 'Mukalla', 'Sirte', 'Misrata', 'Derna', 'Tobruk',
         'Sittwe', 'Lashio', "Cox's Bazar", 'Gwadar', 'Chaman', 'Khost', 'Kunduz', 'Bakhmut', 'Pokrovsk', 'Kupiansk', 'Chasiv Yar',
         'Toretsk', 'Avdiivka', 'Vuhledar', 'Kramatorsk', 'Sloviansk', 'Jenin', 'Nablus', 'Hebron', 'Ramallah', 'Tulkarm', 'Tyre',
         'Sidon', 'Idlib', 'Deir ez-Zor', 'Goma']
added_extra = 0
for n in EXTRA:
    if n not in names: names[n] = ('', 0); added_extra += 1
# States and provinces where WorldPulse's outlets name them most (India, Nigeria, Pakistan, Mexico, Brazil)
REGIONS = {
  'IN': ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
         'Jharkhand', 'Karnataka', 'Kerala', 'Keralam', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
         'Odisha', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
         'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh', 'Andaman and Nicobar Islands', 'Lakshadweep'],
  'NG': ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta State', 'Ebonyi',
         'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Nasarawa',
         'Niger State', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau State', 'Rivers State', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'],
  'PK': ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Gilgit-Baltistan', 'Azad Kashmir'],
  'MX': ['Sinaloa', 'Sonora', 'Michoacán', 'Tamaulipas', 'Jalisco', 'Guanajuato', 'Coahuila', 'Nuevo León', 'Baja California',
         'Baja California Sur', 'Quintana Roo', 'Chiapas', 'Tabasco', 'Yucatán', 'Campeche', 'Colima', 'Nayarit', 'Zacatecas',
         'San Luis Potosí', 'Tlaxcala', 'Querétaro', 'Aguascalientes', 'Durango', 'Oaxaca', 'Veracruz', 'Chihuahua', 'Estado de México'],
  'BR': ['Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Ceará', 'Espírito Santo', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul',
         'Minas Gerais', 'Pará', 'Paraíba', 'Pernambuco', 'Piauí', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia',
         'Roraima', 'Santa Catarina', 'Sergipe', 'Tocantins'],
}
regions = []
for cc, ns in REGIONS.items():
    for n in ns:
        if n in STOP or n in names or n in regions: continue
        regions.append(n)
city_list = sorted(names, key=lambda n: (-len(n), n))
js = lambda xs: ',\n'.join('  ' + ', '.join(json.dumps(x, ensure_ascii=False) for x in xs[i:i + 8]) for i in range(0, len(xs), 8))
open(out, 'w', encoding='utf-8').write(f'''/**
 * More places for linking reports to the places they name (Oct 22, 2026). The
 * hand-kept gazetteer (geo.ts) knows about 300 places, so a report on bandits
 * on the Sokoto road, a hospital fire in Bulawayo or floods in Piura was linked
 * to nothing: nearly half of the week's reports were linked to no person, place
 * or organisation.
 *
 * WORLD_CITIES: every city of {MIN_POP:,} people or more, every national capital
 * and a few smaller places often in world news (El Fasher, Davos), from GeoNames
 * (geonames.org, CC BY 4.0, through the geonamescache package), Latin-script
 * names only, without the names that are also common words, people's names or
 * football clubs. WORLD_REGIONS: the states and provinces of India, Nigeria,
 * Pakistan, Mexico and Brazil, whose outlets name them most.
 *
 * Used only to link reports to places in the knowledge graph (entity-rules.ts),
 * never for map pins. Made by scripts/places/make_places.py: don't edit by hand.
 */

/** {len(city_list)} cities, longest names first */
export const WORLD_CITIES: readonly string[] = [
{js(city_list)},
]

/** {len(regions)} states and provinces */
export const WORLD_REGIONS: readonly string[] = [
{js(regions)},
]
''')
print('cities', len(city_list), '(capitals added', caps, ', news places added', added_extra, ') regions', len(regions))
