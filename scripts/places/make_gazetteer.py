"""
The map's towns and provinces from Natural Earth (apps/scraper/src/pipeline/world-gazetteer.ts; Nov 6, 2026). On
Nov 6, of each country's 10 largest towns the place-finder knew fewer than half in 72 of the 202 places WorldPulse
counts, and about 1 in 4 of the world's provinces and states: a Reuters story naming only "Mandeville" or
"Queensland" landed nowhere, and "Baja California" landed in California. Batch 1 mapped those 72 countries, batch 2
(the same evening) every country: towns 56% to 83%, provinces 23% to 71%. Natural Earth is in the public domain
(naturalearthdata.com); what it lacks (Kenya's counties, Nepal's provinces, Thane) is written by hand (EXTRA_PLACES).
To make the file again, from the repository's root:

  # 1. the data, each in its own new folder (Natural Earth 5.1, and the word lists that say which names are words)
  D=$(mktemp -d); cd $D
  curl -sSO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson
  curl -sSO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/10m_cultural/ne_10m_admin_1_states_provinces.dbf
  curl -sSO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/10m_cultural/ne_10m_admin_2_counties.dbf
  curl -sS -o en.txt https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt
  for l in en es fr pt de it nl sr hr bs sl sq ca lt ro da; do curl -sS -o ${l}_50k.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/$l/${l}_50k.txt; done
  curl -sSO https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt
  curl -sSO https://raw.githubusercontent.com/fivethirtyeight/data/master/most-common-name/surnames.csv
  curl -sSO https://raw.githubusercontent.com/datasets/world-cities/master/data/world-cities.csv
  cd -
  # 2. the candidates, for the countries to map (the 202 places WorldPulse counts, as codes: AE,AF,AG,...; or "all")
  python3 -I scripts/places/make_gazetteer.py candidates $D <countries> /tmp/candidates.json
  # 3. what the place-finder makes of each name today: with world-gazetteer.ts emptied to its two empty tables
  (cd apps/scraper && npx tsx ../../scripts/places/known-places.ts /tmp/candidates.json /tmp/verdicts.json)
  # 4. the file
  python3 -I scripts/places/make_gazetteer.py emit $D /tmp/candidates.json /tmp/verdicts.json apps/scraper/src/pipeline/world-gazetteer.ts

A name goes on the map everywhere (WORLD_TOWNS) only when it can't be anything else: one country's, not a common word
in the feeds' languages, not a first name or a common surname, not the name of a country, a US state or a place the
map already puts elsewhere; or when it is a big city looked at by hand (READ_EVERYWHERE: Boston, Kōbe, Surat).
Otherwise it is read for that country's own outlets only (HOME_TOWNS): a Jamaican outlet's "Mandeville" or "Kingston"
is the Jamaican town; Reuters' "Kingston" stays unplaced. Each country's 600 largest towns (60 until the night of
Nov 6, 2026); beyond its 60 largest, none that is any surname, and none everywhere under 100,000 people.
"""
import json, re, sys, unicodedata, collections, struct, os

MIN_POP = 15_000          # towns of at least this many people, and every capital, national or provincial
MAX_TOWNS = 600           # at most this many towns a country (the largest), besides its capitals (60 until Nov 6, 2026:
                          # China's and India's towns beyond their 60 largest, Foshan or Surat, weren't on the map)
