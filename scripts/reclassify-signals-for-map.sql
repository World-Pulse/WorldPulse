-- ============================================================================
-- WorldPulse: One-time signal re-classification for map layers
-- Run on prod: docker exec wp_postgres psql -U wp_user -d worldpulse_db -f /tmp/reclassify.sql
-- Or pipe: cat scripts/reclassify-signals-for-map.sql | docker exec -i wp_postgres psql -U wp_user -d worldpulse_db
--
-- Purpose: Many map layers filter by category (military, aviation, maritime,
-- conflict, electronic_warfare). If the scraper didn't assign these categories
-- during ingest, the layers return empty. This script back-fills categories
-- from title/summary keywords on signals that have a location.
--
-- Safe: Only updates signals WHERE category IS NULL or category = 'general'.
-- Will NOT overwrite signals that already have a specific category.
-- ============================================================================

BEGIN;

-- 1. Military signals (feeds: carriers, naval intel)
UPDATE signals SET category = 'military'
WHERE (category IS NULL OR category = 'general')
  AND location IS NOT NULL
  AND (
    title ILIKE '%military%' OR title ILIKE '%navy%' OR title ILIKE '%USS %'
    OR title ILIKE '%carrier strike%' OR title ILIKE '%pentagon%'
    OR title ILIKE '%defense department%' OR title ILIKE '%armed forces%'
    OR title ILIKE '%NATO%' OR title ILIKE '%troops%' OR title ILIKE '%battalion%'
    OR title ILIKE '%warship%' OR title ILIKE '%destroyer%' OR title ILIKE '%frigate%'
    OR title ILIKE '%submarine%' OR title ILIKE '%CVN-%'
    OR summary ILIKE '%military operation%' OR summary ILIKE '%naval exercise%'
  );

-- 2. Aviation signals (feeds: aircraft/ADS-B layer)
UPDATE signals SET category = 'aviation'
WHERE (category IS NULL OR category = 'general')
  AND location IS NOT NULL
  AND (
    title ILIKE '%aircraft%' OR title ILIKE '%aviation%' OR title ILIKE '%airline%'
    OR title ILIKE '%flight%' OR title ILIKE '%FAA%' OR title ILIKE '%airspace%'
    OR title ILIKE '%pilot%' OR title ILIKE '%airport%' OR title ILIKE '%air traffic%'
    OR title ILIKE '%plane crash%' OR title ILIKE '%helicopter%'
    OR title ILIKE '%drone strike%' OR title ILIKE '%UAV%'
    OR summary ILIKE '%aviation incident%' OR summary ILIKE '%flight path%'
  );

-- 3. Maritime signals (feeds: ships/AIS layer)
UPDATE signals SET category = 'maritime'
WHERE (category IS NULL OR category = 'general')
  AND location IS NOT NULL
  AND (
    title ILIKE '%ship%' OR title ILIKE '%vessel%' OR title ILIKE '%maritime%'
    OR title ILIKE '%port %' OR title ILIKE '%naval%' OR title ILIKE '%coast guard%'
    OR title ILIKE '%cargo%' OR title ILIKE '%tanker%' OR title ILIKE '%shipping%'
    OR title ILIKE '%piracy%' OR title ILIKE '%strait%' OR title ILIKE '%seafarer%'
    OR title ILIKE '%AIS%' OR title ILIKE '%dark ship%'
    OR summary ILIKE '%maritime security%' OR summary ILIKE '%vessel tracking%'
  );

-- 4. Conflict signals (feeds: conflict zones layer)
UPDATE signals SET category = 'conflict'
WHERE (category IS NULL OR category = 'general')
  AND location IS NOT NULL
  AND (
    title ILIKE '%attack%' OR title ILIKE '%strike%' OR title ILIKE '% war %'
    OR title ILIKE '%bomb%' OR title ILIKE '%assault%' OR title ILIKE '%combat%'
    OR title ILIKE '%shelling%' OR title ILIKE '%missile%' OR title ILIKE '%airstrike%'
    OR title ILIKE '%insurgent%' OR title ILIKE '%militant%' OR title ILIKE '%rebel%'
    OR title ILIKE '%ceasefire%' OR title ILIKE '%frontline%' OR title ILIKE '%siege%'
    OR title ILIKE '%casualties%' OR title ILIKE '%killed in%'
    OR summary ILIKE '%armed conflict%' OR summary ILIKE '%military strike%'
  );

-- 5. Electronic warfare signals (feeds: RF jamming layer)
UPDATE signals SET category = 'electronic_warfare'
WHERE (category IS NULL OR category = 'general')
  AND location IS NOT NULL
  AND (
    title ILIKE '%jamming%' OR title ILIKE '%GPS%' OR title ILIKE '%spoofing%'
    OR title ILIKE '%electronic warfare%' OR title ILIKE '%GNSS%' OR title ILIKE '%radar%'
    OR title ILIKE '%cyber attack%' OR title ILIKE '%signal interference%'
    OR title ILIKE '%EW %' OR title ILIKE '%counter-drone%'
    OR summary ILIKE '%GPS jamming%' OR summary ILIKE '%electronic countermeasure%'
  );

-- 6. Security signals (catch-all for remaining security/intelligence content)
UPDATE signals SET category = 'security'
WHERE (category IS NULL OR category = 'general')
  AND location IS NOT NULL
  AND (
    title ILIKE '%espionage%' OR title ILIKE '%intelligence%' OR title ILIKE '%surveillance%'
    OR title ILIKE '%sanctions%' OR title ILIKE '%terror%' OR title ILIKE '%threat%'
    OR title ILIKE '%weapons%' OR title ILIKE '%nuclear%' OR title ILIKE '%chemical%'
    OR title ILIKE '%biological weapon%'
    OR summary ILIKE '%national security%' OR summary ILIKE '%intelligence agency%'
  );

-- Report what changed
SELECT category, COUNT(*) as signal_count
FROM signals
WHERE location IS NOT NULL
GROUP BY category
ORDER BY signal_count DESC;

COMMIT;
