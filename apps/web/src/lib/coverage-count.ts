/**
 * The countries and territories WorldPulse reads the news from: all 202 on its coverage map (the
 * UN's members and observers, Kosovo, Taiwan, Hong Kong, Macau, Puerto Rico, Greenland and New
 * Caledonia) since Oct 31, 2026 (Q9). The scraper's last-four-places test keeps a feed for every one
 * of them, and the API's counted-places list is checked against the same map.
 *
 * This is the number shown wherever WorldPulse says how many countries: the map's share card (Devon,
 * Oct 31: "the graphic needs to say 202 countries not 200"), and since Nov 12, 2026 the morning video,
 * its link's picture and the sidebar too (Devon, Nov 12: "Always list total amount of countries covered
 * not just for that day"). The day's own count of countries with news is no longer shown beside it.
 *
 * In a file of its own so pages that run in the browser can read it (the card files draw with next/og).
 */
export const COUNTRIES_COVERED = 202
