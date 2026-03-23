'use client'

import { useState, useEffect, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type Tier = 'free' | 'pro' | 'enterprise'

interface ApiKey {
  id: string
  name: string
  tier: Tier
  rate_limit_per_min: number
  rate_limit_per_day: number
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

const TIER_META: Record<Tier, { label: string; color: string; rpm: string }> = {
  free:       { label: 'Free',       color: 'bg-[rgba(74,85,104,0.3)] text-[#8892a4] border border-[rgba(74,85,104,0.4)]',       rpm: '60 req/min' },
  pro:        { label: 'Pro',        color: 'bg-[rgba(245,166,35,0.12)] text-wp-amber border border-[rgba(245,166,35,0.3)]',     rpm: '300 req/min' },
  enterprise: { label: 'Enterprise', color: 'bg-[rgba(0,212,255,0.10)] text-[#00d4ff] border border-[rgba(0,212,255,0.3)]',     rpm: 'Unlimited' },
}

function TierBadge({ tier }: { tier: Tier }) {
  const m = TIER_META[tier]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium tracking-wide ${m.color}`}>
      {m.label}
    </span>
  )
}

function formatDate(iso: string | null) {
  if (!iso) return <span className="text-wp-text3">Never</span>
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DeveloperPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Create modal
  const [modalOpen, setModalOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTier, setNewTier] = useState<Tier>('free')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [generatedKey, setGeneratedKey] = useState('')
  const [copied, setCopied] = useState(false)

  // Revoke state
  const [revoking, setRevoking] = useState<string | null>(null)

  const token = typeof window !== 'undefined' ? localStorage.getItem('wp_access_token') : null

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/v1/developer/keys`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load keys')
      setKeys(data.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/developer/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName, tier: newTier }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create key')
      setGeneratedKey(data.data.key)
      setKeys(prev => [data.data, ...prev])
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id)
    try {
      const res = await fetch(`${API_URL}/api/v1/developer/keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to revoke')
      setKeys(prev => prev.map(k => k.id === id ? { ...k, is_active: false } : k))
    } catch {
      // silent — key row stays as-is
    } finally {
      setRevoking(null)
    }
  }

  function handleCloseModal() {
    setModalOpen(false)
    setNewName('')
    setNewTier('free')
    setCreateError('')
    setGeneratedKey('')
    setCopied(false)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(generatedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="font-display text-[28px] tracking-[2px] text-wp-text mb-2">
          DEVELOPER <span className="text-wp-amber">API</span>
        </h1>
        <p className="text-[14px] text-wp-text2 max-w-xl">
          Integrate WorldPulse signals, feeds, and search into your applications.
          Create and manage API keys below. Keep your keys secret — they grant access to the API on your behalf.
        </p>
      </div>

      {/* ── Quick links ────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-8">
        <a
          href="/developer/embed"
          className="glass border border-[rgba(255,255,255,0.07)] hover:border-wp-amber rounded-xl px-4 py-3 flex items-center gap-3 group transition-colors no-underline"
        >
          <span className="text-[20px]">🔌</span>
          <div>
            <p className="text-[13px] font-semibold text-wp-text group-hover:text-wp-amber transition-colors">
              Embed Widget
            </p>
            <p className="text-[11px] text-wp-text2 mt-0.5">
              Add a live signal feed to any website
            </p>
          </div>
        </a>
      </div>

      {/* ── Tier limits info ───────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        {(Object.entries(TIER_META) as [Tier, typeof TIER_META[Tier]][]).map(([tier, meta]) => (
          <div key={tier} className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TierBadge tier={tier} />
            </div>
            <p className="text-[22px] font-mono font-semibold text-wp-text">{meta.rpm}</p>
            {tier === 'free' && <p className="text-[11px] text-wp-text2 mt-1">1,000 req/day · Public signals only</p>}
            {tier === 'pro' && <p className="text-[11px] text-wp-text2 mt-1">10,000 req/day · Full access</p>}
            {tier === 'enterprise' && <p className="text-[11px] text-wp-text2 mt-1">Unlimited · Priority support</p>}
          </div>
        ))}
      </div>

      {/* ── Keys table ─────────────────────────────────────── */}
      <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <h2 className="text-[14px] font-semibold text-wp-text">Your API Keys</h2>
          <button
            onClick={() => setModalOpen(true)}
            className="bg-wp-amber text-black font-bold text-[13px] px-4 py-1.5 rounded-lg hover:bg-[#ffb84d] transition-colors"
          >
            + Create New Key
          </button>
        </div>

        {loading && (
          <div className="px-5 py-8 text-center text-[13px] text-wp-text2">Loading…</div>
        )}

        {!loading && error && (
          <div className="px-5 py-6 text-center text-[13px] text-wp-red">{error}</div>
        )}

        {!loading && !error && keys.length === 0 && (
          <div className="px-5 py-10 text-center text-[13px] text-wp-text2">
            No API keys yet. Create one to get started.
          </div>
        )}

        {!loading && !error && keys.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.05)]">
                  {['Name', 'Tier', 'Created', 'Last Used', 'Status', ''].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-mono text-wp-text2 tracking-wider uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr
                    key={k.id}
                    className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                  >
                    <td className="px-5 py-3 text-wp-text font-medium">{k.name}</td>
                    <td className="px-5 py-3"><TierBadge tier={k.tier} /></td>
                    <td className="px-5 py-3 text-wp-text2">{formatDate(k.created_at)}</td>
                    <td className="px-5 py-3 text-wp-text2">{formatDate(k.last_used_at)}</td>
                    <td className="px-5 py-3">
                      {k.is_active ? (
                        <span className="inline-flex items-center gap-1.5 text-[#00e676] text-[12px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00e676]" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-wp-text3 text-[12px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-wp-text3" />
                          Revoked
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {k.is_active && (
                        <button
                          onClick={() => handleRevoke(k.id)}
                          disabled={revoking === k.id}
                          className="text-[12px] text-wp-red hover:text-[#ff6b82] transition-colors disabled:opacity-40"
                        >
                          {revoking === k.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create Key Modal ───────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(6,7,13,0.85)', backdropFilter: 'blur(6px)' }}
        >
          <div className="glass border border-[rgba(255,255,255,0.1)] rounded-2xl w-full max-w-md p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[16px] font-semibold text-wp-text">Create API Key</h3>
              <button
                onClick={handleCloseModal}
                className="text-wp-text2 hover:text-wp-text text-[20px] leading-none transition-colors"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {!generatedKey ? (
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                {createError && (
                  <div className="bg-[rgba(255,59,92,0.1)] border border-[rgba(255,59,92,0.3)] rounded-lg px-4 py-3 text-[13px] text-wp-red">
                    {createError}
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-wp-text2 font-medium">Key Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    required
                    maxLength={100}
                    placeholder="e.g. My App Production"
                    className="bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-wp-text2 font-medium">Tier</label>
                  <select
                    value={newTier}
                    onChange={e => setNewTier(e.target.value as Tier)}
                    className="bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text outline-none focus:border-wp-amber transition-colors"
                  >
                    <option value="free">Free — 60 req/min</option>
                    <option value="pro">Pro — 300 req/min</option>
                    <option value="enterprise">Enterprise — Unlimited</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={creating}
                  className="mt-1 bg-wp-amber text-black font-bold text-[14px] rounded-lg py-2 hover:bg-[#ffb84d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? 'Creating…' : 'Create Key'}
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="bg-[rgba(255,59,92,0.08)] border border-[rgba(255,59,92,0.25)] rounded-lg px-4 py-3 text-[13px] text-wp-red">
                  This key will only be shown once. Copy it now and store it securely.
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-wp-text2 font-medium">Your API Key</label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={generatedKey}
                      className="flex-1 bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] font-mono text-wp-text outline-none select-all"
                    />
                    <button
                      onClick={handleCopy}
                      className="shrink-0 bg-wp-surface3 border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-[12px] text-wp-text hover:border-wp-amber hover:text-wp-amber transition-colors"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleCloseModal}
                  className="bg-wp-surface3 border border-[rgba(255,255,255,0.1)] text-wp-text font-medium text-[14px] rounded-lg py-2 hover:border-wp-amber transition-colors"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