OLD_MAX_TOWNS = 60        # beyond a country's 60 largest, stricter (emit)
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
    # GeoNames' (ISO's) names: unmatched, each counted as a second country, so that Venezuela's Anzoátegui or Syria's
    # Homs was "in two countries" (Nov 6, 2026)
    'Türkiye': 'TR', 'Russian Federation': 'RU', 'Viet Nam': 'VN', 'Venezuela, Bolivarian Republic of': 'VE',
    'Iran, Islamic Republic of': 'IR', 'Tanzania, United Republic of': 'TZ', 'Congo, The Democratic Republic of the': 'CD',
    "Côte d'Ivoire": 'CI', 'Bolivia, Plurinational State of': 'BO', 'Moldova, Republic of': 'MD', 'Syrian Arab Republic': 'SY',
    'Taiwan, Province of China': 'TW', 'Korea, Republic of': 'KR', 'Congo': 'CG', "Korea, Democratic People's Republic of": 'KP',
    "Lao People's Democratic Republic": 'LA', 'Timor-Leste': 'TL', 'Réunion': 'RE', 'Palestine, State of': 'PS',
    'Cabo Verde': 'CV', 'Brunei Darussalam': 'BN', 'Martinique': 'MQ', 'Holy See (Vatican City State)': 'VA',
    'Micronesia, Federated States of': 'FM', 'Bonaire, Sint Eustatius and Saba': 'BQ', 'Guadeloupe': 'GP',
    'Svalbard and Jan Mayen': 'SJ',
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
    # English words for a region, and companies' names: "Northland cuts Terawulf stock price target" is Northland
    # Capital Markets (Nov 6, 2026: pinned in New Zealand's Northland)
    'northland', 'southland', 'westland', 'eastland', 'highland', 'midlands', 'heartland', 'outback', 'riviera',
}
# Names read for their own country's outlets only, though nothing else in the data says so
HOME_ONLY = {
    ('MW', 'Balaka'),        # also the Central African Republic's Anti-Balaka militias
    ('BR', 'Espírito Santo'),  # the Holy Spirit, and a surname ("Evanilde Espírito Santo", São Tomé, Nov 6, 2026)
    ('UG', 'Bundibugyo'),    # also an Ebola virus ("DRC battles Bundibugyo outbreak", Nov 6, 2026)
    ('VE', 'Portuguesa'),    # Portuguese, the word: "Língua Portuguesa", "a seleção portuguesa"
    ('IR', 'Markazi'),       # "central" in Persian and Urdu: Pakistan's "Markazi Jamiat Ahl-e-Hadith"
    ('VN', 'Vinh'),          # also a given name: "Pham Thanh Vinh"
    ('LC', 'Soufrière'),     # also St Vincent's La Soufrière volcano, Guadeloupe's, and Montserrat's Soufrière Hills
    ('LC', 'Laborie'), ('LC', 'Micoud'), ('LC', 'Dennery'),   # surnames too
    ('JM', 'Trelawny'),      # also a Cornish name and surname
    # towns beyond their country's 60 largest, smaller than a namesake abroad (Nov 6, 2026): Afghanistan's Faizabad
    # (Badakhshan's capital); Nepal's Krishnanagar ("261 families in Krishnanagar receive ... land ownership
    # certificates", Khabarhub, was pinned in West Bengal); "Hisar", Turkish for a fortress ("Rumeli Hisarı")
    ('IN', 'Faizabad'), ('IN', 'Krishnanagar'), ('IN', 'Hisar'),
    # towns two regions of their own country share at about a size: Anhui's and Zhejiang's Fuyang, Jiangxi's and
    # Heilongjiang's Yichun, Illinois' and Indiana's Bloomington, North Carolina's and Arkansas' Fayetteville
    ('CN', 'Fuyang'), ('CN', 'Yichun'), ('US', 'Bloomington'), ('US', 'Fayetteville'),
}
# Cities read everywhere though another country has a place of the name, or the name is a word or a person's in some
# language: each looked at by hand for what a world outlet's capitalised name, or GDELT's American, British and
# Australian local news's, most likely is (Nov 6, 2026: 323 of the world's 1,182 cities of 400,000 people or more
# couldn't be placed by a world outlet, Boston behind Boston, Lincolnshire). A person of the name is told apart by
# place-words.ts's FIRST_NAME_PLACES ("Kobe Bryant", "Princess Charlotte", "Boston Scientific"); a namesake's own
# country's outlets read their own town first (geo.ts homeTwinPlace).
# Left out after a look, with the day's stories: Natal (Portuguese for Christmas), Essen (German for a meal), Santos
# ("Todos los Santos"), León ("León XIV"), Salvador (the country in French, "au Salvador", and inside "El Salvador"),
# Kota (Malay and Indonesian for a city, "Kota Surabaya"), Mesa ("la Mesa del Congreso"), Hue (an English word,
# capitalised in Title Case), Chihuahua (the dog), Perm ("Perm Sec", a permanent secretary), Buffalo, Fez, Nice,
# Columbus (the explorer); San Juan (Guatemala's San Juan Sacatepéquez, Honduras' San Juan Guarita, Trinidad's,
# "el hospital San Juan de Dios"), Santa Cruz (California's, the Galápagos'), Tula (Mexico's refinery), George Town
# (the Cayman Islands' capital); Odessa, Durango, La Plata, Kingston, Bristol, Portsmouth, Hanover (towns of American
# or Canadian local news: Odessa, Texas, "Durango and La Plata County residents shaken by flooding", Kingston,
# Ontario); Berkeley (Bermuda's Berkeley Institute); Liverpool, Leeds, Brighton (most often the football clubs,
# Uruguay's Liverpool too); and cities of two countries of about a size (Valencia, Birmingham, Córdoba, Newcastle, San
# José) or of two US states (Portland, Albany, Rochester, Pasadena, Glendale, Springfield, Arlington). Nor any city
# geo.ts keeps only with its state or country written after it (H-0037, Nov 1, 2026: "Austin, Texas", "Perth,
# Australia", "Cali, Colombia", "Hyderabad, India", "Campo Grande, Brazil"; geo.ts's tests: "Phoenix rises as Austin
# Butler stars" is no place), nor La Paz (Baja California Sur's hurricanes)
READ_EVERYWHERE = {
    'US': {'Boston', 'San Diego', 'Denver', 'St. Louis', 'Long Beach', 'San Bernardino', 'Virginia Beach', 'Ft. Worth',
           'Irvine', 'Bridgeport', 'Stamford', 'Laredo'},
    'RU': {'St. Petersburg', 'Samara', 'Rostov', 'Ivanovo'},
    'CN': {'Handan', 'Yangzhou', 'Chaozhou', 'Jining', 'Jincheng'},
    'IN': {'Surat', 'Thane'},   # Thane: Albanian "thanë" (they said) is a word without its accent, never "Thane"
    'JP': {'Kōbe', 'Nagano'},
    'BR': {'Santo André', 'Vila Velha'},
    'DE': {'Heidelberg'},
    'AU': {'Adelaide'}, 'CO': {'Cartagena'}, 'DK': {'København'}, 'SE': {'Göteborg'}, 'FR': {'Metz'}, 'NG': {'Aba'},
    'AE': {'Al Ayn'},
}
# Places Natural Earth lacks, by hand (Nov 7, 2026, from two days' stories the map couldn't place): Kenya's counties
# (its provinces there are the 8 of before 2013: "Floods in Migori" was no place), Nepal's new provinces (it has the 14
# zones of before 2015) and some districts, Kerala's districts and its new name, Thane and Howrah (1.8 and 1.1 million
# people), and towns of the news (Qeshm, Teknaf, Kajang, Abyei). Each at its seat or main town, as written down from
# memory and checked against a second list of towns (within 2 km; Howrah and Pokhara's 6). The same rules then say
# whether a name is read everywhere: (country, kind, name, lat, lng, region of a town or None, population of a town or
# None, other names)
EXTRA_PLACES = [
    ('KE', 'province', 'Kwale', -4.174, 39.452, None, None, []),
    ('KE', 'province', 'Tana River', -1.500, 40.030, None, None, []),
    ('KE', 'province', 'Taita Taveta', -3.505, 38.378, None, None, ['Taita-Taveta']),
    ('KE', 'province', 'Tharaka Nithi', -0.333, 37.647, None, None, ['Tharaka-Nithi']),
    ('KE', 'province', 'Makueni', -1.781, 37.629, None, None, []),
    ('KE', 'province', 'Nyandarua', -0.273, 36.379, None, None, []),
    ('KE', 'province', 'Kirinyaga', -0.499, 37.281, None, None, []),
    ('KE', 'province', "Murang'a", -0.721, 37.153, None, None, ['Muranga', 'Murang’a']),
    ('KE', 'province', 'Kiambu', -1.171, 36.835, None, None, []),
    ('KE', 'province', 'West Pokot', 1.239, 35.112, None, None, []),
    ('KE', 'province', 'Samburu', 1.097, 36.698, None, None, []),
    ('KE', 'province', 'Trans Nzoia', 1.016, 35.006, None, None, ['Trans-Nzoia']),
    ('KE', 'province', 'Uasin Gishu', 0.514, 35.270, None, None, []),
    ('KE', 'province', 'Elgeyo Marakwet', 0.671, 35.508, None, None, ['Elgeyo-Marakwet']),
    ('KE', 'province', 'Nandi', 0.204, 35.105, None, None, []),
    ('KE', 'province', 'Baringo', 0.492, 35.743, None, None, []),
    ('KE', 'province', 'Laikipia', 0.012, 37.074, None, None, []),
    ('KE', 'province', 'Kajiado', -1.852, 36.776, None, None, []),
    ('KE', 'province', 'Bomet', -0.782, 35.342, None, None, []),
    ('KE', 'province', 'Vihiga', 0.077, 34.723, None, None, []),
    ('KE', 'province', 'Busia', 0.460, 34.111, None, None, []),
    ('KE', 'province', 'Siaya', 0.061, 34.288, None, None, []),
    ('KE', 'province', 'Homa Bay', -0.527, 34.457, None, None, []),
    ('KE', 'province', 'Migori', -1.063, 34.473, None, None, []),
    ('KE', 'province', 'Nyamira', -0.567, 34.935, None, None, []),
    ('NP', 'province', 'Koshi', 26.455, 87.270, None, None, []),
    ('NP', 'province', 'Madhesh', 26.729, 85.926, None, None, []),
    ('NP', 'province', 'Sudurpashchim', 28.708, 80.590, None, None, ['Sudurpaschim']),
    ('NP', 'province', 'Chitwan', 27.683, 84.433, None, None, []),
    ('NP', 'province', 'Rasuwa', 28.107, 85.296, None, None, []),
    ('NP', 'province', 'Humla', 29.970, 81.831, None, None, []),
    ('NP', 'town', 'Kirtipur', 27.678, 85.278, 'Bagmati', 65_000, []),
    ('IN', 'town', 'Thane', 19.218, 72.978, 'Maharashtra', 1_841_000, []),
    ('IN', 'town', 'Howrah', 22.596, 88.264, 'West Bengal', 1_077_000, []),
    ('IN', 'province', 'Keralam', 10.8505, 76.2711, None, None, []),
    ('IN', 'province', 'Thrissur', 10.527, 76.214, None, None, ['Trichur']),
    ('IN', 'province', 'Kannur', 11.874, 75.370, None, None, []),
    ('IN', 'province', 'Palakkad', 10.786, 76.654, None, None, []),
    ('IN', 'province', 'Malappuram', 11.051, 76.071, None, None, []),
    ('IN', 'province', 'Kottayam', 9.591, 76.522, None, None, []),
    ('IN', 'province', 'Ernakulam', 10.016, 76.341, None, None, []),
    ('IN', 'province', 'Idukki', 9.851, 76.946, None, None, []),
    ('IN', 'province', 'Wayanad', 11.609, 76.084, None, None, []),
    ('IN', 'province', 'Pathanamthitta', 9.264, 76.787, None, None, []),
    ('IN', 'province', 'Kasaragod', 12.500, 74.990, None, None, []),
    ('IN', 'province', 'East Godavari', 17.005, 81.777, None, None, []),
    ('IN', 'province', 'West Godavari', 16.544, 81.521, None, None, []),
    ('IR', 'province', 'Qeshm', 26.958, 56.270, None, None, []),
    ('BD', 'province', 'Teknaf', 20.863, 92.302, None, None, []),
    ('KG', 'province', 'Sokuluk', 42.859, 74.305, None, None, []),
    ('AT', 'province', 'Voitsberg', 47.044, 15.159, None, None, []),
    ('MY', 'town', 'Kajang', 2.993, 101.788, 'Selangor', 342_000, []),
    ('UA', 'province', 'Oleshky', 46.617, 32.722, None, None, []),
    ('BG', 'province', 'Shabla', 43.539, 28.535, None, None, []),
    ('SD', 'province', 'Abyei', 9.596, 28.437, None, None, []),
    ('BS', 'province', 'Grand Bahama', 26.533, -78.697, None, None, []),
    # Nov 7, 2026 (M78, part 7): towns two days' stories named that the map didn't know, the most named first: Belize's
    # San Pedro (9 stories), Chile's Puente Alto (half a million people), the Gambia's Kanifing, Austria's district
    # towns (the Kleine Zeitung's "Babys aus den Bezirken Leibnitz und Deutschlandsberg")
    ('BZ', 'town', 'San Pedro', 17.916, -87.966, 'Belize', 17_000, []),
    ('BZ', 'town', 'San Ignacio', 17.159, -89.070, 'Cayo', 20_000, []),
    ('CL', 'town', 'Puente Alto', -33.611, -70.576, 'Santiago Metropolitan', 568_000, []),
    ('CL', 'town', 'Lampa', -33.286, -70.876, 'Santiago Metropolitan', 102_000, []),
    ('GM', 'town', 'Kanifing', 13.447, -16.678, 'Kanifing', 380_000, []),
    ('GH', 'town', 'Kasoa', 5.534, -0.418, 'Central', 200_000, []),
    ('GT', 'town', 'Villa Nueva', 14.527, -90.588, 'Guatemala', 433_000, []),
    ('PE', 'town', 'Ventanilla', -11.875, -77.128, 'Callao', 400_000, []),
    ('PT', 'town', 'Matosinhos', 41.182, -8.689, 'Porto', 175_000, []),
    ('ES', 'town', 'Benalmádena', 36.596, -4.517, 'Andalusia', 70_000, []),
    ('AT', 'town', 'Wels', 48.157, 14.025, 'Upper Austria', 63_000, []),
    ('IS', 'town', 'Kópavogur', 64.112, -21.909, 'Capital Region', 39_000, []),
    ('SN', 'town', 'Kébémer', 15.368, -16.446, 'Louga', 25_000, []),
    ('HT', 'town', 'Miragoâne', 18.443, -73.089, 'Nippes', 30_000, []),
    ('PY', 'town', 'Ayolas', -27.390, -56.900, 'Misiones', 18_000, []),
    ('PY', 'town', 'Minga Guazú', -25.483, -54.800, 'Alto Paraná', 90_000, []),
    ('PY', 'town', 'San Estanislao', -24.659, -56.443, 'San Pedro', 60_000, ['Santaní']),
    ('PA', 'town', 'Changuinola', 9.430, -82.517, 'Bocas del Toro', 50_000, []),
    ('IN', 'town', 'Adilabad', 19.667, 78.533, 'Telangana', 140_000, []),
    ('BD', 'town', 'Khagrachhari', 23.119, 91.984, 'Chittagong', 60_000, ['Khagrachari']),
    ('KG', 'town', 'Cholpon-Ata', 42.649, 77.082, 'Issyk-Kul', 15_000, []),
    ('AL', 'town', 'Bulqizë', 41.492, 20.221, 'Dibër', 8_000, []),
    ('CH', 'town', 'Vevey', 46.463, 6.843, 'Vaud', 20_000, []),
    ('LU', 'town', 'Differdange', 49.524, 5.891, 'Esch-sur-Alzette', 29_000, []),
    ('KY', 'town', 'West Bay', 19.375, -81.417, 'West Bay', 11_000, []),
    ('AT', 'town', 'Gleisdorf', 47.104, 15.708, 'Styria', 11_000, []),
    ('AT', 'province', 'Leibnitz', 46.782, 15.538, None, None, []),
    ('AT', 'province', 'Deutschlandsberg', 46.815, 15.222, None, None, []),
    ('AT', 'province', 'Feldbach', 46.953, 15.888, None, None, []),
    ('AT', 'province', 'Weiz', 47.218, 15.623, None, None, []),
    ('AT', 'province', 'Lienz', 46.830, 12.769, None, None, []),
    ('AT', 'province', 'Völkermarkt', 46.662, 14.636, None, None, []),
    ('AT', 'province', 'Knittelfeld', 47.215, 14.829, None, None, []),
    ('AT', 'province', 'Gmunden', 47.918, 13.799, None, None, []),
    ('AT', 'province', 'Murau', 47.111, 14.171, None, None, []),
    ('AT', 'province', 'Perg', 48.250, 14.633, None, None, []),
    ('AZ', 'province', 'Aghdam', 40.046, 46.992, None, None, []),   # Natural Earth's Agdam district, as AzerTAc writes it
    # Natural Earth's Stepanakert by its name in Azerbaijan since 2023, shown as the story writes it (AzerTAc's "Khankendi
    # Stadium")
    ('AZ', 'town', 'Khankendi', 39.816, 46.752, 'Khankendi', 57_000, ['Xankəndi']),
]
# Natural Earth's rows that are another row again, of the same size, in the wrong place: a second Vila Velha in Amapá,
# Crato in Amazonas, Nakhodka (Primorye's port) in Yamal-Nenets, Noginsk (Moscow's) in Evenkia
WRONG_ROWS = {('BR', 'Vila Velha', 3.2), ('BR', 'Crato', -7.5), ('RU', 'Nakhodka', 67.8), ('RU', 'Noginsk', 64.5)}
# Names that are no one place's in headlines: Washington's "District of Columbia" less its kind is "Columbia" (the
# university, Columbia in South Carolina, Columbia Sportswear)
SKIP = {
    ('US', 'Columbia'),
    ('RU', 'Vladimir'),      # Vladimir Putin (Nov 6, 2026: "Vladimir Putin calls out nations ..." was pinned in Vladimir);
                             # geo.ts keeps "Vladimir Oblast" and "Vladimir region"
    ('CO', 'Meta'),          # the company, in Colombia's outlets too; geo.ts keeps "del Meta", the department's
    ('MX', 'Cuauhtémoc'),    # Chihuahua's town, not Mexico City's borough ("la alcaldía Cuauhtémoc"), nor Cuauhtémoc Blanco
    ('MX', 'Cuauhtemoc'),
    ('BR', 'Caxias'),        # Maranhão's, not Caxias do Sul or Duque de Caxias, both written "Caxias" too
    ('BR', 'Lajes'),         # Santa Catarina's Lages (the old spelling), not the Azores' Lajes air base
}
# English names Natural Earth lacks
EXTRA_NAMES = {
    ('AE', 'Al Ayn'): ['Al Ain'],
    ('DE', 'Hanover'): ['Hannover'],       # the German name, Natural Earth's other name for it
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
    'mercedes',              # the carmaker and the Formula 1 team before Uruguay's and Argentina's towns
    'nacional', 'metropolitana', 'metropolitano', 'metropolitan',   # "Día Nacional del Deporte" isn't Distrito Nacional
}
# A province's kind, after its name: "Kasese District", "Ontario Province"; left off the key
KIND_BEFORE = re.compile(r'^(?:emirate|province|region|state|governorate|department|county|municipality|city|'
                         r'republic|prefecture|district|canton|parish|oblast)\s+of\s+(?:the\s+)?', re.I)
