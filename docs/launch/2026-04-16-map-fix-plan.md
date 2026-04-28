# Map Fix Plan — Priority Order

**Date:** 2026-04-16 (T-4 to launch)
**Scope:** Every map layer that "produces nothing" + cluster drill-down loop + globe toggle
**Estimated total time:** 4–6 hours if done in order. Don't skip P0.

---

## Root Cause Summary

After auditing every file in the map stack, here's why things are broken:

1. **Three auth-gated API routes are called without tokens** — threats/missiles, jamming/zones, maritime/vessels all require JWT auth. The map page never passes an `Authorization` header. They return 401, the frontend swallows the error silently, and the layer shows nothing.

2. **Conflict zones uses the wrong URL** — line 2127 of `page.tsx` fetches `/api/v1/signals/map/conflict-zones` (relative, hits Next.js on port 3000) instead of `${API_URL}/api/v1/signals/map/conflict-zones` (Fastify on port 3001). So it 404s.

3. **Aircraft and ships layers query categories that may have zero signals** — the ADS-B endpoint queries `WHERE category = 'aviation'` and maritime queries `WHERE category = 'maritime'`. If the scraper doesn't produce signals with those exact categories, the layers return empty arrays.

4. **Cluster drill-down gets stuck** because `radius: 60` at `maxZoom: 18` is too aggressive. Co-located signals cluster forever.

5. **Globe toggle doesn't exist** — MapLibre can't do globe projection. Needs a library addition.

---

## P0 — Fix tonight or first thing Friday (2–3 hours)

### Fix 1: Remove auth gates from map-facing API routes (30 min)

**Why:** Threats, jamming, and naval intel are the three sexiest layers on the map. Without them, it looks empty. These are read-only endpoints showing aggregated intelligence — there's no security reason to gate them behind JWT for a public launch.

**File:** `apps/api/src/routes/threats.ts`

```
Line 254-255: Change from:
  app.get('/missiles', {
    preHandler: [authenticate],

To:
  app.get('/missiles', {
    // preHandler: [authenticate],  // Opened for public map — re-gate post-launch if needed
```

```
Line 362-363: Change from:
  app.get('/summary', {
    preHandler: [authenticate],

To:
  app.get('/summary', {
    // preHandler: [authenticate],
```

**File:** `apps/api/src/routes/jamming.ts`

```
Line 254-255: Change from:
  app.get('/zones', {
    preHandler: [authenticate],

To:
  app.get('/zones', {
    // preHandler: [authenticate],
```

**File:** `apps/api/src/routes/maritime.ts`

```
Line 136-137: Change from:
  app.get('/vessels', {
    preHandler: [authenticate],

To:
  app.get('/vessels', {
    // preHandler: [authenticate],
```

**Redeploy:** `deploy-bg.ps1 -Service api`

**Verify:** `curl https://api.world-pulse.io/api/v1/threats/missiles` should return JSON, not 401.

**Alternative (if you want to keep auth):** Pass the JWT token from the frontend. In `page.tsx`, every fetch to these three endpoints needs:
```ts
const res = await fetch(`${API_URL}/api/v1/threats/missiles`, {
  headers: { 'Authorization': `Bearer ${token}` }
})
```
But this requires the user to be logged in to see the map, which kills the launch demo. Remove auth for now.

---

### Fix 2: Fix conflict zones URL (5 min)

**File:** `apps/web/src/app/map/page.tsx`

```
Line 2127: Change from:
  fetch('/api/v1/signals/map/conflict-zones'),

To:
  fetch(`${API_URL}/api/v1/signals/map/conflict-zones`),
```

**Why:** Without `API_URL`, this hits the Next.js server (port 3000), which doesn't have this route. It 404s and the conflict layer silently fails.

**Redeploy:** `deploy-bg.ps1 -Service web`

---

### Fix 3: Fix cluster drill-down loop (10 min)

**File:** `apps/web/src/app/map/page.tsx`

