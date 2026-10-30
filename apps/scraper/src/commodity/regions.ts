/**
 * Where each crop grows (Oct 23, 2026): the main growing areas of the main producing countries,
 * each as one point in the middle of the area, with roughly how much of the country's crop it grows
 * and what the crop is doing in each month (a crop calendar: planting, growing, flowering, filling,
 * harvest). The points are where the commodity watch reads the weather forecast.
 *
 * Calendars are approximate, after USDA FAS's crop calendars (its International Production
 * Assessment Division), one letter a month from January: O out of season, P planting, G growing,
 * B flowering (pollination, heading, bloom), F filling (grain, pods, bolls, beans), H harvest.
 * Shares are of the country's crop and need not add up to 1 (the rest grows elsewhere). Flags:
 * I mostly irrigated (a dry forecast is no risk there), B sugar beet, R robusta coffee.
 *
 * The countries are those growing most of the world's crop in USDA's October 2026 figures (for
 * cocoa, tea and rubber, the main producers). More regions and crops get added over time.
 */

import type { Stage } from './catalog'

export interface CropRegion {
  /** "coffee:BR:sul-de-minas" */
  id: string
  commodity: string
  /** ISO 3166-1 alpha-2 */
  iso: string
  /** The name the news uses for the place: "Minas Gerais", "Iowa" */
  place: string
  /** "South Minas Gerais (Varginha)" */
  name: string
  /** The country the region is in: iso, except for the EU (USDA's one entry), where it's the member state */
  country: string
  lat: number
  lon: number
  /** Roughly how much of the country's crop grows here (0 to 1) */
  share: number
  /** Jan..Dec */
  calendar: Stage[]
  /** Mostly irrigated: a dry forecast isn't a risk */
  irrigated: boolean
  /** The crop differs from the commodity's usual one: sugar beet (not cane), robusta coffee (not arabica) */
  variant: 'beet' | 'robusta' | null
}

type Row = [commodity: string, iso: string, place: string, name: string, lat: number, lon: number, share: number, calendar: string, flags?: string]

