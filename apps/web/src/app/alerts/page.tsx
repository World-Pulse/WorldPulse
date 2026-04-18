'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Bell, Inbox } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const CATEGORIES = [
  { id: 'breaking',    label: 'Breaking News',  icon: '🚨' },
  { id: 'conflict',    label: 'Conflict',        icon: '⚔️' },
  { id: 'climate',     label: 'Climate',         icon: '🌡️' },
  { id: 'economy',     label: 'Markets',         icon: '📈' },
  { id: 'health',      label: 'Health',          icon: '🏥' },
  { id: 'technology',  label: 'Technology',      icon: '💻' },
  { id: 'elections',   label: 'Elections',       icon: '🗳️' },
  { id: 'disaster',    label: 'Disaster',        icon: '🌊' },
  { id: 'security',    label: 'Security',        icon: '🔒' },
  { id: 'geopolitics', label: 'Geopolitics',     icon: '🌐' },
]

const SEVERITIES = [
  { id: 'critical', label: 'Critical',  color: 'text-wp-red   border-wp-red   bg-[rgba(255,59,92,0.1)]' },
  { id: 'high',     label: 'High',      color: 'text-wp-amber border-wp-amber bg-[rgba(245,166,35,0.1)]' },
  { id: 'medium',   label: 'Medium',    color: 'text-wp-cyan  border-wp-cyan  bg-[rgba(0,212,255,0.1)]' },
  { id: 'low',      label: 'Low',       color: 'text-wp-green border-wp-green bg-[rgba(0,230,118,0.1)]' },
]

interface AlertPrefs {
  enabled:     boolean
  categories:  string[]
  severities:  string[]
  emailAlerts: boolean
  pushAlerts:  boolean
  digestOnly:  boolean
  quietHours:  boolean
  quietStart:  string
  quietEnd:    string
}

const DEFAULT_PREFS: AlertPrefs = {
  enabled:    true,
  categories: ['breaking', 'conflict', 'disaster'],
  severities: ['critical', 'high'],
  emailAlerts: false,
  pushAlerts:  false,
  digestOnly:  false,
  quietHours:  false,
  quietStart:  '22:00',
  quietEnd:    '07:00',
}

interface Alert {
  id: string
  title: string
  category: string
  severity: string
  createdAt: string
  read: boolean
}