```
Line 557: Change from:
  const sc: SCIndex = new SuperclusterLib({ radius: 60, maxZoom: 18 })

To:
  const sc: SCIndex = new SuperclusterLib({ radius: 40, maxZoom: 22 })
```

```
Line 769: Change from:
  maxZoom: 18,

To:
  maxZoom: 22,
```

**Why:**
- `radius: 40` (down from 60) means points need to be closer to cluster. Clusters break apart earlier when zooming.
- `maxZoom: 22` (up from 18) gives 4 more zoom levels for the cluster algorithm to separate points. MapLibre supports up to zoom 24.
- The combination eliminates the "infinite loop" where clusters of 2-6 never break apart.

**Also improve the cluster click threshold (line 964):**

```
Line 964: Change from:
  if (expansionZ > currentZ + 0.5) {

To:
  if (expansionZ > currentZ + 0.3) {
```

This makes cluster clicks more responsive — smaller zoom jumps still trigger fly-to instead of showing the popup prematurely.

**Redeploy:** `deploy-bg.ps1 -Service web`

---

### Fix 4: Ensure signal categories populate map layers (1–2 hours)

The aircraft, ships, carriers, and conflict layers all depend on signals having the right `category` values. Check what categories exist:

```sql
-- SSH to prod, run:
docker exec wp_postgres psql -U wp_user -d worldpulse_db -c "
  SELECT category, COUNT(*) as cnt
  FROM signals
  WHERE location IS NOT NULL
  GROUP BY category
  ORDER BY cnt DESC
  LIMIT 30;
"
```

**What you're looking for:** Do `aviation`, `maritime`, `military`, `conflict`, `security`, `electronic_warfare` categories exist? If not, the layers have no data to show.

**If categories are missing**, the scraper's signal classification pipeline isn't tagging signals with these specific category values. Two options:

**Option A — Quick seed (30 min):** Run a one-time SQL script to re-classify existing signals by keyword:

```sql
-- Re-classify signals by keyword matching
UPDATE signals SET category = 'military'
WHERE category IS NULL
  AND (title ILIKE '%military%' OR title ILIKE '%navy%' OR title ILIKE '%USS %'
       OR title ILIKE '%carrier%' OR title ILIKE '%pentagon%' OR title ILIKE '%defense%')
  AND location IS NOT NULL;

UPDATE signals SET category = 'aviation'
WHERE category IS NULL
  AND (title ILIKE '%aircraft%' OR title ILIKE '%aviation%' OR title ILIKE '%airline%'
       OR title ILIKE '%flight%' OR title ILIKE '%FAA%' OR title ILIKE '%airspace%')
  AND location IS NOT NULL;

UPDATE signals SET category = 'maritime'
WHERE category IS NULL
  AND (title ILIKE '%ship%' OR title ILIKE '%vessel%' OR title ILIKE '%maritime%'
       OR title ILIKE '%port%' OR title ILIKE '%naval%' OR title ILIKE '%coast guard%')
  AND location IS NOT NULL;

UPDATE signals SET category = 'conflict'
WHERE category IS NULL
  AND (title ILIKE '%attack%' OR title ILIKE '%strike%' OR title ILIKE '%war%'
       OR title ILIKE '%bomb%' OR title ILIKE '%assault%' OR title ILIKE '%combat%')
  AND location IS NOT NULL;

UPDATE signals SET category = 'electronic_warfare'
WHERE category IS NULL
  AND (title ILIKE '%jamming%' OR title ILIKE '%GPS%' OR title ILIKE '%spoofing%'
       OR title ILIKE '%electronic warfare%' OR title ILIKE '%GNSS%' OR title ILIKE '%radar%')
  AND location IS NOT NULL;
```

**Option B — Fix scraper classification (longer):** Update the scraper's classification logic to assign these categories during ingest. This is the proper fix but takes longer. Do this post-launch.

---

## P1 — Fix Friday morning (1–2 hours)

### Fix 5: Add error visibility to all map layer fetches (30 min)

Right now every layer catch block silently swallows errors. Add visible error logging so you know what's failing.

