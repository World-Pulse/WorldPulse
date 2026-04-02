'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventCluster {
  cluster_id: string
  primary_signal_id: string
  signal_ids: string[]
  categories: string[]
  sources: string[]
  severity: string
  correlation_type: string
  correlation_score: number
  created_at: string
  signals?: ClusterSignal[]
}

interface ClusterSignal {
  id: string
  title: string
  category: string
  severity: string
  reliability_score: number
  location_name: string | null
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high:     'bg-orange-500 text-white',
  medium:   'bg-yellow-500 text-black',
  low:      'bg-gray-500 text-white',
}

const SEVERITY_DOTS: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-400',
}

const CORRELATION_LABELS: Record<string, string> = {
  geo_temporal:    'Same Place & Time',
  causal_chain:    'Cause → Effect',
  keyword_overlap: 'Related Topics',
  multi_factor:    'Multi-Factor',
}

const CORRELATION_ICONS: Record<string, string> = {
  geo_temporal:    '📍',
  causal_chain:    '🔗',
  keyword_overlap: '🏷️',
  multi_factor:    '🧩',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClustersPage() {
  const [clusters, setClusters] = useState<EventCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null)

  const fetchClusters = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/signals/clusters/recent?limit=50`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const items = json.data ?? json.clusters ?? (Array.isArray(json) ? json : [])
      setClusters(items)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clusters')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchClusters()
    // Refresh every 2 minutes
    const interval = setInterval(fetchClusters, 120_000)
    return () => clearInterval(interval)
  }, [fetchClusters])

  const toggleExpand = (clusterId: string) => {
    setExpandedCluster(prev => prev === clusterId ? null : clusterId)
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    return `${diffDay}d ago`
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#0f0f1a]">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="text-2xl">🧩</span>
                Event Clusters
              </h1>
              <p className="text-gray-400 mt-1 text-sm">
                Cross-source intelligence correlation — when multiple feeds report on the same event
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {clusters.length} active cluster{clusters.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={fetchClusters}
                className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {loading && clusters.length === 0 && (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-[#12121f] rounded-lg p-6 animate-pulse">
                <div className="h-5 bg-gray-800 rounded w-1/3 mb-3" />
                <div className="h-4 bg-gray-800 rounded w-2/3 mb-2" />
                <div className="h-3 bg-gray-800 rounded w-1/4" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
            Failed to load clusters: {error}. The correlation engine may still be building clusters
            from incoming signals.
          </div>
        )}

        {!loading && !error && clusters.length === 0 && (
          <div className="bg-[#12121f] rounded-lg p-12 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-lg font-medium text-gray-300 mb-2">No event clusters yet</h3>
            <p className="text-gray-500 text-sm max-w-md mx-auto">
              The correlation engine analyzes incoming signals from all 27 OSINT feeds.
              When multiple sources report on the same event, they are automatically
              linked into a cluster here.
            </p>
          </div>
        )}

        {clusters.length > 0 && (
          <div className="space-y-4">
            {clusters.map(cluster => (
              <div
                key={cluster.cluster_id}
                className="bg-[#12121f] rounded-lg border border-gray-800 hover:border-gray-700 transition-colors overflow-hidden"
              >
                {/* Cluster Header */}
                <button
                  onClick={() => toggleExpand(cluster.cluster_id)}
                  className="w-full text-left p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Correlation type badge */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLORS[cluster.severity] ?? SEVERITY_COLORS.low}`}>
                          {cluster.severity.toUpperCase()}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-900/50 text-blue-300 border border-blue-800">
                          {CORRELATION_ICONS[cluster.correlation_type] ?? '🔗'}
                          {CORRELATION_LABELS[cluster.correlation_type] ?? cluster.correlation_type}
                        </span>
                        <span className="text-xs text-gray-500">
                          Score: {(cluster.correlation_score * 100).toFixed(0)}%
                        </span>
                      </div>

                      {/* Signal count + categories */}
                      <h3 className="text-base font-medium text-white mb-1">
                        {cluster.signal_ids.length} correlated signals across {cluster.categories.length} domain{cluster.categories.length !== 1 ? 's' : ''}
                      </h3>

                      {/* Categories */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {cluster.categories.map(cat => (
                          <span
                            key={cat}
                            className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-300 capitalize"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-xs text-gray-500">
                        {formatTime(cluster.created_at)}
                      </span>
                      {/* Visual cluster size indicator */}
                      <div className="flex gap-0.5 mt-1">
                        {cluster.signal_ids.slice(0, 12).map((_, i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full ${SEVERITY_DOTS[cluster.severity] ?? SEVERITY_DOTS.low}`}
                          />
                        ))}
                      </div>
                      <span className="text-[10px] text-gray-600 mt-1">
                        {expandedCluster === cluster.cluster_id ? '▲ collapse' : '▼ expand'}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Expanded: Signal list */}
                {expandedCluster === cluster.cluster_id && (
                  <div className="border-t border-gray-800 bg-[#0d0d18] px-5 py-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                      Correlated Signals
                    </h4>
                    {cluster.signals && cluster.signals.length > 0 ? (
                      <div className="space-y-2">
                        {cluster.signals.map(sig => (
                          <Link
                            key={sig.id}
                            href={`/posts/${sig.id}`}
                            className="block p-3 rounded-md bg-[#12121f] hover:bg-[#16162a] border border-gray-800 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOTS[sig.severity] ?? SEVERITY_DOTS.low}`} />
                              <span className="text-xs text-gray-400 capitalize">{sig.category}</span>
                              {sig.location_name && (
                                <span className="text-xs text-gray-500">· {sig.location_name}</span>
                              )}
                              <span className="text-xs text-gray-600 ml-auto">
                                {formatTime(sig.created_at)}
                              </span>
                            </div>
                            <p className="text-sm text-gray-200 line-clamp-2">
                              {sig.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-gray-500">
                                Reliability: {(sig.reliability_score * 100).toFixed(0)}%
                              </span>
                              {sig.id === cluster.primary_signal_id && (
                                <span className="text-[10px] text-blue-400 font-medium">
                                  PRIMARY
                                </span>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">
                        <p className="mb-2">Signal IDs in this cluster:</p>
                        <div className="flex flex-wrap gap-1">
                          {cluster.signal_ids.map(id => (
                            <Link
                              key={id}
                              href={`/posts/${id}`}
                              className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 text-[10px] font-mono transition-colors"
                            >
                              {id.slice(0, 8)}…
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
