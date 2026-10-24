/**
 * The commodity watch's commodities (Oct 23, 2026; Devon: "all commodities should go first"):
 * every crop, oil, meal, fibre, meat, dairy product, fruit and nut USDA forecasts for every country
 * (its PSD database), and cocoa, tea and rubber, which USDA doesn't, from the World Bank's prices.
 * Each with the World Bank price series that prices it, the CFTC market where hedge funds trade it,
 * the words the news uses for it, and how weather hurts it (for the crops with growing regions).
 */

/** What a crop is doing in a month: O out of season, P planting, G growing, B flowering, F filling, H harvest */
export type Stage = 'O' | 'P' | 'G' | 'B' | 'F' | 'H'

export interface CropWeather {
  /** When frost hurts: always (trees, bushes and cane), in the field (summer crops), at flowering and filling (winter crops) */
  frost: 'always' | 'field' | 'flowering' | 'never'
  /** A low at or below this (°C, 2 m air) is a medium risk; 2° lower is high, 2° higher is low */
  frostC: number
  /** A high at or above this (°C) while flowering or filling is a medium risk */
  heatC: number
  /** What the crop is doing at its flowering and filling stages, in words */
  bloom?: string
  fill?: string
}

export interface WatchCommodity {
  /** "coffee"; matches USDA export sales' keys where both have one */
  key: string
  /** "Coffee" */
  name: string
  /** USDA PSD commodity code, null for cocoa, tea and rubber */
  psd: string | null
  /** World Bank price series keys, the main one first */
  prices: string[]
  /** CFTC market code (hedge funds' positions), where there's a futures market */
  cftc: string | null
  /** Words for it in the news, as a Postgres full-text query (English stemming); null: not counted */
  news: string | null
  /** How weather hurts it, for the commodities with growing regions */
  weather: CropWeather | null
  /** Group on the map: grains, oilseeds, softs, ... */
  group: 'grains' | 'oilseeds' | 'oils' | 'meals' | 'softs' | 'fibres' | 'meat' | 'dairy' | 'fruit' | 'nuts'
}

const SUMMER: CropWeather = { frost: 'field', frostC: 1, heatC: 35 }
const WINTER: CropWeather = { frost: 'flowering', frostC: 0, heatC: 32, bloom: 'heading and flowering', fill: 'filling its grain' }
const TREE: CropWeather = { frost: 'always', frostC: 0, heatC: 38 }

const c = (key: string, name: string, psd: string | null, group: WatchCommodity['group'], prices: string[], cftc: string | null, news: string | null, weather: CropWeather | null = null): WatchCommodity =>
  ({ key, name, psd, group, prices, cftc, news, weather })