**File:** `apps/web/src/app/map/page.tsx`

Find every pattern like:
```ts
} catch (e) {
  console.error('[map] ...:', e)
}
```

Add a toast or at minimum a `console.warn` that includes the HTTP status:

```ts
const res = await fetch(`${API_URL}/api/v1/threats/missiles`)
if (!res.ok) {
  console.warn(`[map][threats] HTTP ${res.status}: ${res.statusText}`)
  return  // don't try to parse
}
const json = await res.json()
```

Do this for every fetch in the map page: threats (line 2202), jamming (line 2390), naval (line 1919), carriers (line 1331), aircraft (line 1487), ships (line 1755), cameras (line 1616), hazards (line 2594), conflict (line 2127), countries/risk (line 2780), and hotspots/convergence (line 386).

This won't fix anything on its own, but it turns "produces nothing" into "I can see exactly what's failing in DevTools."

---

### Fix 6: Wind data source (15 min)

**Current state:** The wind route at `apps/api/src/routes/wind.ts` has a GRIB2 parsing TODO and falls back to synthetic wind data. The WebGL particle layer on the frontend IS functional — it just needs data.

Check if the frontend is actually calling the wind endpoint:

**File:** `apps/web/src/app/map/page.tsx` — search for how wind data is loaded (around line 2990).

The wind layer component (`WindParticleLayer.ts`) needs a `{ width, height, uMin, uMax, vMin, vMax, data }` object. Make sure the map page actually fetches from `/api/v1/wind/grid` and passes it to the layer. If the fetch is missing or broken, wire it:

```ts
const res = await fetch(`${API_URL}/api/v1/wind/grid`)
const windData = await res.json()
// windData has: { width: 256, height: 128, uMin, uMax, vMin, vMax, data: "base64..." }
```

The synthetic fallback (trade winds, westerlies, polar easterlies) is actually decent for a launch demo — real GRIB2 data is post-launch.

---

### Fix 7: Cameras layer verification (10 min)

The cameras endpoint (`apps/api/src/routes/cameras.ts`) serves ~30 hardcoded webcam URLs from `ip-cameras.ts`. This should work, but many of these embed URLs may have gone stale.

**Quick check:** Hit `https://api.world-pulse.io/api/v1/cameras?region=global&limit=50` in a browser. Verify the response has cameras. Then spot-check 3-4 `embedUrl` values — do they load?

If many are dead, replace the worst ones. Don't spend more than 10 min on this.

---

## P2 — Fix Saturday (1 hour)

### Fix 8: Globe / flat map toggle (45 min for visual toggle, NOT full globe)

**Reality check:** True globe projection requires Mapbox GL v2.15+ (paid) or a different library entirely (Cesium, globe.gl, deck.gl GlobeView). This is NOT a quick fix.

**Launch-viable alternative — "3D / Flat" toggle:**

MapLibre already supports pitch control. Add a toggle that switches between:
- **3D view:** pitch 45°, bearing -10° (current default)
- **Flat view:** pitch 0°, bearing 0° (traditional 2D map)

This isn't a globe, but it gives users a toggle that changes the visual feel.

**File:** `apps/web/src/app/map/page.tsx`

Add state:
```ts
const [viewMode, setViewMode] = useState<'3d' | 'flat'>('3d')
```

Add toggle handler:
```ts
const toggleView = () => {
  const map = mapRef.current
  if (!map) return
  if (viewMode === '3d') {
    map.easeTo({ pitch: 0, bearing: 0, duration: 800 })
    setViewMode('flat')
  } else {
    map.easeTo({ pitch: 45, bearing: -10, duration: 800 })
    setViewMode('3d')
  }
}
```

Add a button in the controls panel:
```tsx
<button onClick={toggleView} className="...">
  {viewMode === '3d' ? '🗺 FLAT' : '🌐 3D'}
</button>
```

**Post-launch (v1.1):** Integrate `globe.gl` or Mapbox GL v2 for real globe projection. This is the feature that competitors like GDELT have. But for launch, the 3D/flat toggle shows you have the concept.