KIND_WORDS = re.compile(r'\s+(?:province|region|district|governorate|county|department|département|state|oblast|'
                        r'prefecture|parish|municipality|division|canton|emirate|aymag|aimag|hot|wilaya|vilayet|'
                        r'velayat|rayon|raion|krai|kray|okrug|republic|commune|zone|area)$', re.I)


def fold(s):
    return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn')


def same(s):
    """A name as compared across places and countries: without accents, case or hyphens ("Porto-Novo" is "Porto Novo")"""
    return re.sub(r'[\s\-]+', ' ', fold(s).lower()).strip()


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
            raw = re.sub(r'\s+', ' ', part.strip())
            # an abbreviation or a code, not a name headlines use for the place: "Miss." and "Ark." took "Forecast Miss"
            # and "Ark Invest" (Nov 6, 2026); "XIV", Chile's Los Ríos region, took "León XIV"
            if re.fullmatch(r"(?:[^\W\d_]{1,5}\.\s?)+", raw) or re.fullmatch(r"[IVXLCDM]+", raw):
                continue
            part = raw.strip('.')
            if not good_name(part):
                continue
            forms = [part]
            # "Saint Ann", "St Ann", "St. Ann" (and Sainte, Ste); "Saint-Denis", "St-Denis", "St.-Denis"
            m = re.match(r'^(Saint|Sainte|St\.?|Ste\.?)(\s+|-)(.+)$', part)
            if m:
                female = m.group(1).lower().startswith(('sainte', 'ste'))
                sep = ' ' if m.group(2).strip() == '' else '-'
                forms += [f"{'Sainte' if female else 'Saint'}{sep}{m.group(3)}", f"{'Ste' if female else 'St'}{sep}{m.group(3)}",
                          f"{'Ste' if female else 'St'}.{sep}{m.group(3)}"]
            # "Fort Worth" for Natural Earth's "Ft. Worth", "Mount Hagen" for "Mt. Hagen" (Nov 6, 2026: Fort Worth was
            # another name for Ft. Worth, read only by American outlets)
            m = re.match(r'^(Ft|Mt)\.?\s+(.+)$', part)
            if m:
                forms += [f"{'Fort' if m.group(1) == 'Ft' else 'Mount'} {m.group(2)}", f"{m.group(1)} {m.group(2)}",
                          f"{m.group(1)}. {m.group(2)}"]
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
        # not Yahoo's woe_name: now and then a neighbour's ("Bundibugyo" for Uganda's Ntoroko district, "Callao" for
        # Peru's Puno; Nov 6, 2026: the Callao's stories were pinned in Puno)
        names = variants(a.get('name_en'), a.get('name'), a.get('name_alt'))
        names = list(dict.fromkeys(KIND_WORDS.sub('', KIND_BEFORE.sub('', n)) for n in names))
        main = list(dict.fromkeys(KIND_WORDS.sub('', KIND_BEFORE.sub('', n)) for n in variants(a.get('name_en'), a.get('name'))))
        # Natural Earth's English name is now and then cut short ("Kam", Kampong Speu) or one word of the name ("Nacional",
        # Distrito Nacional): then the longest main name that holds it
        longer = [n for n in main if len(n) > len(shown) and fold(shown).lower() in fold(n).lower()]
        if longer and (len(shown) <= 4 or fold(shown).lower() in GENERIC | {'nacional', 'metropolitana', 'metropolitan'}):
            shown = max(longer, key=len) if len(shown) <= 4 else min(longer, key=len)
        rows.append({'cc': cc, 'kind': 'province', 'shown': shown, 'type': a.get('type_en') or '', 'lat': round(lat, 4),
                     'lng': round(lng, 4), 'names': names, 'main': main, 'pop': None, 'adm1': a.get('name'),
                     'country_name': a.get('admin') or ''})
    # a town's province as Natural Earth's provinces write it: its towns' file has "?" for some letters ("Qu?ng Ninh")
    provinces_of = collections.defaultdict(list)
    for a in admin1:
        if code(a):
            provinces_of[code(a)] += [n for n in (a.get('name'), a.get('name_en')) if n]

    def province_name(cc, name):
        if not name or ('?' not in name and '\ufffd' not in name):
            return name
        pattern = re.compile(re.escape(name).replace(re.escape('?'), '.').replace('\ufffd', '.') + '$', re.I)
        return next((n for n in provinces_of[cc] if pattern.match(n)), None)

    by = collections.defaultdict(list)
    for p in places:
        cc = code(p)
        if (cc, p['name'], round(p['latitude'], 1)) in WRONG_ROWS:
            continue
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
            # the ASCII name is the name's own only when it is the name without its accents: Homs's is "Hims" (Nov 6,
            # 2026: "Hims & Hers stock climbs" was pinned in Syria)
            ascii_name = p.get('nameascii') if fold(p.get('nameascii') or '').lower() == fold(p['name']).lower() else None
            main = variants(p['name'], ascii_name, *EXTRA_NAMES.get((cc, p['name']), []))
            rows.append({'cc': cc, 'kind': 'town', 'shown': p['name'], 'type': p.get('featurecla'), 'lat': round(p['latitude'], 4),
                         'lng': round(p['longitude'], 4), 'names': names, 'main': main, 'pop': p.get('pop_max'),
                         'adm1': province_name(cc, p.get('adm1name')), 'country_name': p.get('adm0name') or '',
                         'rank': ps.index(p)})
    country_of = {code(p): p.get('adm0name') for p in places if code(p)}
    for cc, kind, name, lat, lng, region, pop, others in EXTRA_PLACES:
        if want and cc not in want:
            continue
        # as written by hand, an apostrophe too ("Murang'a")
        names = list(dict.fromkeys([name, *others] + variants(name, *others)))
        rows.append({'cc': cc, 'kind': kind, 'shown': name, 'type': 'by hand', 'lat': lat, 'lng': lng, 'names': names,
                     'main': names, 'pop': pop, 'adm1': region, 'country_name': country_of.get(cc) or '', 'rank': 0})
    # every name Natural Earth gives any place or province, by country: a name in two countries is no one's alone
    everywhere = collections.defaultdict(set)
    for cc, kind, name, lat, lng, region, pop, others in EXTRA_PLACES:
        for n in [name, *others] + variants(name, *others):
            everywhere[same(n)].add(cc)
    for p in places:
        for n in variants(p['name'], p.get('nameascii'), p.get('namealt')):
            everywhere[same(n)].add(code(p))
    for a in admin1:
        for n in variants(a.get('name_en'), a.get('name'), a.get('name_alt')):
            everywhere[same(KIND_WORDS.sub('', n))].add(code(a))
    # the United States' 3,224 counties (Natural Earth): GDELT's local American news names them alone (Nov 6, 2026: The
    # Sumter Item's "Johnson loses Clarendon by 10 votes in governor's race" was pinned in Jamaica's Clarendon); not
    # Puerto Rico's towns (WorldPulse's own place), and not against the British and Irish places counties were named
    # after (the Isle of Wight, Wexford)
    us_counties = {same(KIND_WORDS.sub('', n)) for a in read_dbf(f'{data}/ne_10m_admin_2_counties.dbf') if a.get('REGION') != 'PR'
                   for n in variants(a.get('NAME'), a.get('NAME_ALT'))}
    # and GeoNames' towns of about 15,000 people or more and their provinces (datasets/world-cities, CC BY 4.0): Natural
    # Earth has one Falmouth (Jamaica's), GeoNames England's too
    named = {p.get('adm0name'): code(p) for p in places if code(p)}
    named.update({a.get('admin'): code(a) for a in admin1 if code(a)})
    named.update(COUNTRY_ALIASES)
    import csv
    for row in csv.DictReader(open(f'{data}/world-cities.csv', encoding='utf-8')):
        cc = named.get(row['country']) or 'name:' + row['country']
        for n in variants(row['name']):
            everywhere[same(n)].add(cc)
        for n in variants(row.get('subcountry') or ''):
            everywhere[same(KIND_WORDS.sub('', n))].add(cc)
    # the first and last words of every longer place name, by country: Colombia's Caldas is the start of Portugal's
    # Caldas da Rainha and Brazil's Caldas Novas (Nov 6, 2026: Caldas da Rainha's jazz festival was pinned in Colombia)
    in_longer = collections.defaultdict(set)
    longer_names = [(n, code(p)) for p in places for n in variants(p['name'], p.get('nameascii'))]
    for row in csv.DictReader(open(f'{data}/world-cities.csv', encoding='utf-8')):
        longer_names += [(n, named.get(row['country']) or 'name:' + row['country']) for n in variants(row['name'])]
    for n, c in longer_names:
        words = fold(n).lower().split()
        if len(words) > 1 and c:
            for w in (words[0], words[-1]):
                if w not in GENERIC and w not in ARTICLES:
                    in_longer[w].add(c)
    for r in rows:
        r['countries_by_name'] = {n: sorted(c for c in everywhere.get(same(n), set()) | ({'US'} if r['cc'] not in ('GB', 'IE')
                                  and same(n) in us_counties else set()) if c) for n in r['names']}
        r['in_longer_names'] = {n: sorted(in_longer[fold(n).lower()]) for n in r['names'] if ' ' not in n and fold(n).lower() in in_longer}
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
                words[lang].update({w, fold(w)})
                if i < 2_000:
                    very.update({w, fold(w)})
    common = set().union(*words.values())
    first = {fold(l.strip().lower()) for l in open(f'{data}/first-names.txt', encoding='utf-8') if l.strip()}
    surnames, every_surname = set(), set()
    for i, line in enumerate(open(f'{data}/surnames.csv', encoding='utf-8')):
        if i == 0:
            continue
        name = fold(line.split(',')[0].strip().lower())
        every_surname.add(name)
        if i <= 25_000:
            surnames.add(name)
    return common, very, first | surnames, surnames, first | every_surname


