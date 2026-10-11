/**
 * Day and night on the World Map (plan item M18): the night side of the Earth
 * as a GeoJSON polygon, and the terminator (the line between day and night)
 * for a soft edge. WorldMonitor shows the same as its "Day/Night" layer.
 *
 * The sun's position uses NOAA's general solar position formulas (accurate
 * to a fraction of a degree, plenty for a world map).
 */

const RAD = Math.PI / 180

type Position = [number, number]

/** The night polygon and the terminator line, as a GeoJSON FeatureCollection */
export interface DayNightCollection {
  type: 'FeatureCollection'
  features: Array<
    | { type: 'Feature'; properties: { part: 'night' | 'day' }; geometry: { type: 'Polygon'; coordinates: Position[][] } }
    | { type: 'Feature'; properties: { part: 'edge' }; geometry: { type: 'LineString'; coordinates: Position[] } }
  >
}

/** The point on Earth where the sun is straight overhead at `date` */
export function subsolarPoint(date: Date): { lat: number; lng: number } {
  const year = date.getUTCFullYear()
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const dayOfYear = Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  const g = (2 * Math.PI / (leap ? 366 : 365)) * (dayOfYear - 1 + (hours - 12) / 24)

  // Equation of time (minutes) and the sun's declination (radians)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)

  // The sun is overhead where local solar time is noon
  let lng = (720 - hours * 60 - eqTime) / 4
  lng = ((lng + 180) % 360 + 360) % 360 - 180
  return { lat: decl / RAD, lng }
}

/** The terminator's latitude at each longitude from -180 to 180 */
export function terminator(date: Date, stepDeg = 2): Position[] {
  const sun = subsolarPoint(date)
  // At an equinox the declination is 0 and the terminator runs pole to pole
  const tanDecl = Math.tan((Math.abs(sun.lat) < 1e-4 ? 1e-4 : sun.lat) * RAD)
  const points: Position[] = []
  for (let lng = -180; lng <= 180; lng += stepDeg) {
    const lat = Math.atan(-Math.cos((lng - sun.lng) * RAD) / tanDecl) / RAD
    points.push([lng, Math.round(lat * 1000) / 1000])
  }
  return points
}

/**
 * The night side, the day side and the terminator, as one FeatureCollection.
 * Each side runs along the terminator and closes around its pole (the north
 * pole is dark from the September to the March equinox).
 */
export function dayNightFeatures(date: Date, stepDeg = 2): DayNightCollection {
  const line = terminator(date, stepDeg)
  const darkPole = subsolarPoint(date).lat < 0 ? 90 : -90
  const side = (pole: number): Position[] => [...line, [180, pole], [-180, pole], line[0]!]
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { part: 'night' }, geometry: { type: 'Polygon', coordinates: [side(darkPole)] } },
      { type: 'Feature', properties: { part: 'day' }, geometry: { type: 'Polygon', coordinates: [side(-darkPole)] } },
      { type: 'Feature', properties: { part: 'edge' }, geometry: { type: 'LineString', coordinates: line } },
    ],
  }
}

/** Whether it's night at a point (the sun below the horizon) */
export function isNight(date: Date, lat: number, lng: number): boolean {
  const sun = subsolarPoint(date)
  const elevation = Math.sin(lat * RAD) * Math.sin(sun.lat * RAD)
    + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lng - sun.lng) * RAD)
  return elevation < 0
}
