'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Search, Shield, ExternalLink, ChevronRight } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.world-pulse.io'

// ─── Types ────────────────────────────────────────────────────────────────────

type ThreatLevel = 'critical' | 'high' | 'medium' | 'low'
type SchemaFilter = 'All' | 'Person' | 'Organization' | 'Vessel' | 'Aircraft'

interface EntityResult {
  id:           string
  caption:      string
  schema:       string
  datasets:     string[]
  score:        number
  properties: {
    alias?:       string[]
    nationality?: string[]
    country?:     string[]
    topics?:      string[]
  }
}

interface FeaturedEntity {
  id:            string
  caption:       string
  schema:        string
  schemaLabel:   string
  datasets:      string[]
  datasetLabels: string[]
  threatLevel:   ThreatLevel
  primaryAlias:  string | null
  aliases:       string[]
  countries:     string[]
  topics:        string[]
  score:         number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const THREAT_BADGE: Record<ThreatLevel, { label: string; className: string }> = {
  critical: { label: 'CRITICAL', className: 'bg-red-500/20 text-red-400 border border-red-500/40' },
  high:     { label: 'HIGH',     className: 'bg-orange-500/20 text-orange-400 border border-orange-500/40' },
  medium:   { label: 'MEDIUM',   className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40' },
  low:      { label: 'LOW',      className: 'bg-gray-500/20 text-gray-400 border border-gray-500/40' },
}

const SCHEMA_COLORS: Record<string, string> = {
  Person:       'bg-blue-500/15 text-blue-400',
  Organization: 'bg-purple-500/15 text-purple-400',
  Company:      'bg-purple-500/15 text-purple-400',
  Vessel:       'bg-cyan-500/15 text-cyan-400',
  Aircraft:     'bg-teal-500/15 text-teal-400',
  LegalEntity:  'bg-indigo-500/15 text-indigo-400',
}

const COUNTRY_FLAGS: Record<string, string> = {
  ru: '🇷🇺', us: '🇺🇸', cn: '🇨🇳', ir: '🇮🇷', kp: '🇰🇵', by: '🇧🇾',
  sy: '🇸🇾', ve: '🇻🇪', cu: '🇨🇺', mm: '🇲🇲', sd: '🇸🇩', ly: '🇱🇾',
  ye: '🇾🇪', iq: '🇮🇶', af: '🇦🇫', so: '🇸🇴', zw: '🇿🇼', lb: '🇱🇧',
  ps: '🇵🇸', pk: '🇵🇰', ng: '🇳🇬', ml: '🇲🇱', ni: '🇳🇮', ba: '🇧🇦',
}

function countryFlag(code: string): string {
  const lower = code.toLowerCase()
  return COUNTRY_FLAGS[lower] ?? code.toUpperCase()
}

/** Derive threat level from datasets for search results (mirrors backend logic) */
function deriveThreatLevel(datasets: string[]): ThreatLevel {
  const CRITICAL = new Set(['us_ofac_sdn', 'un_sc_sanctions', 'eu_fsf', 'interpol_red_notices', 'us_fbi_most_wanted'])
  const HIGH     = new Set(['gb_hmt_sanctions', 'us_bis_entity', 'us_ofac_cons', 'worldbank_debarment', 'ch_seco_sanctions', 'au_dfat_sanctions', 'ca_dfatd_sema_sanctions'])
  if (datasets.some(d => CRITICAL.has(d))) return 'critical'
  if (datasets.some(d => HIGH.has(d)))     return 'high'
  if (datasets.length >= 2)                return 'medium'
  return 'low'
}

const DATASET_LABELS: Record<string, string> = {
  us_ofac_sdn:             'OFAC SDN',
  us_ofac_cons:            'OFAC Consolidated',
  eu_fsf:                  'EU Financial Sanctions',
  un_sc_sanctions:         'UN Security Council',
  gb_hmt_sanctions:        'UK HM Treasury',
  ch_seco_sanctions:       'Switzerland SECO',
  ca_dfatd_sema_sanctions: 'Canada SEMA',
  au_dfat_sanctions:       'Australia DFAT',
  us_bis_entity:           'US BIS Entity List',
  interpol_red_notices:    'Interpol Red Notices',
  worldbank_debarment:     'World Bank Debarment',
  us_fbi_most_wanted:      'FBI Most Wanted',
  eu_travel_bans:          'EU Travel Bans',
  gb_fcdo_russia:          'UK FCDO Russia',
  ua_nabc_sanctions:       'Ukraine NABC',
}

function datasetLabel(id: string): string {
  return DATASET_LABELS[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function schemaLabel(schema: string): string {
  const MAP: Record<string, string> = {
    Person: 'Person', Company: 'Company', Organization: 'Organization',
    LegalEntity: 'Legal Entity', Vessel: 'Vessel', Aircraft: 'Aircraft',
  }
  return MAP[schema] ?? schema
}

// ─── EntityCard ───────────────────────────────────────────────────────────────

interface EntityCardProps {
  id:           string
  caption:      string
  schema:       string
  datasets:     string[]
  datasetLabels?: string[]
  threatLevel:  ThreatLevel
  primaryAlias: string | null
  aliases:      string[]
  countries:    string[]
  topics:       string[]
}

function EntityCard({
  caption, schema, datasets, datasetLabels, threatLevel,
  primaryAlias, aliases, countries,
}: EntityCardProps) {
  const badge   = THREAT_BADGE[threatLevel]
  const slabel  = schemaLabel(schema)
  const dsLabels = datasetLabels ?? datasets.map(datasetLabel)
  const shownDs = dsLabels.slice(0, 4)
  const extraDs = dsLabels.length - shownDs.length

  const shownAliases = aliases.slice(0, 3)

  return (
    <div className="bg-[#161b22] border border-[rgba(255,255,255,0.07)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.14)] transition-all group">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${badge.className}`}>
              {badge.label}
            </span>
            <span className={`font-mono text-[10px] px-2 py-0.5 rounded ${SCHEMA_COLORS[schema] ?? 'bg-gray-500/15 text-gray-400'}`}>
              {slabel}
            </span>
          </div>
          <h3 className="text-[15px] font-semibold text-white leading-snug">{caption}</h3>
          {primaryAlias && primaryAlias !== caption && (
            <p className="text-[12px] text-[#8b949e] mt-0.5">aka {primaryAlias}</p>
          )}
        </div>
        <Link
          href={`/search?q=${encodeURIComponent(caption)}&type=signals`}
          className="flex-shrink-0 flex items-center gap-1 text-[11px] text-[#f5a623] hover:text-white font-mono opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
        >
          Search signals <ChevronRight size={12} />
        </Link>
      </div>

      {/* Dataset pills */}
      {shownDs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {shownDs.map(label => (
            <span
              key={label}
              className="font-mono text-[10px] px-2 py-0.5 rounded bg-[rgba(245,166,35,0.08)] text-[#f5a623] border border-[rgba(245,166,35,0.2)]"
            >
              {label}
            </span>
          ))}
          {extraDs > 0 && (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[rgba(255,255,255,0.05)] text-[#8b949e]">
              +{extraDs} more
            </span>
          )}
        </div>
      )}

      {/* Aliases row */}
      {shownAliases.length > 0 && (
        <div className="mb-2">
          <span className="font-mono text-[10px] text-[#8b949e] mr-1">Aliases:</span>
          <span className="text-[12px] text-[#c9d1d9]">{shownAliases.join(' · ')}</span>
        </div>
      )}

      {/* Countries row */}
      {countries.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {countries.slice(0, 5).map(code => (
            <span key={code} className="text-[14px]" title={code.toUpperCase()}>
              {countryFlag(code)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="bg-[#161b22] border border-[rgba(255,255,255,0.07)] rounded-xl p-4 animate-pulse">
      <div className="flex gap-2 mb-2">
        <div className="h-5 w-16 bg-[rgba(255,255,255,0.07)] rounded" />
        <div className="h-5 w-14 bg-[rgba(255,255,255,0.05)] rounded" />
      </div>
      <div className="h-4 w-48 bg-[rgba(255,255,255,0.07)] rounded mb-2" />
      <div className="h-3 w-32 bg-[rgba(255,255,255,0.04)] rounded mb-3" />
      <div className="flex gap-1.5">
        <div className="h-5 w-20 bg-[rgba(245,166,35,0.06)] rounded" />
        <div className="h-5 w-24 bg-[rgba(245,166,35,0.06)] rounded" />
        <div className="h-5 w-16 bg-[rgba(245,166,35,0.06)] rounded" />
      </div>
    </div>
  )
}

// ─── Schema filter pill ───────────────────────────────────────────────────────

const SCHEMA_FILTERS: SchemaFilter[] = ['All', 'Person', 'Organization', 'Vessel', 'Aircraft']

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SanctionsPage() {
  const [query, setQuery]             = useState('')
  const [schema, setSchema]           = useState<SchemaFilter>('All')
  const [searchResults, setSearch]    = useState<EntityResult[]>([])
  const [featured, setFeatured]       = useState<FeaturedEntity[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [loadingFeatured, setLoadingFeatured] = useState(true)
  const [searchError, setSearchError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load featured entities on mount ────────────────────────────────────────
  useEffect(() => {
    async function loadFeatured() {
      try {
        const res = await fetch(`${API_URL}/api/v1/sanctions/featured`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: { data: FeaturedEntity[] } = await res.json()
        setFeatured(json.data)
      } catch {
        // Non-fatal — page still functional via search
      } finally {
        setLoadingFeatured(false)
      }
    }
    loadFeatured()
  }, [])

  // ── Debounced search ────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string, s: SchemaFilter) => {
    if (!q.trim()) {
      setSearch([])
      setSearchError(null)
      return
    }
    setLoadingSearch(true)
    setSearchError(null)
    try {
      const params = new URLSearchParams({ q, limit: '20' })
      if (s !== 'All') params.set('schema', s)
      const res = await fetch(`${API_URL}/api/v1/search/entities?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: { entities: EntityResult[] } = await res.json()
      setSearch(json.entities)
    } catch {
      setSearchError('Search failed — please try again.')
    } finally {
      setLoadingSearch(false)
    }
  }, [])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val, schema), 250)
  }

  const handleSchemaChange = (s: SchemaFilter) => {
    setSchema(s)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query, s), 250)
  }

  const isSearching = query.trim().length > 0

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9]">
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[rgba(245,166,35,0.12)] border border-[rgba(245,166,35,0.25)] flex items-center justify-center">
              <Shield size={20} className="text-[#f5a623]" />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-white leading-tight">
                Sanctions &amp; Watchlist Intelligence
              </h1>
              <p className="text-[13px] text-[#8b949e] mt-0.5">
                Search 100+ global sanctions lists — OFAC SDN, EU FSF, UN Security Council, Interpol, and more
              </p>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex flex-wrap gap-4 mt-4">
            {[
              '100+ sanctions lists',
              'Real-time OFAC + EU monitoring',
              '300k+ entities',
            ].map(stat => (
              <div
                key={stat}
                className="flex items-center gap-1.5 font-mono text-[11px] text-[#8b949e]"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#f5a623]" />
                {stat}
              </div>
            ))}
          </div>
        </div>

        {/* ── Search section ────────────────────────────────────────────────── */}
        <div className="mb-6">
          {/* Search input */}
          <div className="relative mb-3">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8b949e] pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder="Search entities by name…"
              className="w-full bg-[#161b22] border border-[rgba(255,255,255,0.1)] rounded-xl pl-10 pr-4 py-3 text-[14px] text-white placeholder-[#8b949e] focus:outline-none focus:border-[rgba(245,166,35,0.5)] focus:ring-1 focus:ring-[rgba(245,166,35,0.2)] transition-all"
            />
          </div>

          {/* Schema filter pills */}
          <div className="flex flex-wrap gap-2">
            {SCHEMA_FILTERS.map(s => (
              <button
                key={s}
                onClick={() => handleSchemaChange(s)}
                className={`font-mono text-[11px] px-3 py-1.5 rounded-full border transition-all ${
                  schema === s
                    ? 'bg-[rgba(245,166,35,0.15)] border-[rgba(245,166,35,0.4)] text-[#f5a623]'
                    : 'bg-[#161b22] border-[rgba(255,255,255,0.1)] text-[#8b949e] hover:text-white hover:border-[rgba(255,255,255,0.2)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Search results ─────────────────────────────────────────────────── */}
        {isSearching && (
          <section className="mb-10">
            <div className="font-mono text-[11px] tracking-[2px] text-[#8b949e] uppercase mb-4">
              Search Results
            </div>

            {loadingSearch && (
              <div className="grid gap-3 sm:grid-cols-2">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            )}

            {!loadingSearch && searchError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-[13px] text-red-400">
                {searchError}
              </div>
            )}

            {!loadingSearch && !searchError && searchResults.length === 0 && (
              <div className="text-center py-12 text-[#8b949e]">
                <Shield size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-[14px]">No entities found for &ldquo;{query}&rdquo;</p>
                <p className="text-[12px] mt-1 text-[#6e7681]">Try a different name or remove the schema filter</p>
              </div>
            )}

            {!loadingSearch && searchResults.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {searchResults.map(e => {
                  const tl = deriveThreatLevel(e.datasets)
                  return (
                    <EntityCard
                      key={e.id}
                      id={e.id}
                      caption={e.caption}
                      schema={e.schema}
                      datasets={e.datasets}
                      threatLevel={tl}
                      primaryAlias={e.properties.alias?.[0] ?? null}
                      aliases={e.properties.alias ?? []}
                      countries={[...(e.properties.nationality ?? []), ...(e.properties.country ?? [])]}
                      topics={e.properties.topics ?? []}
                    />
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Featured section (shown when search is empty) ─────────────────── */}
        {!isSearching && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-[11px] tracking-[2px] text-[#8b949e] uppercase">
                High-Profile Sanctioned Entities
              </div>
              <a
                href="https://opensanctions.org"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono text-[10px] text-[#8b949e] hover:text-[#f5a623] transition-colors"
              >
                Powered by OpenSanctions <ExternalLink size={10} />
              </a>
            </div>

            {loadingFeatured && (
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            )}

            {!loadingFeatured && featured.length === 0 && (
              <div className="text-center py-12 text-[#8b949e]">
                <Shield size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-[14px]">Featured entities unavailable</p>
                <p className="text-[12px] mt-1 text-[#6e7681]">Use the search above to look up specific entities</p>
              </div>
            )}

            {featured.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {featured.map(e => (
                  <EntityCard
                    key={e.id}
                    id={e.id}
                    caption={e.caption}
                    schema={e.schema}
                    datasets={e.datasets}
                    datasetLabels={e.datasetLabels}
                    threatLevel={e.threatLevel}
                    primaryAlias={e.primaryAlias}
                    aliases={e.aliases}
                    countries={e.countries}
                    topics={e.topics}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
