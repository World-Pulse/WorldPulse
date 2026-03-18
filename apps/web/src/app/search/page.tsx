'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type SearchType = 'all' | 'signals' | 'posts' | 'users' | 'tags'

const TYPE_TABS: { id: SearchType; label: string; icon: string }[] = [
  { id: 'all',     label: 'All',     icon: '🔍' },
  { id: 'signals', label: 'Signals', icon: '📡' },
  { id: 'posts',   label: 'Posts',   icon: '💬' },
  { id: 'users',   label: 'People',  icon: '👤' },
  { id: 'tags',    label: 'Tags',    icon: '#' },
]

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-wp-red border-wp-red bg-[rgba(255,59,92,0.1)]',
  high:     'text-wp-amber border-wp-amber bg-[rgba(245,166,35,0.1)]',
  medium:   'text-wp-cyan border-wp-cyan bg-[rgba(0,212,255,0.1)]',
  low:      'text-wp-green border-wp-green bg-[rgba(0,230,118,0.1)]',
}

const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low', 'info']

const CATEGORY_OPTIONS = [
  'breaking', 'conflict', 'geopolitics', 'climate', 'health',
  'economy', 'technology', 'science', 'elections', 'culture',
  'disaster', 'security', 'sports', 'space', 'other',
]

const LANGUAGE_OPTIONS = [
  { value: '',   label: 'All Languages' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'de', label: 'German' },
  { value: 'zh', label: 'Mandarin' },
]

const SORT_OPTIONS = [
  { value: 'newest',   label: 'Newest first' },
  { value: 'oldest',   label: 'Oldest first' },
  { value: 'discussed', label: 'Most discussed' },
  { value: 'boosted',  label: 'Most boosted' },
]

interface SearchFilters {
  from:       string
  to:         string
  severity:   string[]
  category:   string[]
  source:     string
  language:   string
  sort:       string
}

function filtersEmpty(f: SearchFilters) {
  return !f.from && !f.to && f.severity.length === 0 && f.category.length === 0 && !f.source && !f.language && f.sort === 'newest'
}

function filtersToParams(q: string, type: SearchType, f: SearchFilters) {
  const p = new URLSearchParams({ q, type })
  if (f.from)              p.set('from', f.from)
  if (f.to)                p.set('to', f.to)
  if (f.severity.length)   p.set('severity', f.severity.join(','))
  if (f.category.length)   p.set('category', f.category.join(','))
  if (f.source)            p.set('source', f.source)
  if (f.language)          p.set('language', f.language)
  if (f.sort !== 'newest') p.set('sort', f.sort)
  return p
}

function parseFiltersFromParams(params: URLSearchParams): SearchFilters {
  return {
    from:     params.get('from')     ?? '',
    to:       params.get('to')       ?? '',
    severity: params.get('severity') ? params.get('severity')!.split(',') : [],
    category: params.get('category') ? params.get('category')!.split(',') : [],
    source:   params.get('source')   ?? '',
    language: params.get('language') ?? '',
    sort:     params.get('sort')     ?? 'newest',
  }
}

