import MapPage from '../../map/page'

// The live map for other sites to frame (plan G17): the map alone, with a link
// back to the full map. The address sets topic, severity, window and view
// (cat, sev, tr, region, lat, lng, z); /embed stays out of search in robots.ts
export default function EmbedMapPage() {
  return <MapPage embed />
}