ARTICLES = {'al', 'el', 'ad', 'as', 'ash', 'ar', 'az', 'an', 'at', 'ath', 'adh', 'aḑ', 'aş', 'aţ'}

US_STATES = {'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
             'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
             'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska',
             'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
             'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas',
             'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming'}


def with_state_only():
    """geo.ts's hand-kept cities written with their state or country ("austin, texas", H-0037): the bare name isn't
    read everywhere, it is a word or a name too often"""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../apps/scraper/src/pipeline/geo.ts'), encoding='utf-8').read()
    # not Kansas City, neither a word nor a name: written alone it is Missouri's, not the state of Kansas
    return {fold(m.group(1)) for m in re.finditer(r"^  '([^',]+), [^']+': \{", src, re.M)} - {'kansas city'}


def first_name_places():
    """place-words.ts's FIRST_NAME_PLACES: places that are also people's names, whose capitals around say which (Denver, Austin)"""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../apps/scraper/src/pipeline/place-words.ts'), encoding='utf-8').read()
    block = re.search(r'const FIRST_NAME_PLACES = new Set\(\[(.*?)\]\)', src, re.S).group(1)
    return set(re.findall(r"'([^']+)'", re.sub(r'//[^\n]*', '', block)))


def emit(data, cand_path, verdict_path, out):
    rows = json.load(open(cand_path, encoding='utf-8'))
    verdicts = json.load(open(verdict_path, encoding='utf-8'))      # name -> {country, whole}
    common, very, people, surnames, anyone = word_lists(data)
    named_places = first_name_places()
    state_only = with_state_only()
    world, home, world_keys = {}, collections.defaultdict(dict), set()
    why = collections.Counter()
    hand_world = set()
    for r in rows:
        cc = r['cc']
        place = {'lat': r['lat'], 'lng': r['lng'], 'country': cc, 'name': r['shown']}
        if r['kind'] == 'town' and r.get('adm1'):
            place['region'] = r['adm1']
        # a town beyond its country's 60 largest (OLD_MAX_TOWNS) is smaller than its name's other uses more often: none
        # that is any of 150,000 surnames (Nov 6, 2026: Bellingham, Washington took "Jude Bellingham's brother Jobe
        # gets England call-up", Dickinson "Emily Dickinson", Brazil's Salgueiro Matosinhos' mayor Luísa Salgueiro), and
        # read everywhere only from 100,000 people
        beyond = r['kind'] == 'town' and r.get('rank', 0) >= OLD_MAX_TOWNS and 'capital' not in (r.get('type') or '')
        listed = READ_EVERYWHERE.get(cc, ())
        shown = re.sub(r'\s+', ' ', r['shown'])
        for n in r['names']:
            key = n.lower()
            hand = (shown in listed or n in listed) and n in r['main']
            words = re.findall(r"[^\W\d_]+", fold(key))
            if not words or all(w in GENERIC for w in words) or len(fold(key).replace(' ', '')) < 3:
                why['generic'] += 1
                continue
            if (cc, n) in SKIP:
                why['skipped by hand'] += 1
                continue
            # a name without its accents that is a common word: Brazil's Pará as "Para" took "Para Lula, su triunfo ..."
            # (Nov 6, 2026), Malé's "Male"
            if len(words) == 1 and key in very and any(fold(m) == n and m != n for m in r['names']):
                why['a common word without its accents'] += 1
                continue
            v = verdicts.get(n) or verdicts.get(key) or {}
            # known: the place-finder reads the whole name in this country already; read in part, the name is still
            # wanted (Nov 6, 2026: with accents read, "Kasaï-Oriental" was the Kasaï, another province)
            if v.get('country') == cc and v.get('whole'):
                why['known'] += 1
                continue
            own = set(re.findall(r"[^\W\d_]+", fold(r.get('country_name', '')).lower()))
            if own and all(w in own or w in GENERIC for w in words):
                why['the country\'s own name'] += 1      # "Barbuda" is in "Antigua and Barbuda"
                continue
            # an Arabic article doesn't make a name two common words ("Al Ain", "As Suwayda")
            core = [w for w in words if w not in ARTICLES] or words
            if beyond and not hand and any(w in anyone for w in core if w not in GENERIC):
                why['skipped: beyond the 60 largest, a person\'s name'] += 1
                continue
            risky = None
            if (cc, r['shown']) in HOME_ONLY or (cc, n) in HOME_ONLY:
                risky = 'kept at home by hand'
            elif fold(key) in state_only:
                risky = 'geo.ts reads it with its state or country'
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
            elif len(words) == 1 and any(c != cc for c in r.get('in_longer_names', {}).get(n, [])):
                risky = 'part of a longer name elsewhere'
            elif len(core) == 2 and all(w in very or w in people or w in GENERIC for w in core):
                risky = 'common words'
            elif len(fold(key).replace(' ', '').replace('-', '')) < 4 or (len(words) == 1 and len(words[0]) <= 4
                    and (r.get('pop') or 0) < 100_000 and 'Admin-0' not in (r.get('type') or '')):
                risky = 'too short'          # "Yoro" (Honduras) is also a West African name: "Médina Yoro Foulah"
            elif r['kind'] == 'town' and (r.get('pop') or 0) < WORLD_MIN_POP and 'capital' not in (r.get('type') or ''):
                risky = 'a small town'
            elif beyond and (r.get('pop') or 0) < 100_000:
                risky = 'a small town beyond the 60 largest'
            # a city looked at by hand (READ_EVERYWHERE): Boston, Hyderabad, Perth
            if (risky in ('in two countries', 'part of a longer name elsewhere', 'common words', 'a word or a name', 'too short')
                    and hand):
                why['world: read everywhere by hand (' + risky + ')'] += 1
                if len(words) == 1 and words[0] in people and fold(key) not in named_places:
                    print('warning: read everywhere, also a person\'s name, not in place-words.ts\'s FIRST_NAME_PLACES:', cc, n)
                hand_world.add((cc, shown if shown in listed else n))
                risky = None
            # a longer name, part of which the map puts in another country, is better read whole, everywhere: "Coronel
            # Oviedo" (Paraguay) was Spain's Oviedo, "El Beni" (Bolivia) the Congo's Beni (Nov 6, 2026)
            # (not "East London", South Africa's: Britain's outlets write London's East End so too)
            if (risky in ('common words', 'a small town', 'a word or a name') and len(words) > 1 and v.get('country')
                    and v['country'] != cc and not v.get('whole') and words[0] not in GENERIC):
                why['world: part of it was elsewhere (' + risky + ')'] += 1
                risky = None
            if risky:
                why['home: ' + risky] += 1
                # a surname too ("Armando León", "Dion George's"): geo.ts reads it as the place unless a capitalised
                # name comes right before it ("Zélia José dos Santos")
                home[cc].setdefault(n, {**place, 'surname': True} if len(core) == 1 and core[0] in surnames else place)
            else:
                why['world'] += 1
                if key not in world_keys:
                    world_keys.add(key)
                    world[n] = place
    # a name both put on the map everywhere and kept for its own country's outlets is the map's; another country's
    # town of the name stays its outlets' (Odessa, Texas, for a Texan outlet)
    world_country = {k.lower(): p['country'] for k, p in world.items()}
    for cc in home:
        for n in [n for n in home[cc] if world_country.get(n.lower()) == cc]:
            del home[cc][n]
    missing = {(cc, n) for cc, ns in READ_EVERYWHERE.items() for n in ns} - hand_world
    if missing:
        print('warning: READ_EVERYWHERE names not found or not needed:', sorted(missing))
    print(dict(why))
    print('world', len(world), 'home', sum(len(v) for v in home.values()), 'countries', len(home))
    write_ts(world, home, out)


def ts_place(p):
    parts = [f"lat: {p['lat']}", f"lng: {p['lng']}", f"country: '{p['country']}'", f"name: {json.dumps(p['name'], ensure_ascii=False)}"]
    if p.get('region'):
        parts.append(f"region: {json.dumps(p['region'], ensure_ascii=False)}")
    if p.get('surname'):
        parts.append('surname: true')
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
        '/** surname: also a surname, read as the place unless a capitalised first name comes right before it */',
        'export interface TownEntry { lat: number; lng: number; country: string; name: string; region?: string; surname?: true }',
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