export default function SearchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [query, setQuery]       = useState(searchParams.get('q') ?? '')
  const [type, setType]         = useState<SearchType>((searchParams.get('type') as SearchType) ?? 'all')
  const [filters, setFilters]   = useState<SearchFilters>(parseFiltersFromParams(searchParams))
  const [showFilters, setShowFilters] = useState(false)
  const [results, setResults]   = useState<Record<string, unknown[]>>({})
  const [loading, setLoading]   = useState(false)
  const [autocomplete, setAutocomplete] = useState<{ signals: unknown[]; users: unknown[]; tags: string[] } | null>(null)
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [saveAlertName, setSaveAlertName] = useState('')
  const [showSaveAlert, setShowSaveAlert] = useState(false)
  const [alertSaved, setAlertSaved]       = useState(false)
  const [urlCopied, setUrlCopied]         = useState(false)

  const search = useCallback(async (q: string, t: SearchType, f: SearchFilters) => {
    if (!q.trim() || q.trim().length < 2) { setResults({}); return }
    setLoading(true)
    try {
      const params = filtersToParams(q, t, f)
      params.set('limit', '20')
      const res  = await fetch(`${API_URL}/api/v1/search?${params}`)
      const data = await res.json() as { success: boolean; data: { results: Record<string, unknown[]> } }
      if (data.success) setResults(data.data.results)
    } catch {
      // Demo results fallback
      setResults({
        signals: [
          { id: '1', title: `Search result for "${q}"`, category: 'breaking', severity: 'high', reliabilityScore: 0.95, locationName: 'Global', createdAt: new Date().toISOString() },
        ],
        posts: [],
        users: [],
        tags: [{ tag: q.toLowerCase(), count: 1 }],
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAutocomplete = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setAutocomplete(null); return }
    try {
      const res  = await fetch(`${API_URL}/api/v1/search/autocomplete?q=${encodeURIComponent(q)}`)
      const data = await res.json() as { success: boolean; data: typeof autocomplete }
      if (data.success) setAutocomplete(data.data)
    } catch { /* silent */ }
  }, [])

  // Debounced autocomplete
  useEffect(() => {
    const timer = setTimeout(() => fetchAutocomplete(query), 200)
    return () => clearTimeout(timer)
  }, [query, fetchAutocomplete])

  const handleSearch = (q: string = query, t: SearchType = type, f: SearchFilters = filters) => {
    setShowAutocomplete(false)
    const params = filtersToParams(q, t, f)
    router.push(`/search?${params}`, { scroll: false })
    search(q, t, f)
  }

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    const next = { ...filters, [key]: value }
    setFilters(next)
    if (query.trim().length >= 2) handleSearch(query, type, next)
  }

  const toggleMulti = (key: 'severity' | 'category', value: string) => {
    const arr = filters[key]
    const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]
    updateFilter(key, next)
  }

  const clearFilters = () => {
    const cleared: SearchFilters = { from: '', to: '', severity: [], category: [], source: '', language: '', sort: 'newest' }
    setFilters(cleared)
    if (query.trim().length >= 2) handleSearch(query, type, cleared)
  }

  // Run search on mount if URL has query
  useEffect(() => {
    const q = searchParams.get('q')
    if (q) search(q, type, filters)
  }, []) // eslint-disable-line

  // Share search URL
  const handleShareSearch = async () => {
    const url = `${window.location.origin}/search?${filtersToParams(query, type, filters)}`
    try {
      await navigator.clipboard.writeText(url)
      setUrlCopied(true)
      setTimeout(() => setUrlCopied(false), 2000)
    } catch {
      window.prompt('Copy this search URL:', url)
    }
  }

  // Save search as alert
  const handleSaveAlert = async () => {
    if (!saveAlertName.trim()) return
    const token = typeof window !== 'undefined' ? localStorage.getItem('wp_token') : null
    if (!token) { alert('Please log in to save alerts.'); return }
    try {
      const res = await fetch(`${API_URL}/api/v1/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name:       saveAlertName.trim(),
          keywords:   query ? [query] : [],
          categories: filters.category,
          minSeverity: filters.severity[0] ?? 'medium',
        }),
      })
      if (res.ok) {
        setAlertSaved(true)
        setShowSaveAlert(false)
        setSaveAlertName('')
        setTimeout(() => setAlertSaved(false), 3000)
      }
    } catch { /* silent */ }
  }

  const allSignals = results.signals as Array<{ id: string; title: string; category: string; severity: string; reliabilityScore: number; locationName: string; createdAt: string }> ?? []
  const allPosts   = results.posts   as Array<{ id: string; content: string; likeCount: number; createdAt: string }> ?? []
  const allUsers   = results.users   as Array<{ id: string; handle: string; displayName: string; avatarUrl: string | null; verified: boolean; followerCount: number }> ?? []
  const allTags    = results.tags    as Array<{ tag: string; count: number }> ?? []

  const hasResults = allSignals.length + allPosts.length + allUsers.length + allTags.length > 0
  const activeFilters = !filtersEmpty(filters)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* Search box */}
      <div className="relative mb-4">
        <div className="flex items-center gap-3 bg-wp-s2 border border-[rgba(255,255,255,0.12)] rounded-xl px-4 py-3 focus-within:border-wp-amber transition-colors">
          <span className="text-wp-text3 text-[18px]">🔍</span>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setShowAutocomplete(true) }}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            onFocus={() => setShowAutocomplete(true)}
            onBlur={() => setTimeout(() => setShowAutocomplete(false), 150)}
            placeholder="Search signals, posts, people, tags…"
            className="flex-1 bg-transparent border-none outline-none text-wp-text text-[16px] placeholder-wp-text3 caret-wp-amber"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults({}) }} className="text-wp-text3 hover:text-wp-text">✕</button>
          )}
          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1 px-3 py-[6px] rounded-lg text-[12px] font-medium border transition-all
              ${showFilters || activeFilters
                ? 'bg-[rgba(245,166,35,0.15)] border-wp-amber text-wp-amber'
                : 'border-[rgba(255,255,255,0.1)] text-wp-text2 hover:border-wp-amber hover:text-wp-amber'}`}
          >
            <span>⚙</span>
            Filters
            {activeFilters && <span className="w-[6px] h-[6px] rounded-full bg-wp-amber ml-1" />}
          </button>
          <button onClick={() => handleSearch()} className="px-4 py-[6px] rounded-lg bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all">
            Search
          </button>
        </div>

        {/* Autocomplete dropdown */}
        {showAutocomplete && autocomplete && (query.length >= 2) && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-wp-s2 border border-[rgba(255,255,255,0.1)] rounded-xl overflow-hidden z-50 shadow-xl">
            {autocomplete.signals?.map((s: unknown) => {
              const sig = s as { id: string; title: string; category: string }
              return (
                <div key={sig.id} onMouseDown={() => { setQuery(sig.title); handleSearch(sig.title) }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-wp-s3 cursor-pointer">
                  <span className="text-[14px]">📡</span>
                  <div>
                    <div className="text-[13px] text-wp-text">{sig.title}</div>
                    <div className="font-mono text-[10px] text-wp-text3 uppercase">{sig.category}</div>
                  </div>
                </div>
              )
            })}
            {autocomplete.users?.map((u: unknown) => {
              const user = u as { id: string; handle: string; displayName: string }
              return (
                <div key={user.id} onMouseDown={() => router.push(`/@${user.handle}`)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-wp-s3 cursor-pointer">
                  <span className="text-[14px]">👤</span>
                  <div>
                    <div className="text-[13px] text-wp-text">{user.displayName}</div>
                    <div className="font-mono text-[10px] text-wp-text3">@{user.handle}</div>
                  </div>
                </div>
              )
            })}
            {autocomplete.tags?.map(tag => (
              <div key={tag} onMouseDown={() => { setQuery(tag); handleSearch(tag, 'tags') }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-wp-s3 cursor-pointer">
                <span className="font-mono text-wp-amber font-bold">#</span>
                <span className="text-[13px] text-wp-text">{tag}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced filters panel */}
      {showFilters && (
        <div className="mb-4 bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Advanced Filters</span>
            {activeFilters && (
              <button onClick={clearFilters} className="text-[11px] text-wp-amber hover:underline">
                Clear all
              </button>
            )}
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] text-wp-text3 mb-1 uppercase tracking-wide">From date</label>
              <input
                type="date"
                value={filters.from}
                onChange={e => updateFilter('from', e.target.value)}
                className="w-full bg-wp-s3 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] text-wp-text focus:outline-none focus:border-wp-amber [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-wp-text3 mb-1 uppercase tracking-wide">To date</label>
              <input
                type="date"
                value={filters.to}
                onChange={e => updateFilter('to', e.target.value)}
                className="w-full bg-wp-s3 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] text-wp-text focus:outline-none focus:border-wp-amber [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Severity filter */}
          <div>
            <label className="block font-mono text-[10px] text-wp-text3 mb-2 uppercase tracking-wide">Severity</label>
            <div className="flex flex-wrap gap-2">
              {SEVERITY_OPTIONS.map(sev => {
                const active = filters.severity.includes(sev)
                return (
                  <button
                    key={sev}
                    onClick={() => toggleMulti('severity', sev)}
                    className={`font-mono text-[11px] px-3 py-1 rounded-full border transition-all
                      ${active
                        ? (SEVERITY_COLORS[sev] ?? 'text-wp-text border-wp-text bg-[rgba(255,255,255,0.1)]')
                        : 'text-wp-text3 border-[rgba(255,255,255,0.08)] hover:border-wp-amber hover:text-wp-amber'}`}
                  >
                    {sev.toUpperCase()}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Category filter */}
          <div>
            <label className="block font-mono text-[10px] text-wp-text3 mb-2 uppercase tracking-wide">Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map(cat => {
                const active = filters.category.includes(cat)
                return (
                  <button
                    key={cat}
                    onClick={() => toggleMulti('category', cat)}
                    className={`font-mono text-[11px] px-3 py-1 rounded-full border transition-all
                      ${active
                        ? 'text-wp-amber border-wp-amber bg-[rgba(245,166,35,0.1)]'
                        : 'text-wp-text3 border-[rgba(255,255,255,0.08)] hover:border-wp-amber hover:text-wp-amber'}`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Source & Language row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] text-wp-text3 mb-1 uppercase tracking-wide">Source</label>
              <input
                type="text"
                value={filters.source}
                onChange={e => updateFilter('source', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="e.g. Reuters"
                className="w-full bg-wp-s3 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] text-wp-text focus:outline-none focus:border-wp-amber placeholder-wp-text3"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-wp-text3 mb-1 uppercase tracking-wide">Language</label>
              <select
                value={filters.language}
                onChange={e => updateFilter('language', e.target.value)}
                className="w-full bg-wp-s3 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] text-wp-text focus:outline-none focus:border-wp-amber"
              >
                {LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Sort */}
          <div>
            <label className="block font-mono text-[10px] text-wp-text3 mb-2 uppercase tracking-wide">Sort by</label>
            <div className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateFilter('sort', opt.value)}
                  className={`text-[12px] px-3 py-1 rounded-full border transition-all
                    ${filters.sort === opt.value
                      ? 'text-wp-amber border-wp-amber bg-[rgba(245,166,35,0.1)] font-medium'
                      : 'text-wp-text3 border-[rgba(255,255,255,0.08)] hover:border-wp-amber hover:text-wp-amber'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Action bar: save + share */}
      {query.trim().length >= 2 && (
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={handleShareSearch}
            className="flex items-center gap-1 px-3 py-[6px] rounded-lg border border-[rgba(255,255,255,0.08)] text-[12px] text-wp-text2 hover:border-wp-cyan hover:text-wp-cyan transition-all"
          >
            {urlCopied ? '✓ Copied!' : '🔗 Share search'}
          </button>
          <button
            onClick={() => setShowSaveAlert(v => !v)}
            className={`flex items-center gap-1 px-3 py-[6px] rounded-lg border text-[12px] transition-all
              ${alertSaved ? 'border-wp-green text-wp-green bg-[rgba(0,230,118,0.08)]' : 'border-[rgba(255,255,255,0.08)] text-wp-text2 hover:border-wp-amber hover:text-wp-amber'}`}
          >
            {alertSaved ? '✓ Alert saved!' : '🔔 Save as alert'}
          </button>
          {showSaveAlert && !alertSaved && (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={saveAlertName}
                onChange={e => setSaveAlertName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveAlert()}
                placeholder="Alert name…"
                autoFocus
                className="flex-1 bg-wp-s2 border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-[6px] text-[12px] text-wp-text focus:outline-none focus:border-wp-amber placeholder-wp-text3"
              />
              <button
                onClick={handleSaveAlert}
                disabled={!saveAlertName.trim()}
                className="px-3 py-[6px] rounded-lg bg-wp-amber text-black text-[12px] font-bold hover:bg-[#ffb84d] disabled:opacity-40 transition-all"
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}

      {/* Type tabs */}
      <div className="flex gap-0 border-b border-[rgba(255,255,255,0.07)] mb-6">
        {TYPE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setType(tab.id); if (query) handleSearch(query, tab.id) }}
            className={`flex items-center gap-1 px-4 py-[10px] text-[13px] font-medium border-b-2 transition-all
              ${type === tab.id ? 'text-wp-amber border-wp-amber' : 'text-wp-text3 border-transparent hover:text-wp-text2'}`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 rounded-xl shimmer" />
          ))}
        </div>
      )}

      {/* Results */}
      {!loading && hasResults && (
        <div className="space-y-6">

          {/* Signals */}
          {allSignals.length > 0 && (
            <section>
              {type === 'all' && <SectionHeader label="Signals" count={allSignals.length} />}
              <div className="space-y-2">
                {allSignals.map(sig => (
                  <div key={sig.id} className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.15)] transition-all cursor-pointer">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`font-mono text-[9px] px-2 py-0.5 rounded border ${SEVERITY_COLORS[sig.severity] ?? ''}`}>
                        {sig.severity?.toUpperCase()}
                      </span>
                      <span className="font-mono text-[9px] text-wp-text3 uppercase">{sig.category}</span>
                      {sig.locationName && <span className="font-mono text-[10px] text-wp-text2 ml-auto">📍 {sig.locationName}</span>}
                    </div>
                    <div className="text-[14px] font-semibold text-wp-text leading-snug">{sig.title}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex gap-0.5">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className={`w-[5px] h-[5px] rounded-full ${i < Math.round(sig.reliabilityScore * 5) ? 'bg-wp-green' : 'bg-wp-s3'}`} />
                        ))}
                      </div>
                      <span className="font-mono text-[10px] text-wp-text3">
                        {new Date(sig.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Posts */}
          {allPosts.length > 0 && (
            <section>
              {type === 'all' && <SectionHeader label="Posts" count={allPosts.length} />}
              <div className="space-y-2">
                {allPosts.map((post: unknown) => {
                  const p = post as { id: string; content: string; likeCount: number; boostCount: number; replyCount: number; createdAt: string; author?: { handle: string; displayName: string; verified: boolean } }
                  return (
                    <div key={p.id} className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.15)] transition-all cursor-pointer">
                      {p.author && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-[13px] text-wp-text">{p.author.displayName}</span>
                          {p.author.verified && <span className="text-wp-cyan text-[11px]">✓</span>}
                          <span className="font-mono text-[11px] text-wp-text3">@{p.author.handle}</span>
                        </div>
                      )}
                      <div className="text-[13px] text-wp-text2 leading-relaxed line-clamp-3">{p.content}</div>
                      <div className="flex items-center gap-4 mt-2 font-mono text-[11px] text-wp-text3">
                        <span>❤ {p.likeCount ?? 0}</span>
                        <span>🔁 {p.boostCount ?? 0}</span>
                        <span>💬 {p.replyCount ?? 0}</span>
                        <span className="ml-auto">{new Date(p.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Users */}
          {allUsers.length > 0 && (
            <section>
              {type === 'all' && <SectionHeader label="People" count={allUsers.length} />}
              <div className="space-y-2">
                {allUsers.map(user => (
                  <div key={user.id} onClick={() => router.push(`/@${user.handle}`)} className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4 flex items-center gap-3 hover:border-[rgba(255,255,255,0.15)] transition-all cursor-pointer">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-black flex-shrink-0">
                      {user.handle.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[14px] text-wp-text flex items-center gap-1">
                        {user.displayName}
                        {user.verified && <span className="text-wp-cyan text-[11px]">✓</span>}
                      </div>
                      <div className="font-mono text-[12px] text-wp-text3">@{user.handle}</div>
                    </div>
                    <div className="font-mono text-[11px] text-wp-text2">{user.followerCount?.toLocaleString()} followers</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tags */}
          {allTags.length > 0 && (
            <section>
              {type === 'all' && <SectionHeader label="Tags" count={allTags.length} />}
              <div className="flex flex-wrap gap-2">
                {allTags.map(item => (
                  <button
                    key={item.tag}
                    onClick={() => handleSearch(item.tag, 'signals')}
                    className="tag-pill tag-breaking"
                  >
                    #{item.tag} · {item.count?.toLocaleString() ?? '?'}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && query.length >= 2 && !hasResults && (
        <div className="text-center py-16">
          <div className="text-[48px] mb-4">🔭</div>
          <div className="text-[18px] font-semibold text-wp-text mb-2">No results for "{query}"</div>
          <div className="text-wp-text3 text-[14px]">
            {activeFilters ? 'Try removing some filters or ' : 'Try different keywords or '}
            check the spelling
          </div>
          {activeFilters && (
            <button onClick={clearFilters} className="mt-3 text-[13px] text-wp-amber hover:underline">
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Initial state */}
      {!query && (
        <div className="text-center py-12">
          <div className="text-[48px] mb-4">🌍</div>
          <div className="text-[18px] font-semibold text-wp-text mb-2">Search WorldPulse</div>
          <div className="text-wp-text3 text-[14px] mb-8">Find signals, posts, people, and topics</div>
          <div className="flex flex-wrap justify-center gap-2">
            {['#ManilaQuake','#EUAIDirective','#ArcticMelt','#Gaza','#Elections2026'].map(tag => (
              <button
                key={tag}
                onClick={() => { setQuery(tag); handleSearch(tag) }}
                className="tag-pill tag-breaking"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">{label}</span>
      <span className="font-mono text-[10px] text-wp-amber bg-[rgba(245,166,35,0.1)] border border-[rgba(245,166,35,0.2)] px-2 py-0.5 rounded-full">{count}</span>
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
    </div>
  )
}
