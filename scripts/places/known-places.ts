/**
 * What the map's place-finder makes of each candidate name today (scripts/places/make_gazetteer.py, step 3): the
 * country it puts the name in, if any, and whether that reading takes the whole name ("Kingston", a capital in the
 * gazetteer) or only part of it ("Baja California": "California"). Run from apps/scraper with world-gazetteer.ts's
 * two tables emptied, so that only the hand-kept places speak:
 *   npx tsx ../../scripts/places/known-places.ts candidates.json verdicts.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { placeFromText, splitPlaces } from '../../apps/scraper/src/pipeline/geo'

async function main() {
  const [input, output] = process.argv.slice(2)
  const rows = JSON.parse(readFileSync(input!, 'utf8')) as Array<{ names: string[] }>
  const verdicts: Record<string, { country: string | null; whole: boolean }> = {}
  for (const row of rows) {
    for (const name of row.names) {
      if (verdicts[name]) continue
      const found = placeFromText(name)
      const rest = splitPlaces(name).rest.replace(/[\s,.'’()-]+/g, '')
      verdicts[name] = { country: found.countryCode ?? null, whole: !!found.countryCode && rest === '' }
    }
  }
  writeFileSync(output!, JSON.stringify(verdicts))
  console.log('names', Object.keys(verdicts).length)
  process.exit(0)
}
void main()
