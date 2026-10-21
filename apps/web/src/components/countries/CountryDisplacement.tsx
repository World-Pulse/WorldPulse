'use client'

/**
 * A country's displaced people, from UNHCR's figures (plan R4; Devon, Oct 21,
 * 2026: "Add - added refugee and displacement data"): how many are displaced
 * inside it, how many of its people are refugees abroad, how many it hosts,
 * with links to the World Map's layer and to UNHCR. Reads the file the map
 * reads (lib/displaced.ts); shows nothing for a country UNHCR counts fewer
 * than 1,000 in each group, or when the file can't be read.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DISPLACED_FILE, UNHCR_DATA_URL, displacedFigures, displacedLines, displacedMapLink, type DisplacedFigures } from '@/lib/displaced'

export function CountryDisplacement({ code, fetchImpl }: { code: string; fetchImpl?: typeof fetch }) {
  const [figures, setFigures] = useState<DisplacedFigures | null>(null)

  useEffect(() => {
    let live = true
    const iso2 = code.toUpperCase()
    ;(fetchImpl ?? fetch)(DISPLACED_FILE)
      .then(r => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        if (!live || !json) return
        setFigures(displacedFigures(json).find(f => f.iso2 === iso2) ?? null)
      })
      .catch(() => { /* the card is left out */ })
    return () => { live = false }
  }, [code, fetchImpl])

  if (!figures) return null
  const lines = displacedLines(figures)
  if (!lines.length) return null

  return (
    <section aria-labelledby="displaced-heading" className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="displaced-heading" className="font-mono text-[10px] text-wp-text3 tracking-widest uppercase">
          Displaced people{figures.year ? ` · ${figures.year}` : ''}
        </h2>
        <Link href={displacedMapLink(figures)} className="font-mono text-[10px] text-wp-text3 hover:text-wp-amber transition-colors no-underline">
          On the map →
        </Link>
      </div>
      <ul className="space-y-1.5">
        {lines.map(line => (
          <li key={line} className="text-[14px] text-wp-text leading-snug">{line}</li>
        ))}
      </ul>
      {figures.note && <p className="mt-3 text-[12px] text-wp-text3 italic leading-snug">{figures.note}</p>}
      <p className="mt-3 font-mono text-[10px] text-wp-text3">
        Source:{' '}
        <a href={UNHCR_DATA_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-wp-text2">
          UNHCR Refugee Data Finder
        </a>
        {' '}(CC BY 4.0), added up by country.
      </p>
    </section>
  )
}