const ROWS: Row[] = [
  // ── Coffee ─────────────────────────────────────────────────────────────────
  ['coffee', 'BR', 'Minas Gerais', 'South Minas Gerais (Varginha)', -21.55, -45.43, 0.3, 'FFFGHHHHBBGF'],
  ['coffee', 'BR', 'Minas Gerais', 'Cerrado Mineiro (Patrocínio)', -18.94, -46.99, 0.15, 'FFFGHHHHBBGF'],
  ['coffee', 'BR', 'Mogiana', 'Mogiana, São Paulo (Franca)', -20.54, -47.4, 0.08, 'FFFGHHHHBBGF'],
  ['coffee', 'BR', 'Espírito Santo', 'Espírito Santo conilon (Colatina)', -19.54, -40.63, 0.25, 'FFFHHHHBBBGF', 'R'],
  ['coffee', 'VN', 'Central Highlands', 'Đắk Lắk (Buôn Ma Thuột)', 12.67, 108.04, 0.4, 'BBBGGFFFGHHH', 'R'],
  ['coffee', 'VN', 'Lâm Đồng', 'Lâm Đồng (Bảo Lộc)', 11.55, 107.81, 0.25, 'BBBGGFFFGHHH', 'R'],
  ['coffee', 'VN', 'Gia Lai', 'Gia Lai (Pleiku)', 13.98, 108.0, 0.15, 'BBBGGFFFGHHH', 'R'],
  ['coffee', 'CO', 'Huila', 'Huila (Pitalito)', 1.85, -76.05, 0.2, 'GBBHHGGBHHHH'],
  ['coffee', 'CO', 'Antioquia', 'Antioquia (Andes)', 5.63, -75.88, 0.15, 'GBBHHGGBHHHH'],
  ['coffee', 'CO', 'Caldas', 'Coffee axis (Manizales)', 5.07, -75.52, 0.15, 'GBBHHGGBHHHH'],
  ['coffee', 'ET', 'Sidama', 'Sidama (Yirgalem)', 6.75, 38.41, 0.3, 'HBBBGFFFGHHH'],
  ['coffee', 'ET', 'Jimma', 'Jimma', 7.67, 36.83, 0.25, 'HBBBGFFFGHHH'],
  ['coffee', 'ID', 'Sumatra', 'South Sumatra (Pagar Alam)', -4.02, 103.25, 0.3, 'FFFHHHHHBBBF', 'R'],
  ['coffee', 'ID', 'Lampung', 'Lampung (Liwa)', -5.03, 104.08, 0.2, 'FFFHHHHHBBBF', 'R'],
  ['coffee', 'UG', 'Masaka', 'Central robusta (Masaka)', -0.34, 31.73, 0.3, 'HHBBGHHHGHHH', 'R'],
  ['coffee', 'UG', 'Mount Elgon', 'Mount Elgon arabica (Mbale)', 1.08, 34.18, 0.1, 'HHBBGHHHGHHH'],
  ['coffee', 'IN', 'Karnataka', 'Kodagu, Karnataka', 12.42, 75.74, 0.35, 'HBBBGFFFFGHH', 'R'],
  ['coffee', 'IN', 'Karnataka', 'Chikmagalur, Karnataka', 13.32, 75.77, 0.2, 'HBBBGFFFFGHH'],
  ['coffee', 'HN', 'Copán', 'Western Honduras (Santa Rosa de Copán)', 14.77, -88.78, 0.3, 'HHHBBGFFFHHH'],
  ['coffee', 'HN', 'La Paz', 'Marcala, La Paz', 14.15, -88.03, 0.2, 'HHHBBGFFFHHH'],
  ['coffee', 'PE', 'Junín', 'Chanchamayo, Junín', -11.06, -75.33, 0.3, 'FFFHHHHHHBBB'],
  ['coffee', 'PE', 'Cajamarca', 'Jaén, Cajamarca', -5.71, -78.81, 0.3, 'FFFHHHHHHBBB'],
  ['coffee', 'MX', 'Chiapas', 'Soconusco, Chiapas', 15.15, -92.25, 0.4, 'HHHBBGFFFHHH'],
  ['coffee', 'MX', 'Veracruz', 'Coatepec, Veracruz', 19.45, -96.96, 0.25, 'HHHBBGFFFHHH'],
  ['coffee', 'GT', 'Huehuetenango', 'Huehuetenango', 15.32, -91.47, 0.2, 'HHHBBGFFFHHH'],

  // ── Cocoa ──────────────────────────────────────────────────────────────────
  ['cocoa', 'CI', 'Soubré', 'Nawa (Soubré)', 5.78, -6.59, 0.3, 'HHHBBHFFFHHH'],
  ['cocoa', 'CI', 'Daloa', 'Haut-Sassandra (Daloa)', 6.88, -6.45, 0.2, 'HHHBBHFFFHHH'],
  ['cocoa', 'CI', 'San-Pédro', 'San-Pédro', 4.75, -6.64, 0.15, 'HHHBBHFFFHHH'],
  ['cocoa', 'CI', 'Abengourou', 'Indénié-Djuablin (Abengourou)', 6.73, -3.49, 0.1, 'HHHBBHFFFHHH'],
  ['cocoa', 'GH', 'Western North', 'Western North (Sefwi Wiawso)', 6.21, -2.49, 0.3, 'HHHBBHFFFHHH'],
  ['cocoa', 'GH', 'Ashanti', 'Ashanti (Bekwai)', 6.45, -1.58, 0.2, 'HHHBBHFFFHHH'],
  ['cocoa', 'GH', 'Western', 'Western (Tarkwa)', 5.3, -1.99, 0.15, 'HHHBBHFFFHHH'],
  ['cocoa', 'EC', 'Los Ríos', 'Los Ríos (Babahoyo)', -1.8, -79.53, 0.35, 'BFHHHHHGGGBB'],
  ['cocoa', 'EC', 'Guayas', 'Guayas (Naranjal)', -2.67, -79.62, 0.2, 'BFHHHHHGGGBB'],
  ['cocoa', 'CM', 'Centre', 'Centre (Mbalmayo)', 3.52, 11.5, 0.3, 'HHHBBHFFFHHH'],
  ['cocoa', 'CM', 'South-West', 'South-West (Kumba)', 4.64, 9.45, 0.3, 'HHHBBHFFFHHH'],
  ['cocoa', 'NG', 'Ondo', 'Ondo (Akure)', 7.25, 5.2, 0.4, 'HHHBBHFFFHHH'],
  ['cocoa', 'ID', 'Sulawesi', 'South-East Sulawesi (Kolaka)', -4.05, 121.6, 0.25, 'GBHHHHGBHHHG'],
  ['cocoa', 'BR', 'Bahia', 'South Bahia (Ilhéus)', -14.79, -39.05, 0.4, 'HHHGHHHHGHHH'],
  ['cocoa', 'BR', 'Pará', 'Pará (Medicilândia)', -3.45, -52.89, 0.5, 'HHHGHHHHGHHH'],

  // ── Wheat ──────────────────────────────────────────────────────────────────
  ['wheat', 'CN', 'Henan', 'Henan (Zhoukou)', 33.6, 114.6, 0.28, 'GGGBFHOOOPGG', 'I'],
  ['wheat', 'CN', 'Shandong', 'Shandong (Tai\'an)', 36.2, 117.0, 0.18, 'GGGBFHOOOPGG', 'I'],
  ['wheat', 'CN', 'Hebei', 'Hebei (Shijiazhuang)', 38.0, 114.5, 0.11, 'GGGBFHOOOPGG', 'I'],
  ['wheat', 'EU', 'France', 'Beauce, France (Chartres)', 48.45, 1.49, 0.2, 'GGGGBFHOOPPG'],
  ['wheat', 'EU', 'Germany', 'Saxony-Anhalt, Germany', 51.9, 11.6, 0.15, 'GGGGBFHHOPPG'],
  ['wheat', 'EU', 'Poland', 'Greater Poland (Poznań)', 52.4, 17.0, 0.08, 'GGGGBFHHOPGG'],
  ['wheat', 'EU', 'Romania', 'Bărăgan, Romania', 44.5, 27.3, 0.08, 'GGGBFHOOOPPG'],
  ['wheat', 'IN', 'Punjab', 'Punjab, India (Ludhiana)', 30.9, 75.85, 0.18, 'GBFHOOOOOOPG', 'I'],
  ['wheat', 'IN', 'Uttar Pradesh', 'Western Uttar Pradesh', 28.5, 78.5, 0.3, 'GBFHOOOOOOPG', 'I'],
  ['wheat', 'IN', 'Madhya Pradesh', 'Madhya Pradesh (Bhopal)', 23.25, 77.4, 0.2, 'GBFHOOOOOOPG'],
  ['wheat', 'RU', 'Krasnodar', 'Krasnodar', 45.0, 39.0, 0.12, 'GGGGBFHOPPGG'],
  ['wheat', 'RU', 'Rostov', 'Rostov', 47.2, 40.5, 0.12, 'GGGGBFHOPPGG'],
  ['wheat', 'RU', 'Stavropol', 'Stavropol', 45.0, 42.0, 0.1, 'GGGGBFHOPPGG'],
  ['wheat', 'RU', 'Volga', 'Volga (Saratov)', 51.5, 46.0, 0.08, 'GGGGBFHHPPGG'],
  ['wheat', 'RU', 'Siberia', 'West Siberia spring wheat (Altai)', 53.3, 81.5, 0.1, 'OOOOPGBFHOOO'],
  ['wheat', 'US', 'Kansas', 'Kansas (Hays)', 38.5, -98.8, 0.25, 'GGGGBFHOPPGG'],
  ['wheat', 'US', 'Oklahoma', 'Oklahoma (Enid)', 36.4, -97.9, 0.1, 'GGGBFHOOPPGG'],
  ['wheat', 'US', 'North Dakota', 'North Dakota spring wheat', 47.9, -99.4, 0.2, 'OOOPPGBHHOOO'],
  ['wheat', 'CA', 'Saskatchewan', 'Saskatchewan (Regina)', 50.9, -105.0, 0.45, 'OOOOPGBFHOOO'],
  ['wheat', 'CA', 'Alberta', 'Alberta (Red Deer)', 52.27, -113.8, 0.3, 'OOOOPGBFHOOO'],
  ['wheat', 'AU', 'New South Wales', 'Central West NSW (Parkes)', -33.0, 148.0, 0.3, 'OOOPPGGGBFHH'],
  ['wheat', 'AU', 'Western Australia', 'Western Australia wheatbelt', -31.5, 117.5, 0.35, 'OOOPPGGBFHHO'],
  ['wheat', 'PK', 'Punjab', 'Punjab, Pakistan (Faisalabad)', 31.4, 73.1, 0.75, 'GBFHOOOOOOPG', 'I'],
  ['wheat', 'UA', 'Kirovohrad', 'Central Ukraine (Kropyvnytskyi)', 48.5, 32.3, 0.25, 'GGGGBFHOPPGG'],
  ['wheat', 'UA', 'Odesa', 'Odesa region', 46.8, 30.5, 0.15, 'GGGGBFHOPPGG'],
  ['wheat', 'UA', 'Poltava', 'Poltava', 49.6, 34.5, 0.15, 'GGGGBFHOPPGG'],
  ['wheat', 'TR', 'Konya', 'Central Anatolia (Konya)', 37.9, 32.5, 0.35, 'GGGGBFHOOPGG'],
  ['wheat', 'AR', 'Buenos Aires', 'South Buenos Aires (Tres Arroyos)', -38.4, -60.3, 0.45, 'HOOOPPGGGBFH'],
  ['wheat', 'AR', 'Córdoba', 'Córdoba (Río Cuarto)', -33.1, -64.35, 0.15, 'HOOOPPGGGBFH'],
  ['wheat', 'KZ', 'Kostanay', 'North Kazakhstan (Kostanay)', 53.2, 63.6, 0.3, 'OOOOPGBFHOOO'],
  ['wheat', 'KZ', 'Akmola', 'Akmola', 51.9, 69.4, 0.3, 'OOOOPGBFHOOO'],

  // ── Corn ───────────────────────────────────────────────────────────────────
  ['corn', 'US', 'Iowa', 'Iowa (Ames)', 42.0, -93.6, 0.17, 'OOOPPGBFHHOO'],
  ['corn', 'US', 'Illinois', 'Illinois (Bloomington)', 40.5, -89.0, 0.15, 'OOOPPGBFHHOO'],
  ['corn', 'US', 'Nebraska', 'Nebraska (Grand Island)', 40.9, -98.3, 0.12, 'OOOPPGBFHHOO'],
  ['corn', 'US', 'Minnesota', 'Southern Minnesota', 44.2, -94.5, 0.09, 'OOOPPGBFHHOO'],
  // CM9 (Oct 30, 2026): the next corn states by USDA NASS's production (2023-25), about 72% of the crop with the four above
  ['corn', 'US', 'Indiana', 'Indiana', 40.3, -86.5, 0.07, 'OOOPPGBFHHOO'],
  ['corn', 'US', 'South Dakota', 'Eastern South Dakota', 44.0, -97.5, 0.05, 'OOOPPGBFHHOO'],
  ['corn', 'US', 'Ohio', 'Western Ohio (Lima)', 40.7, -84.1, 0.04, 'OOOPPGBFHHOO'],
  ['corn', 'US', 'Wisconsin', 'Southern Wisconsin (Janesville)', 42.7, -89.0, 0.035, 'OOOPPGBFHHOO'],
  ['corn', 'CN', 'Jilin', 'Jilin (Changchun)', 43.9, 125.3, 0.25, 'OOOPPGBFHHOO'],
  ['corn', 'CN', 'Heilongjiang', 'Heilongjiang (Suihua)', 46.6, 127.0, 0.2, 'OOOPPGBFHHOO'],
  ['corn', 'CN', 'Shandong', 'North China Plain summer corn (Shandong)', 35.5, 116.0, 0.25, 'OOOOOPGBFHOO'],
  ['corn', 'CN', 'Inner Mongolia', 'Inner Mongolia (Tongliao)', 43.6, 122.3, 0.1, 'OOOPPGBFHHOO'],
  ['corn', 'BR', 'Mato Grosso', 'Mato Grosso second crop (Sorriso)', -12.55, -55.71, 0.35, 'PPGBFHHHOOOO'],
  ['corn', 'BR', 'Paraná', 'Paraná (Cascavel)', -24.96, -53.46, 0.15, 'PPGBFHHHOOOO'],
  ['corn', 'BR', 'Goiás', 'Goiás (Rio Verde)', -17.8, -50.9, 0.1, 'PPGBFHHHOOOO'],
  ['corn', 'BR', 'Mato Grosso do Sul', 'Mato Grosso do Sul (Dourados)', -22.2, -54.8, 0.08, 'PPGBFHHHOOOO'],
  ['corn', 'AR', 'Córdoba', 'Córdoba (Villa María)', -32.4, -63.2, 0.35, 'BFHHHHOOPPGG'],
  ['corn', 'AR', 'Buenos Aires', 'North Buenos Aires (Pergamino)', -33.9, -60.6, 0.3, 'BFHHHHOOPPGG'],
  ['corn', 'AR', 'Santa Fe', 'Santa Fe (Venado Tuerto)', -33.75, -61.97, 0.15, 'BFHHHHOOPPGG'],
  ['corn', 'IN', 'Karnataka', 'Karnataka (Davangere)', 14.47, 75.92, 0.15, 'OOOOOPGBFHOO'],
  ['corn', 'EU', 'Romania', 'Southern Romania', 44.6, 26.0, 0.25, 'OOOPPGBFHHOO'],
  ['corn', 'EU', 'France', 'South-West France (Pau)', 43.5, -0.4, 0.2, 'OOOPPGBFHHOO'],
  ['corn', 'EU', 'Hungary', 'Great Hungarian Plain', 46.9, 20.0, 0.12, 'OOOPPGBFHHOO'],
  ['corn', 'UA', 'Cherkasy', 'Central Ukraine (Cherkasy)', 49.4, 32.0, 0.25, 'OOOPPGBFHHHO'],
  ['corn', 'UA', 'Poltava', 'Poltava', 49.6, 34.5, 0.2, 'OOOPPGBFHHHO'],
  ['corn', 'UA', 'Chernihiv', 'Chernihiv', 51.5, 31.3, 0.1, 'OOOPPGBFHHHO'],
  ['corn', 'MX', 'Sinaloa', 'Sinaloa (Culiacán)', 25.0, -107.5, 0.25, 'GBFHHOOOOOPP', 'I'],
  ['corn', 'MX', 'Jalisco', 'Jalisco', 20.4, -103.0, 0.15, 'OOOOOPGBFHHO'],
  ['corn', 'ZA', 'Free State', 'Free State (Bothaville)', -27.4, 26.6, 0.4, 'BFFHHHHOOPPG'],
  ['corn', 'ZA', 'Mpumalanga', 'Mpumalanga highveld', -26.5, 29.2, 0.25, 'BFFHHHHOOPPG'],

  // ── Soybeans ───────────────────────────────────────────────────────────────
  ['soybeans', 'BR', 'Mato Grosso', 'Mato Grosso (Sorriso)', -12.55, -55.71, 0.27, 'FHHOOOOOPPGB'],
  ['soybeans', 'BR', 'Paraná', 'Paraná (Cascavel)', -24.96, -53.46, 0.13, 'BFHHOOOOOPPG'],
  ['soybeans', 'BR', 'Rio Grande do Sul', 'Rio Grande do Sul (Cruz Alta)', -28.64, -53.6, 0.12, 'BFFHHOOOOOPP'],
  ['soybeans', 'BR', 'Goiás', 'Goiás (Rio Verde)', -17.8, -50.9, 0.1, 'FHHOOOOOOPGB'],
  ['soybeans', 'BR', 'Mato Grosso do Sul', 'Mato Grosso do Sul (Dourados)', -22.2, -54.8, 0.07, 'FHHOOOOOOPGB'],
  ['soybeans', 'BR', 'Bahia', 'West Bahia (Luís Eduardo Magalhães)', -12.1, -45.8, 0.06, 'BFHHOOOOOOPG'],
  ['soybeans', 'US', 'Illinois', 'Illinois (Bloomington)', 40.5, -89.0, 0.14, 'OOOOPPBFHHOO'],
  ['soybeans', 'US', 'Iowa', 'Iowa (Ames)', 42.0, -93.6, 0.13, 'OOOOPPBFHHOO'],
  ['soybeans', 'US', 'Minnesota', 'Southern Minnesota', 44.2, -94.5, 0.09, 'OOOOPPBFHHOO'],
  ['soybeans', 'US', 'Indiana', 'Indiana', 40.3, -86.5, 0.08, 'OOOOPPBFHHOO'],
  ['soybeans', 'US', 'Nebraska', 'Eastern Nebraska', 41.5, -97.0, 0.07, 'OOOOPPBFHHOO'],
  // CM9 (Oct 30, 2026): the next soybean states by USDA NASS's production (2023-25), about 75% of the crop with the five above
  ['soybeans', 'US', 'Ohio', 'Western Ohio (Lima)', 40.7, -84.1, 0.065, 'OOOOPPBFHHOO'],
  ['soybeans', 'US', 'Missouri', 'Northern Missouri (Chillicothe)', 39.8, -93.5, 0.04, 'OOOOPPBFHHOO'],
  ['soybeans', 'US', 'South Dakota', 'Eastern South Dakota', 44.0, -97.5, 0.05, 'OOOOPPBFHHOO'],
  ['soybeans', 'US', 'North Dakota', 'Red River Valley, North Dakota (Fargo)', 46.9, -96.8, 0.045, 'OOOOPPBFHHOO'],
  ['soybeans', 'US', 'Arkansas', 'Arkansas Delta (Jonesboro)', 35.8, -90.7, 0.035, 'OOOPPBFFHHOO', 'I'],
  ['soybeans', 'AR', 'Córdoba', 'Córdoba (Villa María)', -32.4, -63.2, 0.3, 'BFFHHOOOOOPP'],
  ['soybeans', 'AR', 'Buenos Aires', 'North Buenos Aires (Pergamino)', -33.9, -60.6, 0.3, 'BFFHHOOOOOPP'],
  ['soybeans', 'AR', 'Santa Fe', 'Santa Fe (Rafaela)', -31.25, -61.5, 0.2, 'BFFHHOOOOOPP'],
  ['soybeans', 'CN', 'Heilongjiang', 'Heilongjiang (Suihua)', 46.6, 127.0, 0.45, 'OOOOPGBFHHOO'],
  ['soybeans', 'PY', 'Alto Paraná', 'Alto Paraná and Itapúa', -25.5, -55.0, 0.8, 'FHHOOOOOPPGB'],
  ['soybeans', 'IN', 'Madhya Pradesh', 'Malwa, Madhya Pradesh (Ujjain)', 23.2, 75.8, 0.5, 'OOOOOPGBFHOO'],
  ['soybeans', 'IN', 'Maharashtra', 'Marathwada, Maharashtra (Latur)', 18.4, 76.6, 0.35, 'OOOOOPGBFHOO'],

  // ── Rice ───────────────────────────────────────────────────────────────────
  ['rice', 'CN', 'Hunan', 'Hunan (Yiyang)', 28.6, 112.4, 0.15, 'OOOPGBHGBHOO', 'I'],
  ['rice', 'CN', 'Jiangxi', 'Jiangxi (Nanchang)', 28.7, 116.0, 0.12, 'OOOPGBHGBHOO', 'I'],
  ['rice', 'CN', 'Heilongjiang', 'Sanjiang Plain, Heilongjiang (Jiamusi)', 46.8, 130.4, 0.15, 'OOOOPGBFHOOO', 'I'],
  ['rice', 'CN', 'Jiangsu', 'Jiangsu (Yangzhou)', 32.5, 119.5, 0.1, 'OOOOOPGBFHOO', 'I'],
  ['rice', 'IN', 'West Bengal', 'West Bengal (Bardhaman)', 23.2, 87.9, 0.12, 'OOOOOPPGBFHH'],
  ['rice', 'IN', 'Uttar Pradesh', 'Eastern Uttar Pradesh', 26.8, 82.0, 0.1, 'OOOOOPPGBFHH'],
  ['rice', 'IN', 'Punjab', 'Punjab, India (Ludhiana)', 30.9, 75.85, 0.08, 'OOOOOPPGBFHO', 'I'],
  ['rice', 'IN', 'Andhra Pradesh', 'Godavari delta, Andhra Pradesh', 16.9, 81.8, 0.1, 'OOOOOPPGBFHH', 'I'],
  ['rice', 'IN', 'Odisha', 'Odisha (Cuttack)', 20.5, 85.9, 0.06, 'OOOOOPPGBFHH'],
  ['rice', 'BD', 'Mymensingh', 'Mymensingh', 24.75, 90.4, 0.5, 'PGBFHOPGBFHH'],
  ['rice', 'ID', 'Central Java', 'Central Java (Demak)', -6.9, 110.6, 0.25, 'GBHHPGBHOOPP', 'I'],
  ['rice', 'ID', 'East Java', 'East Java (Ngawi)', -7.4, 111.45, 0.25, 'GBHHPGBHOOPP', 'I'],
  ['rice', 'ID', 'South Sulawesi', 'South Sulawesi', -4.0, 119.9, 0.1, 'GBHHPGBHOOPP'],
  ['rice', 'VN', 'Mekong Delta', 'Mekong Delta (Cần Thơ)', 10.03, 105.78, 0.55, 'GHHPGBHHPGBF', 'I'],
  ['rice', 'VN', 'Red River Delta', 'Red River Delta (Thái Bình)', 20.45, 106.34, 0.15, 'OPGBFHPGBFHO', 'I'],
  ['rice', 'TH', 'Central Plain', 'Central Plain (Suphan Buri)', 14.47, 100.1, 0.3, 'GHHOPPGGBFHH', 'I'],
  ['rice', 'TH', 'Northeast', 'Northeast jasmine rice (Roi Et)', 16.05, 103.65, 0.45, 'OOOOOPPGGBHH'],
  ['rice', 'PH', 'Central Luzon', 'Central Luzon (Nueva Ecija)', 15.58, 121.0, 0.4, 'GBHHOPPGBHHP', 'I'],
  ['rice', 'MM', 'Ayeyarwady', 'Ayeyarwady delta', 16.8, 95.2, 0.5, 'OOOOPPGGBFHH'],
  ['rice', 'PK', 'Punjab', 'Punjab basmati belt (Gujranwala)', 31.8, 74.0, 0.55, 'OOOOOPPGBFHO', 'I'],
  ['rice', 'PK', 'Sindh', 'Upper Sindh (Larkana)', 27.55, 68.2, 0.35, 'OOOOPPGBFHOO', 'I'],
  ['rice', 'KH', 'Battambang', 'Battambang', 13.1, 103.2, 0.4, 'OOOOPPGGBFHH'],
  ['rice', 'US', 'Arkansas', 'Arkansas (Stuttgart)', 34.5, -91.55, 0.5, 'OOOPPGBFHHOO', 'I'],
  ['rice', 'US', 'California', 'Sacramento Valley', 39.4, -122.0, 0.2, 'OOOOPGBFHHOO', 'I'],
  ['rice', 'BR', 'Rio Grande do Sul', 'Rio Grande do Sul (Uruguaiana)', -29.75, -57.08, 0.7, 'BFHHOOOOOPPG', 'I'],
  ['rice', 'JP', 'Niigata', 'Niigata', 37.9, 139.0, 0.3, 'OOOOPGBFHOOO', 'I'],

  // ── Cotton ─────────────────────────────────────────────────────────────────
  ['cotton', 'CN', 'Xinjiang', 'South Xinjiang (Aksu)', 41.17, 80.26, 0.4, 'OOOPPGBFHHOO', 'I'],
  ['cotton', 'CN', 'Xinjiang', 'North Xinjiang (Shihezi)', 44.3, 86.05, 0.3, 'OOOPPGBFHHOO', 'I'],
  ['cotton', 'IN', 'Gujarat', 'Saurashtra, Gujarat (Rajkot)', 22.3, 70.8, 0.3, 'HHOOOPGBFHHH'],
  ['cotton', 'IN', 'Maharashtra', 'Vidarbha, Maharashtra (Yavatmal)', 20.4, 78.1, 0.3, 'HHOOOPGBFHHH'],
  ['cotton', 'IN', 'Telangana', 'Telangana (Adilabad)', 19.67, 78.53, 0.15, 'HHOOOPGBFHHH'],
  ['cotton', 'BR', 'Mato Grosso', 'Mato Grosso (Sapezal)', -13.55, -58.82, 0.7, 'PPBBFHHHHOOO'],
  ['cotton', 'BR', 'Bahia', 'West Bahia (Luís Eduardo Magalhães)', -12.1, -45.8, 0.2, 'GBBFFHHHOOPP'],
  ['cotton', 'US', 'Texas', 'West Texas (Lubbock)', 33.58, -101.85, 0.4, 'OOOOPPBFHHHO'],
  ['cotton', 'US', 'Georgia', 'South Georgia (Tifton)', 31.45, -83.5, 0.12, 'OOOPPGBFHHOO'],
  ['cotton', 'US', 'Mississippi', 'Mississippi Delta (Greenville)', 33.4, -90.9, 0.1, 'OOOPPGBFHHOO'],
  ['cotton', 'PK', 'Punjab', 'South Punjab (Multan)', 30.2, 71.5, 0.65, 'OOOPPGBFHHHO', 'I'],
  ['cotton', 'PK', 'Sindh', 'Sindh (Sanghar)', 26.05, 68.95, 0.3, 'OOPPGBFHHOOO', 'I'],
  ['cotton', 'UZ', 'Uzbekistan', 'Syrdarya and Jizzakh', 40.5, 68.7, 0.4, 'OOOPPGBFHHOO', 'I'],
  ['cotton', 'AU', 'New South Wales', 'Namoi Valley, NSW (Narrabri)', -30.33, 149.78, 0.6, 'BFHHHOOOOPPG', 'I'],
  ['cotton', 'AU', 'Queensland', 'Darling Downs, Queensland', -27.9, 150.7, 0.2, 'BFHHHOOOOPPG', 'I'],
  ['cotton', 'TR', 'Şanlıurfa', 'Harran plain (Şanlıurfa)', 36.9, 39.0, 0.45, 'OOOPPGBFHHOO', 'I'],

  // ── Sugar ──────────────────────────────────────────────────────────────────
  ['sugar', 'BR', 'São Paulo', 'São Paulo cane belt (Ribeirão Preto)', -21.18, -47.81, 0.4, 'GGGHHHHHHHHG'],
  ['sugar', 'BR', 'Goiás', 'Goiás (Quirinópolis)', -18.45, -50.45, 0.1, 'GGGHHHHHHHHG'],
  ['sugar', 'BR', 'Minas Gerais', 'Triângulo Mineiro (Uberaba)', -19.75, -47.93, 0.1, 'GGGHHHHHHHHG'],
  ['sugar', 'BR', 'Mato Grosso do Sul', 'Mato Grosso do Sul (Rio Brilhante)', -21.8, -54.55, 0.06, 'GGGHHHHHHHHG'],
  ['sugar', 'IN', 'Uttar Pradesh', 'Western Uttar Pradesh (Muzaffarnagar)', 29.47, 77.7, 0.4, 'HHHHGGGGGGHH', 'I'],
  ['sugar', 'IN', 'Maharashtra', 'Maharashtra (Kolhapur)', 16.7, 74.24, 0.3, 'HHHHGGGGGHHH', 'I'],
  ['sugar', 'IN', 'Karnataka', 'Karnataka (Belagavi)', 15.85, 74.5, 0.12, 'HHHHGGGGGHHH', 'I'],
  ['sugar', 'EU', 'France', 'Picardy beet, France', 49.9, 2.8, 0.25, 'OOPPGGGGHHHH', 'B'],
  ['sugar', 'EU', 'Germany', 'Lower Saxony beet, Germany', 52.15, 9.95, 0.2, 'OOPPGGGGHHHH', 'B'],
  ['sugar', 'EU', 'Poland', 'Lower Silesia beet, Poland', 51.0, 16.8, 0.15, 'OOPPGGGGHHHH', 'B'],
  ['sugar', 'CN', 'Guangxi', 'Guangxi (Chongzuo)', 22.4, 107.4, 0.6, 'HHHHGGGGGGHH'],
  ['sugar', 'CN', 'Yunnan', 'Yunnan (Lincang)', 23.9, 100.1, 0.2, 'HHHHGGGGGGHH'],
  ['sugar', 'TH', 'Northeast', 'Northeast Thailand (Khon Kaen)', 16.43, 102.83, 0.45, 'HHHHPGGGGGGH'],
  ['sugar', 'TH', 'Central', 'West Central Thailand (Kanchanaburi)', 14.0, 99.55, 0.3, 'HHHHPGGGGGGH'],
  ['sugar', 'US', 'Florida', 'Florida cane (Belle Glade)', 26.7, -80.7, 0.25, 'HHHHGGGGGHHH', 'I'],
  ['sugar', 'US', 'Louisiana', 'Louisiana cane', 30.0, -91.2, 0.2, 'HOPGGGGGGHHH'],
  ['sugar', 'US', 'Red River Valley', 'Red River Valley beet', 47.9, -97.0, 0.3, 'OOOPPGGGHHOO', 'B'],
  ['sugar', 'PK', 'Punjab', 'Central Punjab cane', 31.0, 72.7, 0.6, 'HHHGGGGGGGHH', 'I'],
  ['sugar', 'PK', 'Sindh', 'Lower Sindh cane', 25.4, 68.4, 0.3, 'HHHGGGGGGGHH', 'I'],
  ['sugar', 'RU', 'Voronezh', 'Central Black Earth beet (Voronezh)', 51.7, 39.2, 0.4, 'OOOPPGGGHHOO', 'B'],
  ['sugar', 'RU', 'Krasnodar', 'Krasnodar beet', 45.3, 39.5, 0.25, 'OOOPPGGGHHOO', 'B'],
  ['sugar', 'MX', 'Veracruz', 'Veracruz cane (Córdoba)', 18.9, -96.9, 0.4, 'HHHHHGGGGGHH'],
  ['sugar', 'AU', 'Queensland', 'Mackay, Queensland', -21.15, 149.18, 0.35, 'GGGGGHHHHHHG'],
  ['sugar', 'AU', 'Queensland', 'Burdekin, Queensland', -19.6, 147.4, 0.25, 'GGGGGHHHHHHG', 'I'],

  // ── Palm oil (all year: the fruit is cut every two to three weeks) ─────────
  ['palm-oil', 'ID', 'Riau', 'Riau, Sumatra (Pekanbaru)', 0.5, 101.45, 0.25, 'GGGGGGGGGGGG'],
  ['palm-oil', 'ID', 'North Sumatra', 'North Sumatra', 2.9, 99.4, 0.12, 'GGGGGGGGGGGG'],
  ['palm-oil', 'ID', 'Kalimantan', 'Central Kalimantan (Sampit)', -2.5, 112.9, 0.15, 'GGGGGGGGGGGG'],
  ['palm-oil', 'ID', 'Kalimantan', 'West Kalimantan', 0.0, 110.5, 0.12, 'GGGGGGGGGGGG'],
  ['palm-oil', 'MY', 'Sabah', 'Sabah (Lahad Datu)', 5.03, 118.33, 0.25, 'GGGGGGGGGGGG'],
  ['palm-oil', 'MY', 'Sarawak', 'Sarawak (Bintulu)', 3.2, 113.1, 0.25, 'GGGGGGGGGGGG'],
  ['palm-oil', 'MY', 'Johor', 'Johor', 2.0, 103.3, 0.15, 'GGGGGGGGGGGG'],
  ['palm-oil', 'TH', 'Surat Thani', 'Surat Thani', 9.0, 99.0, 0.4, 'GGGGGGGGGGGG'],
  ['palm-oil', 'CO', 'Meta', 'Meta (Puerto Gaitán)', 4.15, -72.5, 0.35, 'GGGGGGGGGGGG'],

  // ── Rapeseed ───────────────────────────────────────────────────────────────
  ['rapeseed', 'CA', 'Saskatchewan', 'Saskatchewan (Saskatoon)', 52.1, -106.6, 0.5, 'OOOOPGBFHOOO'],
  ['rapeseed', 'CA', 'Alberta', 'Alberta (Red Deer)', 52.27, -113.8, 0.3, 'OOOOPGBFHOOO'],
  ['rapeseed', 'CA', 'Manitoba', 'Manitoba (Brandon)', 49.85, -99.95, 0.15, 'OOOOPGBFHOOO'],
  ['rapeseed', 'EU', 'Germany', 'Mecklenburg, Germany', 53.6, 12.4, 0.25, 'GGGBBFHPPGGG'],
  ['rapeseed', 'EU', 'France', 'Champagne and Burgundy, France (Troyes)', 48.3, 4.08, 0.25, 'GGGBBFHPPGGG'],
  ['rapeseed', 'EU', 'Poland', 'Kuyavia, Poland', 53.0, 18.0, 0.15, 'GGGBBFHPPGGG'],
  ['rapeseed', 'CN', 'Hubei', 'Hubei (Jingzhou)', 30.35, 112.2, 0.25, 'GGBFHOOOOPGG'],
  ['rapeseed', 'CN', 'Sichuan', 'Sichuan basin', 30.5, 104.5, 0.2, 'GGBFHOOOOPGG'],
  ['rapeseed', 'IN', 'Rajasthan', 'Eastern Rajasthan mustard (Bharatpur)', 27.2, 77.5, 0.45, 'BFHOOOOOOPPG'],
  ['rapeseed', 'AU', 'Western Australia', 'Western Australia wheatbelt', -31.0, 117.0, 0.4, 'OOOPPGGBFHHO'],
  ['rapeseed', 'AU', 'New South Wales', 'Riverina, NSW', -34.6, 146.4, 0.25, 'OOOPPGGBFHHO'],
  ['rapeseed', 'RU', 'Altai', 'Altai spring rapeseed', 52.5, 82.5, 0.3, 'OOOOPGBFHOOO'],
  ['rapeseed', 'UA', 'Odesa', 'Southern Ukraine (Odesa)', 46.8, 30.5, 0.3, 'GGGBBHHPPGGG'],
  ['rapeseed', 'UA', 'Vinnytsia', 'Vinnytsia', 49.2, 28.5, 0.2, 'GGGBBHHPPGGG'],

  // ── Sunflower seed ─────────────────────────────────────────────────────────
  ['sunflowerseed', 'RU', 'Rostov', 'Rostov', 47.5, 40.5, 0.15, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'RU', 'Saratov', 'Saratov', 51.6, 46.0, 0.15, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'RU', 'Voronezh', 'Voronezh', 51.5, 40.0, 0.12, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'RU', 'Volgograd', 'Volgograd', 49.5, 44.0, 0.1, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'UA', 'Dnipro', 'Dnipropetrovsk', 48.45, 35.05, 0.15, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'UA', 'Kharkiv', 'Kharkiv', 49.7, 36.5, 0.12, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'UA', 'Kirovohrad', 'Kirovohrad', 48.5, 32.3, 0.12, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'EU', 'Romania', 'South-East Romania', 44.5, 27.5, 0.3, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'EU', 'Bulgaria', 'Dobruja, Bulgaria (Dobrich)', 43.57, 27.83, 0.2, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'EU', 'Hungary', 'Eastern Hungary', 47.0, 21.0, 0.15, 'OOOPPGBFHHOO'],
  ['sunflowerseed', 'AR', 'Buenos Aires', 'South Buenos Aires', -37.5, -61.0, 0.45, 'BFHHOOOOPPGG'],
  ['sunflowerseed', 'KZ', 'East Kazakhstan', 'East Kazakhstan', 49.95, 82.6, 0.6, 'OOOOPGBFHHOO'],

  // ── Barley ─────────────────────────────────────────────────────────────────
  ['barley', 'EU', 'Spain', 'Castile and León, Spain (Valladolid)', 41.65, -4.72, 0.2, 'GGGBFHOOOPGG'],
  ['barley', 'EU', 'France', 'Champagne, France', 49.0, 4.0, 0.2, 'GGGGBFHOPPGG'],
  ['barley', 'EU', 'Germany', 'Lower Saxony, Germany', 52.3, 10.0, 0.18, 'GGGGBFHOPPGG'],
  ['barley', 'RU', 'Volga', 'Middle Volga spring barley (Samara)', 53.2, 50.1, 0.3, 'OOOPPGBFHOOO'],
  ['barley', 'RU', 'Rostov', 'Rostov winter barley', 47.2, 40.5, 0.2, 'GGGGBHHOPPGG'],
  ['barley', 'AU', 'South Australia', 'Murray Mallee, South Australia', -34.9, 139.5, 0.3, 'OOOPPGGGBFHH'],
  ['barley', 'AU', 'Western Australia', 'Western Australia (Esperance)', -33.6, 121.9, 0.4, 'OOOPPGGBFHHO'],
  ['barley', 'CA', 'Alberta', 'Alberta (Red Deer)', 52.27, -113.8, 0.5, 'OOOOPGBFHOOO'],
  ['barley', 'CA', 'Saskatchewan', 'Saskatchewan (Saskatoon)', 52.1, -106.6, 0.4, 'OOOOPGBFHOOO'],
  ['barley', 'TR', 'Konya', 'Central Anatolia (Konya)', 37.9, 32.5, 0.3, 'GGGGBFHOOPGG'],
  ['barley', 'UA', 'Southern Ukraine', 'Southern Ukraine (Mykolaiv)', 47.0, 32.0, 0.3, 'GGGBFHHOPPGG'],
  ['barley', 'GB', 'East Anglia', 'East Anglia (Norfolk)', 52.6, 0.9, 0.35, 'GGGGGBFHHPGG'],
  ['barley', 'AR', 'Buenos Aires', 'South Buenos Aires (Tres Arroyos)', -38.4, -60.3, 0.8, 'HOOOPPGGGBFH'],

  // ── Sorghum ────────────────────────────────────────────────────────────────
  ['sorghum', 'US', 'Kansas', 'Western Kansas', 38.0, -100.0, 0.5, 'OOOOPPGBFHHO'],
  ['sorghum', 'US', 'Texas', 'Texas Coastal Bend (Corpus Christi)', 27.9, -97.6, 0.25, 'OPPGBFHOOOOO'],
  ['sorghum', 'NG', 'Kano', 'Kano and Katsina', 12.0, 8.5, 0.5, 'OOOOPPGGBFHO'],
  ['sorghum', 'BR', 'Goiás', 'Goiás second crop', -17.8, -50.9, 0.5, 'PGGBFHHOOOOO'],
  ['sorghum', 'IN', 'Maharashtra', 'Solapur, Maharashtra (winter crop)', 17.67, 75.9, 0.4, 'FHOOOOOOPGBF'],
  ['sorghum', 'ET', 'Amhara', 'Amhara lowlands', 11.6, 37.4, 0.4, 'OOOPPGGBFHHO'],
  ['sorghum', 'MX', 'Tamaulipas', 'North Tamaulipas', 25.5, -98.0, 0.45, 'OPPGBFHOOOOO'],
  ['sorghum', 'AR', 'Santa Fe', 'North Santa Fe', -29.5, -60.5, 0.5, 'BFHHHOOOOPPG'],
  ['sorghum', 'SD', 'Gedaref', 'Gedaref', 14.03, 35.38, 0.5, 'OOOOOPGBFHHO'],
  ['sorghum', 'AU', 'Queensland', 'Darling Downs, Queensland', -27.5, 151.5, 0.6, 'BFHHOOOOOPPG'],

  // ── Peanuts ────────────────────────────────────────────────────────────────
  ['peanuts', 'CN', 'Henan', 'Henan (Zhumadian)', 33.0, 114.0, 0.35, 'OOOPPGBFHOOO'],
  ['peanuts', 'CN', 'Shandong', 'Shandong (Linyi)', 35.1, 118.35, 0.2, 'OOOPPGBFHOOO'],
  ['peanuts', 'IN', 'Gujarat', 'Saurashtra, Gujarat (Junagadh)', 21.5, 70.45, 0.45, 'OOOOOPGBFHHO'],
  ['peanuts', 'IN', 'Andhra Pradesh', 'Anantapur, Andhra Pradesh', 14.68, 77.6, 0.2, 'OOOOOPGBFHHO'],
  ['peanuts', 'NG', 'Kano', 'Kano', 12.0, 8.5, 0.6, 'OOOOPPGBFHOO'],
  ['peanuts', 'US', 'Georgia', 'South Georgia', 31.5, -84.0, 0.5, 'OOOPPGBFHHOO'],
  ['peanuts', 'AR', 'Córdoba', 'Córdoba (Río Cuarto)', -33.1, -64.35, 0.9, 'BFFHHOOOOPPG'],
  ['peanuts', 'SN', 'Kaolack', 'Groundnut basin (Kaolack)', 14.15, -16.07, 0.6, 'OOOOOPGBFHOO'],

  // ── Oranges and orange juice ───────────────────────────────────────────────
  ['orange-juice', 'BR', 'São Paulo', 'São Paulo citrus belt (Bebedouro)', -20.95, -48.48, 0.75, 'HHGGHHHBBBFH'],
  ['orange-juice', 'US', 'Florida', 'Central Florida (Polk)', 27.9, -81.6, 0.8, 'HBBHHHGGGHHH', 'I'],
  ['orange-juice', 'MX', 'Veracruz', 'North Veracruz (Álamo)', 20.92, -97.68, 0.6, 'HBBFGGGGGHHH'],
  ['oranges', 'BR', 'São Paulo', 'São Paulo citrus belt (Bebedouro)', -20.95, -48.48, 0.75, 'HHGGHHHBBBFH'],
  ['oranges', 'CN', 'Jiangxi', 'South Jiangxi (Ganzhou)', 25.83, 114.93, 0.3, 'HOOBFGGGGGHH'],
  ['oranges', 'EU', 'Spain', 'Valencia, Spain', 39.25, -0.42, 0.5, 'HHHBBFGGGHHH', 'I'],
  ['oranges', 'MX', 'Veracruz', 'North Veracruz (Álamo)', 20.92, -97.68, 0.5, 'HBBFGGGGGHHH'],
  ['oranges', 'EG', 'Nile Delta', 'Nile Delta (Qalyubia)', 30.4, 31.2, 0.5, 'HHHBBFGGGGGH', 'I'],
  ['oranges', 'US', 'Florida', 'Central Florida (Polk)', 27.9, -81.6, 0.6, 'HBBHHHGGGHHH', 'I'],
  ['oranges', 'ZA', 'Limpopo', 'Limpopo (Letsitele)', -23.9, 30.4, 0.4, 'FGGHHHHHHBBF', 'I'],

  // ── Tea ────────────────────────────────────────────────────────────────────
  ['tea', 'CN', 'Fujian', 'Fujian (Anxi)', 25.06, 118.19, 0.2, 'OOBHHHHHGGGO'],
  ['tea', 'CN', 'Yunnan', "Yunnan (Pu'er)", 22.8, 100.97, 0.2, 'OOBHHHHHGGGO'],
  ['tea', 'IN', 'Assam', 'Upper Assam (Dibrugarh)', 27.48, 94.9, 0.5, 'OOGHHHHHHHHO'],
  ['tea', 'IN', 'West Bengal', 'Dooars, West Bengal', 26.7, 89.0, 0.2, 'OOGHHHHHHHHO'],
  ['tea', 'KE', 'Kericho', 'Kericho', -0.37, 35.28, 0.4, 'GGGGGGGGGGGG'],
  ['tea', 'KE', 'Mount Kenya', 'East of Mount Kenya (Embu)', -0.5, 37.45, 0.3, 'GGGGGGGGGGGG'],
  ['tea', 'LK', 'Nuwara Eliya', 'Nuwara Eliya (high grown)', 6.97, 80.78, 0.3, 'GGGGGGGGGGGG'],
  ['tea', 'LK', 'Ratnapura', 'Ratnapura (low grown)', 6.68, 80.4, 0.3, 'GGGGGGGGGGGG'],
  ['tea', 'VN', 'Thái Nguyên', 'Thái Nguyên', 21.6, 105.85, 0.4, 'OOGHHHHHHHGO'],
  ['tea', 'TR', 'Rize', 'Rize', 41.02, 40.52, 0.9, 'OOOOHHHHHGOO'],

  // ── Natural rubber (tapping slows while the trees shed leaves in the dry season) ─
  ['rubber', 'TH', 'Southern Thailand', 'Southern Thailand (Surat Thani)', 8.8, 99.0, 0.35, 'GOOGGGGGGGGG'],
  ['rubber', 'TH', 'Songkhla', 'Songkhla', 7.0, 100.5, 0.15, 'GOOGGGGGGGGG'],
  ['rubber', 'TH', 'Northeast', 'Northeast Thailand (Buri Ram)', 15.0, 103.1, 0.25, 'GOOGGGGGGGGG'],
  ['rubber', 'ID', 'South Sumatra', 'South Sumatra', -3.0, 104.0, 0.3, 'GOOGGGGGGGGG'],
  ['rubber', 'ID', 'North Sumatra', 'North Sumatra', 2.5, 99.5, 0.2, 'GOOGGGGGGGGG'],
  ['rubber', 'VN', 'Bình Phước', 'Bình Phước', 11.75, 106.9, 0.4, 'GOOGGGGGGGGG'],
  ['rubber', 'CI', 'Ivory Coast', 'South-West Ivory Coast (Soubré)', 5.78, -6.59, 0.3, 'GOOGGGGGGGGG'],
  ['rubber', 'CN', 'Hainan', 'Hainan', 19.2, 109.7, 0.5, 'GOOGGGGGGGGG'],
  ['rubber', 'CN', 'Yunnan', 'Xishuangbanna, Yunnan', 22.0, 100.8, 0.4, 'GOOGGGGGGGGG'],
  ['rubber', 'IN', 'Kerala', 'Kerala (Kottayam)', 9.6, 76.5, 0.8, 'GOOGGGGGGGGG'],
  ['rubber', 'MY', 'Kedah', 'Kedah', 6.0, 100.5, 0.3, 'GOOGGGGGGGGG'],
]

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** USDA reports the EU as one: the member state each EU region is in */
const EU_MEMBER: Record<string, string> = { France: 'FR', Germany: 'DE', Poland: 'PL', Romania: 'RO', Hungary: 'HU', Spain: 'ES', Bulgaria: 'BG' }

export const REGIONS: CropRegion[] = ROWS.map(([commodity, iso, place, name, lat, lon, share, calendar, flags = '']) => ({
  id: `${commodity}:${iso}:${slug(name)}`,
  commodity, iso, place, name,
  country: iso === 'EU' ? EU_MEMBER[place] ?? 'EU' : iso,
  lat, lon, share,
  calendar: calendar.split('') as Stage[],
  irrigated: flags.includes('I'),
  variant: flags.includes('B') ? 'beet' : flags.includes('R') ? 'robusta' : null,
}))

/** The regions of one commodity in one country */
export function regionsOf(commodity: string, iso: string): CropRegion[] {
  return REGIONS.filter(r => r.commodity === commodity && r.iso === iso)
}

/** Forecast points: regions at the same spot share one forecast ("-21.55,-45.43") */
export function pointKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`
}