export default function AlertsPage() {
  const [prefs, setPrefs]         = useState<AlertPrefs>(DEFAULT_PREFS)
  const [alerts, setAlerts]       = useState<Alert[]>([])
  const [tab, setTab]             = useState<'inbox' | 'settings'>('inbox')
  const [loading, setLoading]     = useState(true)
  const [saved, setSaved]         = useState(false)
  const [loggedIn, setLoggedIn]   = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('wp_access_token')
    setLoggedIn(!!token)

    // Load saved prefs from localStorage
    const raw = localStorage.getItem('wp_alert_prefs')
    if (raw) {
      try { setPrefs(JSON.parse(raw)) } catch { /* ignore */ }
    }

    if (token) {
      fetch(`${API_URL}/api/v1/alerts`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(d => { if (d.success) setAlerts(d.data?.items ?? []) })
        .catch(() => {})
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  function toggleCategory(id: string) {
    setPrefs(p => ({
      ...p,
      categories: p.categories.includes(id)
        ? p.categories.filter(c => c !== id)
        : [...p.categories, id],
    }))
  }

  function toggleSeverity(id: string) {
    setPrefs(p => ({
      ...p,
      severities: p.severities.includes(id)
        ? p.severities.filter(s => s !== id)
        : [...p.severities, id],
    }))
  }

  function savePrefs() {
    localStorage.setItem('wp_alert_prefs', JSON.stringify(prefs))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function markAllRead() {
    setAlerts(prev => prev.map(a => ({ ...a, read: true })))
  }

  const unreadCount = alerts.filter(a => !a.read).length

  const SEVERITY_COLORS: Record<string, string> = {
    critical: 'text-wp-red',
    high:     'text-wp-amber',
    medium:   'text-wp-cyan',
    low:      'text-wp-green',
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-wp-text">Alerts</h1>
          <p className="text-[13px] text-wp-text3 mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && tab === 'inbox' && (
            <button
              onClick={markAllRead}
              className="px-3 py-[6px] rounded-lg border border-[rgba(255,255,255,0.1)] text-[12px] text-wp-text2 hover:border-wp-amber hover:text-wp-amber transition-all"
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[rgba(255,255,255,0.07)] mb-6">
        {(['inbox', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-[10px] text-[13px] font-medium border-b-2 capitalize transition-all
              ${tab === t ? 'text-wp-amber border-wp-amber' : 'text-wp-text3 border-transparent hover:text-wp-text2'}`}
          >
            {t === 'inbox' ? `Inbox${unreadCount > 0 ? ` (${unreadCount})` : ''}` : 'Settings'}
          </button>
        ))}
      </div>

      {/* INBOX TAB */}
      {tab === 'inbox' && (
        <>
          {!loggedIn && (
            <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-8 text-center">
              <Bell className="w-10 h-10 text-wp-text3 mx-auto mb-3" />
              <div className="text-[16px] font-semibold text-wp-text mb-2">Sign in to see your alerts</div>
              <p className="text-[13px] text-wp-text3 mb-5">Get notified about breaking signals matching your interests</p>
              <div className="flex gap-3 justify-center">
                <Link href="/auth/login" className="px-5 py-2 rounded-lg border border-[rgba(255,255,255,0.15)] text-[13px] text-wp-text2 hover:border-wp-amber hover:text-wp-amber transition-all">
                  Sign In
                </Link>
                <Link href="/auth/register" className="px-5 py-2 rounded-lg bg-wp-amber text-black text-[13px] font-bold hover:bg-[#ffb84d] transition-all">
                  Join Free
                </Link>
              </div>
            </div>
          )}

          {loggedIn && loading && (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl shimmer" />)}
            </div>
          )}

          {loggedIn && !loading && alerts.length === 0 && (
            <div className="text-center py-16">
              <Inbox className="w-12 h-12 text-wp-text3 mx-auto mb-4" />
              <div className="text-[16px] font-semibold text-wp-text mb-2">No alerts yet</div>
              <p className="text-[13px] text-wp-text3">Configure your alert preferences to start receiving notifications about breaking signals.</p>
              <button
                onClick={() => setTab('settings')}
                className="mt-4 px-5 py-2 rounded-lg bg-wp-amber text-black font-bold text-[13px] hover:bg-[#ffb84d] transition-all"
              >
                Configure Alerts
              </button>
            </div>
          )}

          {loggedIn && !loading && alerts.length > 0 && (
            <div className="space-y-2">
              {alerts.map(alert => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer hover:border-[rgba(255,255,255,0.15)]
                    ${alert.read
                      ? 'bg-wp-surface border-[rgba(255,255,255,0.05)] opacity-70'
                      : 'bg-wp-s2 border-[rgba(255,255,255,0.1)]'}`}
                >
                  {!alert.read && (
                    <div className="w-2 h-2 rounded-full bg-wp-amber mt-1.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-wp-text leading-snug">{alert.title}</div>
                    <div className="flex items-center gap-2 mt-1 font-mono text-[10px]">
                      <span className={SEVERITY_COLORS[alert.severity] ?? 'text-wp-text3'}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className="text-wp-text3">·</span>
                      <span className="text-wp-text3">{alert.category}</span>
                      <span className="text-wp-text3 ml-auto">
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* SETTINGS TAB */}
      {tab === 'settings' && (
        <div className="space-y-6">

          {/* Master toggle */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14px] font-semibold text-wp-text">Enable Alerts</div>
                <div className="text-[12px] text-wp-text3 mt-0.5">Receive notifications for breaking signals</div>
              </div>
              <button
                onClick={() => setPrefs(p => ({ ...p, enabled: !p.enabled }))}
                className={`relative w-12 h-6 rounded-full transition-all ${prefs.enabled ? 'bg-wp-amber' : 'bg-wp-s3'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-all ${prefs.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>

          {/* Category filters */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
            <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-4">Alert Categories</div>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-[13px] transition-all text-left
                    ${prefs.categories.includes(cat.id)
                      ? 'border-wp-amber bg-[rgba(245,166,35,0.1)] text-wp-amber'
                      : 'border-[rgba(255,255,255,0.07)] text-wp-text2 hover:border-[rgba(255,255,255,0.15)]'}`}
                >
                  <span>{cat.icon}</span>
                  <span className="font-medium">{cat.label}</span>
                  {prefs.categories.includes(cat.id) && <span className="ml-auto text-[10px]">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Severity filters */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
            <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-4">Minimum Severity</div>
            <div className="flex gap-2 flex-wrap">
              {SEVERITIES.map(sev => (
                <button
                  key={sev.id}
                  onClick={() => toggleSeverity(sev.id)}
                  className={`px-4 py-2 rounded-full border text-[12px] font-medium transition-all
                    ${prefs.severities.includes(sev.id) ? sev.color : 'border-[rgba(255,255,255,0.07)] text-wp-text3 hover:border-[rgba(255,255,255,0.15)]'}`}
                >
                  {sev.label}
                </button>
              ))}
            </div>
          </div>

          {/* Delivery */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 space-y-4">
            <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Delivery</div>
            {[
              { key: 'emailAlerts', label: 'Email alerts', desc: 'Get critical signals via email' },
              { key: 'pushAlerts',  label: 'Push notifications', desc: 'Browser push (requires permission)' },
              { key: 'digestOnly',  label: 'Digest only', desc: 'One daily summary instead of instant alerts' },
              { key: 'quietHours', label: 'Quiet hours', desc: 'Suppress alerts during set hours' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] text-wp-text">{label}</div>
                  <div className="text-[11px] text-wp-text3">{desc}</div>
                </div>
                <button
                  onClick={() => setPrefs(p => ({ ...p, [key]: !p[key as keyof AlertPrefs] }))}
                  className={`relative w-10 h-5 rounded-full transition-all ${prefs[key as keyof AlertPrefs] ? 'bg-wp-amber' : 'bg-wp-s3'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all ${prefs[key as keyof AlertPrefs] ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}

            {prefs.quietHours && (
              <div className="flex items-center gap-3 pt-2 border-t border-[rgba(255,255,255,0.05)]">
                <div className="text-[12px] text-wp-text2">From</div>
                <input
                  type="time"
                  value={prefs.quietStart}
                  onChange={e => setPrefs(p => ({ ...p, quietStart: e.target.value }))}
                  className="bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-lg px-2 py-1 text-[13px] text-wp-text focus:outline-none focus:border-wp-amber"
                />
                <div className="text-[12px] text-wp-text2">to</div>
                <input
                  type="time"
                  value={prefs.quietEnd}
                  onChange={e => setPrefs(p => ({ ...p, quietEnd: e.target.value }))}
                  className="bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-lg px-2 py-1 text-[13px] text-wp-text focus:outline-none focus:border-wp-amber"
                />
              </div>
            )}
          </div>

          <button
            onClick={savePrefs}
            className="w-full py-3 rounded-xl bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all"
          >
            {saved ? '✓ Saved' : 'Save Alert Preferences'}
          </button>
        </div>
      )}
    </div>
  )
}