export const COMMODITIES: WatchCommodity[] = [
  // Grains
  c('wheat', 'Wheat', '0410000', 'grains', ['wheat-us-hrw', 'wheat-us-srw'], '001602', 'wheat', WINTER),
  c('corn', 'Corn (maize)', '0440000', 'grains', ['maize'], '002602', 'corn | maize', { ...SUMMER, bloom: 'pollinating', fill: 'filling its kernels' }),
  c('rice', 'Rice', '0422110', 'grains', ['rice-thai-5', 'rice-viet-namese-5', 'rice-thai-25', 'rice-thai-a-1'], null, 'rice | paddy', { ...SUMMER, frostC: 3, heatC: 35, fill: 'filling its grain' }),
  c('barley', 'Barley', '0430000', 'grains', ['barley'], null, 'barley', WINTER),
  c('sorghum', 'Sorghum', '0459200', 'grains', ['sorghum'], null, 'sorghum', { ...SUMMER, heatC: 38, fill: 'filling its grain' }),
  c('oats', 'Oats', '0452000', 'grains', [], null, 'oats'),
  c('rye', 'Rye', '0451000', 'grains', [], null, 'rye'),
  c('millet', 'Millet', '0459100', 'grains', [], null, 'millet'),
  c('mixed-grain', 'Mixed grain', '0459900', 'grains', [], null, null),
  // Oilseeds
  c('soybeans', 'Soybeans', '2222000', 'oilseeds', ['soybeans'], '005602', 'soybean | soybeans | soy', { ...SUMMER, fill: 'filling its pods' }),
  c('rapeseed', 'Rapeseed (canola)', '2226000', 'oilseeds', ['rapeseed-oil'], null, 'rapeseed | canola', { ...WINTER, heatC: 30, bloom: 'flowering', fill: 'filling its pods' }),
  c('sunflowerseed', 'Sunflower seed', '2224000', 'oilseeds', ['sunflower-oil'], null, 'sunflower | sunflowers', { ...SUMMER, fill: 'filling its seed heads' }),
  c('peanuts', 'Peanuts', '2221000', 'oilseeds', ['groundnuts'], null, 'peanut | peanuts | groundnut | groundnuts', { ...SUMMER, fill: 'filling its pods' }),
  c('cottonseed', 'Cottonseed', '2223000', 'oilseeds', [], null, 'cottonseed'),
  c('copra', 'Copra', '2231000', 'oilseeds', ['coconut-oil'], null, 'copra | coconut | coconuts'),
  c('palm-kernels', 'Palm kernels', '2232000', 'oilseeds', ['palm-kernel-oil'], null, 'palm <-> kernel'),
  // Vegetable oils
  c('palm-oil', 'Palm oil', '4243000', 'oils', ['palm-oil'], null, 'palm <-> oil', { frost: 'never', frostC: 5, heatC: 38 }),
  c('soybean-oil', 'Soybean oil', '4232000', 'oils', ['soybean-oil'], null, 'soybean <-> oil | soyoil'),
  c('rapeseed-oil', 'Rapeseed oil', '4239100', 'oils', ['rapeseed-oil'], null, 'rapeseed <-> oil | canola <-> oil'),
  c('sunflower-oil', 'Sunflower oil', '4236000', 'oils', ['sunflower-oil'], null, 'sunflower <-> oil'),
  c('peanut-oil', 'Peanut oil', '4234000', 'oils', ['groundnut-oil'], null, 'peanut <-> oil | groundnut <-> oil'),
  c('olive-oil', 'Olive oil', '4235000', 'oils', [], null, 'olive <-> oil'),
  c('cottonseed-oil', 'Cottonseed oil', '4233000', 'oils', [], null, null),
  c('coconut-oil', 'Coconut oil', '4242000', 'oils', ['coconut-oil'], null, 'coconut <-> oil'),
  c('palm-kernel-oil', 'Palm kernel oil', '4244000', 'oils', ['palm-kernel-oil'], null, null),
  // Meals
  c('soybean-meal', 'Soybean meal', '0813100', 'meals', ['soybean-meal'], null, 'soybean <-> meal | soymeal'),
  c('rapeseed-meal', 'Rapeseed meal', '0813600', 'meals', [], null, null),
  c('sunflower-meal', 'Sunflower meal', '0813500', 'meals', [], null, null),
  c('cottonseed-meal', 'Cottonseed meal', '0813300', 'meals', [], null, null),
  c('peanut-meal', 'Peanut meal', '0813200', 'meals', [], null, null),
  c('copra-meal', 'Copra meal', '0813700', 'meals', [], null, null),
  c('palm-kernel-meal', 'Palm kernel meal', '0813800', 'meals', [], null, null),
  c('fish-meal', 'Fish meal', '0814200', 'meals', ['fish-meal'], null, 'fishmeal | fish <-> meal'),
  // Softs (tropical crops)
  c('coffee', 'Coffee', '0711100', 'softs', ['coffee-arabica', 'coffee-robusta'], '083731', 'coffee | arabica | robusta', { ...TREE, frostC: 2, heatC: 34, bloom: 'flowering', fill: 'filling its beans' }),
  c('cocoa', 'Cocoa', null, 'softs', ['cocoa'], '073732', 'cocoa | cacao', { frost: 'never', frostC: 5, heatC: 36, bloom: 'flowering', fill: 'growing its pods' }),
  c('sugar', 'Sugar', '0612000', 'softs', ['sugar-world', 'sugar-us', 'sugar-eu'], '080732', 'sugar | sugarcane | sugarbeet | (sugar <-> beet)', { frost: 'always', frostC: 0, heatC: 40 }),
  c('tea', 'Tea', null, 'softs', ['tea-avg-3-auctions', 'tea-mombasa', 'tea-colombo', 'tea-kolkata'], null, 'tea & (crop | harvest | auction | estate | plantation | export | grower)', { frost: 'always', frostC: 2, heatC: 35 }),
  c('rubber', 'Natural rubber', null, 'softs', ['rubber-tsr20', 'rubber-rss3'], null, 'rubber & (natural | plantation | latex | tapping | price | prices)', { frost: 'never', frostC: 5, heatC: 38 }),
  c('orange-juice', 'Orange juice', '0585100', 'softs', ['orange'], null, 'orange <-> juice', { ...TREE, heatC: 38, bloom: 'blooming', fill: 'setting fruit' }),
  // Fibre
  c('cotton', 'Cotton', '2631000', 'fibres', ['cotton-a-index'], '033661', 'cotton', { ...SUMMER, frostC: 2, heatC: 38, bloom: 'flowering', fill: 'setting bolls' }),
  // Meat and livestock
  c('beef', 'Beef', '0111000', 'meat', ['beef'], '057642', 'beef | cattle'),
  c('pork', 'Pork', '0113000', 'meat', [], '054642', 'pork | hog | hogs | swine'),
  c('chicken', 'Chicken', '0115000', 'meat', ['chicken'], null, 'chicken | poultry'),
  c('cattle', 'Cattle herds', '0011000', 'meat', ['beef'], '057642', null),
  c('swine', 'Pig herds', '0013000', 'meat', [], '054642', null),
  // Dairy
  c('butter', 'Butter', '0230000', 'dairy', [], null, 'butter'),
  c('cheese', 'Cheese', '0240000', 'dairy', [], null, 'cheese'),
  c('milk-powder', 'Whole milk powder', '0224400', 'dairy', [], null, 'milk <-> powder'),
  c('skim-milk-powder', 'Skim milk powder', '0224200', 'dairy', [], null, null),
  c('milk', 'Milk', '0223000', 'dairy', [], null, 'dairy | milk'),
  // Fruit
  c('oranges', 'Oranges', '0571120', 'fruit', ['orange'], null, 'oranges | citrus', { ...TREE, heatC: 38, bloom: 'blooming', fill: 'setting fruit' }),
  c('tangerines', 'Tangerines and mandarins', '0571220', 'fruit', [], null, 'tangerines | mandarins'),
  c('lemons', 'Lemons and limes', '0572120', 'fruit', [], null, 'lemons | limes'),
  c('grapefruit', 'Grapefruit', '0572220', 'fruit', [], null, 'grapefruit'),
  c('apples', 'Apples', '0574000', 'fruit', [], null, 'apples'),
  c('pears', 'Pears', '0579220', 'fruit', [], null, 'pears'),
  c('table-grapes', 'Table grapes', '0575100', 'fruit', [], null, 'grapes'),
  c('cherries', 'Cherries', '0579305', 'fruit', [], null, 'cherries'),
  c('peaches', 'Peaches and nectarines', '0579309', 'fruit', [], null, 'peaches | nectarines'),
  // Tree nuts
  c('almonds', 'Almonds', '0577400', 'nuts', [], null, 'almonds | almond'),
  c('walnuts', 'Walnuts', '0577901', 'nuts', [], null, 'walnuts | walnut'),
  c('pistachios', 'Pistachios', '0577907', 'nuts', [], null, 'pistachios | pistachio'),
]

export const BY_KEY: ReadonlyMap<string, WatchCommodity> = new Map(COMMODITIES.map(x => [x.key, x]))
export const BY_PSD: ReadonlyMap<string, WatchCommodity> = new Map(COMMODITIES.filter(x => x.psd).map(x => [x.psd!, x]))

/** What a crop is doing at a stage, in words ("flowering", "filling its beans") */
export function stageWords(commodity: WatchCommodity, stage: Stage): string {
  switch (stage) {
    case 'P': return 'being planted'
    case 'G': return 'growing'
    case 'B': return commodity.weather?.bloom ?? 'flowering'
    case 'F': return commodity.weather?.fill ?? 'filling'
    case 'H': return 'being harvested'
    default: return 'out of season'
  }
}