---

### Fix 9: Convergence hotspot click behavior (20 min)

The convergence widget shows "10 CONVERGENCES" in the top-right but clicking may not do anything useful. Verify that clicking a convergence hotspot:
1. Flies the map to that location
2. Shows a popup with the convergence details (signal count, categories, max severity)

If not, wire the click handler. The data is already being fetched at line 386 (`/api/v1/signals/map/hotspots`).

---

## P3 — Post-launch (v1.1)

### Fix 10: Real ADS-B integration
The aircraft layer queries `WHERE category = 'aviation'` from the signals table. For real-time aircraft tracking, integrate the OpenSky Network API (`https://opensky-network.org/api/states/all`) or ADS-B Exchange. This would give you live aircraft positions, not just news about aviation.

### Fix 11: Real AIS ship tracking
Same pattern — integrate MarineTraffic or AISHub for real ship positions instead of relying on signals categorized as `maritime`.

### Fix 12: Real wind data (GRIB2 parsing)
The wind route has a TODO for GRIB2 parsing. Implement it with `@weacast/grib2-js` or fetch pre-processed wind tiles from `earth.nullschool.net`-style data sources.

### Fix 13: True globe projection
Choose one: Mapbox GL v2.15+ ($), `globe.gl` (free, Three.js-based), Cesium (free, heavyweight), or Deck.gl GlobeView (free, WebGL). Each has tradeoffs — Mapbox is easiest but costs money.

---

## Execution Order (Copy-Paste Checklist)

```
TONIGHT (Apr 16):
[ ] Fix 1: Comment out authenticate on threats.ts:255, jamming.ts:255, maritime.ts:137
[ ] Fix 2: Add ${API_URL} to conflict-zones fetch (page.tsx:2127)
[ ] Fix 3: Change Supercluster radius:40, maxZoom:22 (page.tsx:557,769) + threshold 0.3 (page.tsx:964)
[ ] Fix 4: Run category re-classification SQL on prod DB
[ ] Redeploy: deploy-bg.ps1 -Service api, then deploy-bg.ps1 -Service web
[ ] Verify: Open world-pulse.io/map, toggle each layer, confirm data appears

FRIDAY MORNING (Apr 17):
[ ] Fix 5: Add HTTP status logging to all 11 map fetch calls
[ ] Fix 6: Verify wind layer data flow; confirm synthetic wind shows particles
[ ] Fix 7: Spot-check 3-4 camera embed URLs

SATURDAY (Apr 18):
[ ] Fix 8: Add 3D/Flat toggle button
[ ] Fix 9: Wire convergence hotspot click-to-fly

POST-LAUNCH:
[ ] Fix 10: OpenSky ADS-B integration
[ ] Fix 11: AIS ship tracking integration
[ ] Fix 12: GRIB2 wind parsing
[ ] Fix 13: Globe projection
```

---

## What this gets you by launch day

After Fixes 1–7, a visitor opening the map will see:
- Signal clusters that break apart properly when clicking/zooming
- Threat intelligence markers (missile/drone signals, colored by type)
- RF jamming zones (colored circles with radius)
- Naval vessels (carrier positions + dark ships)
- Conflict zone overlays with pulsing boundaries
- Country risk choropleth (color-coded by risk score)
- Natural hazard markers (earthquakes, fires, volcanoes)
- Heatmap overlay (severity-weighted signal density)
- Wind particle animation (synthetic but visually impressive)
- Live camera pins (30 hardcoded streams)
- Timeline playback
- Working convergence hotspots

After Fix 8, you also get a 3D/Flat visual toggle.

This puts you ahead of GDELT (static map, no layers) and on par with WorldMonitor's map density. The real competitive gap (live ADS-B, live AIS, true globe) is a v1.1 play.

---

**Prepared:** Apr 16 2026
**Priority guidance:** Do Fixes 1-4 tonight. That's 80% of the visible improvement for 2 hours of work.
