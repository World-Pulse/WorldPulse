/**
 * The GeoJSON our map-layer endpoints return: points with properties.
 * (The API doesn't depend on @types/geojson; this is the part it uses.)
 */

export interface PointFeature<P = Record<string, unknown>> {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: P
}

export interface PointFeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: Array<PointFeature<P>>
}
