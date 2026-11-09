/**
 * The world's shipping chokepoints: the Maritime page's overview (routes/maritime.ts) and the AI assistants'
 * shipping tool (routes/mcp.ts, Nov 8, 2026) both read this list. dailyTransits and pctGlobalTrade are rough
 * figures for the page.
 */
export const CHOKEPOINTS = [
  { id: 'suez',          name: 'Suez Canal',              lat: 30.46, lng: 32.34, region: 'Middle East',     dailyTransits: 50,  pctGlobalTrade: 12 },
  { id: 'panama',        name: 'Panama Canal',            lat:  9.08, lng: -79.68, region: 'Central America', dailyTransits: 36,  pctGlobalTrade: 5 },
  { id: 'hormuz',        name: 'Strait of Hormuz',        lat: 26.57, lng: 56.25, region: 'Middle East',     dailyTransits: 80,  pctGlobalTrade: 21 },
  { id: 'malacca',       name: 'Strait of Malacca',       lat:  2.50, lng: 101.50, region: 'Southeast Asia', dailyTransits: 83,  pctGlobalTrade: 25 },
  { id: 'bab-el-mandeb', name: 'Bab el-Mandeb',           lat: 12.58, lng: 43.32, region: 'Middle East',     dailyTransits: 30,  pctGlobalTrade: 9 },
  { id: 'dover',         name: 'Strait of Dover',          lat: 51.02, lng:  1.45, region: 'Europe',          dailyTransits: 500, pctGlobalTrade: 7 },
  { id: 'gibraltar',     name: 'Strait of Gibraltar',      lat: 35.97, lng: -5.60, region: 'Europe',          dailyTransits: 300, pctGlobalTrade: 6 },
  { id: 'taiwan',        name: 'Taiwan Strait',            lat: 24.50, lng: 119.50, region: 'East Asia',      dailyTransits: 240, pctGlobalTrade: 8 },
  { id: 'good-hope',     name: 'Cape of Good Hope',        lat: -34.36, lng: 18.47, region: 'Africa',         dailyTransits: 60,  pctGlobalTrade: 4 },
  { id: 'bosporus',      name: 'Turkish Straits',          lat: 41.12, lng: 29.05, region: 'Europe',          dailyTransits: 120, pctGlobalTrade: 3 },
  { id: 'lombok',        name: 'Lombok Strait',            lat: -8.47, lng: 115.72, region: 'Southeast Asia', dailyTransits: 40,  pctGlobalTrade: 2 },
  { id: 'danish-straits', name: 'Danish Straits',          lat: 55.70, lng: 12.60, region: 'Europe',          dailyTransits: 90,  pctGlobalTrade: 3 },
] as const
