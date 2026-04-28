'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low'] as const
type MinSeverity = typeof SEVERITY_OPTIONS[number]

const CATEGORIES = [
  'breaking', 'conflict', 'weather', 'seismic', 'health',
  'political', 'technology', 'science', 'military', 'finance',
]

interface NotificationSettings {
  telegram_chat_id?: string
  telegram_bot_token?: string
  discord_webhook_url?: string
  min_severity: MinSeverity
  categories: string[]
  enabled: boolean
}

const DEFAULT_SETTINGS: NotificationSettings = {
  min_severity: 'high',
  categories: [],
  enabled: false,
}

type ToastType = 'success' | 'error'
interface Toast { msg: string; type: ToastType }

export default function NotificationsSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [showBotToken, setShowBotToken] = useState(false)

  const showToast = (msg: string, type: ToastType) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    const token = localStorage.getItem('wp_access_token')
    if (!token) { setLoading(false); return }

    fetch('/api/v1/notifications/settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((data: NotificationSettings) => setSettings({ ...DEFAULT_SETTINGS, ...data }))
      .catch(() => {/* use defaults */})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    const token = localStorage.getItem('wp_access_token')
    if (!token) { showToast('Not authenticated', 'error'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/v1/notifications/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(settings),
      })
      if (!r.ok) throw new Error((await r.json()).message ?? 'Save failed')
      showToast('Settings saved', 'success')
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    const token = localStorage.getItem('wp_access_token')
    if (!token) { showToast('Not authenticated', 'error'); return }
    setTesting(true)
    try {
      const r = await fetch('/api/v1/notifications/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.message ?? 'Test failed')
      showToast(`Test sent: ${data.sent} channel(s) notified`, 'success')
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  const toggleCategory = (cat: string) => {
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter(c => c !== cat)
        : [...prev.categories, cat],
    }))
  }

  if (loading) return (
    <div className="min-h-screen bg-[#06070d] flex items-center justify-center">
      <div className="text-gray-400 animate-pulse">Loading settings…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#06070d] text-gray-100 p-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium
          ${toast.type === 'success' ? 'bg-green-800 text-green-100' : 'bg-red-800 text-red-100'}`}>
          {toast.msg}
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/settings" className="text-gray-500 hover:text-cyan-400 text-sm">← Settings</Link>
          <span className="text-gray-600">/</span>
          <h1 className="text-xl font-bold text-white">Alert Notifications</h1>
        </div>

        {/* Enable toggle */}
        <div className="bg-[#0d0f1a] border border-gray-800 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-white">Enable Alerts</p>
              <p className="text-sm text-gray-400 mt-0.5">Receive real-time alerts via Telegram or Discord</p>
            </div>
            <button
              onClick={() => setSettings(p => ({ ...p, enabled: !p.enabled }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${settings.enabled ? 'bg-cyan-500' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${settings.enabled ? 'translate-x-6' : ''}`} />
            </button>
          </div>
        </div>

        {/* Telegram */}
        <div className="bg-[#0d0f1a] border border-gray-800 rounded-xl p-5 mb-4">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
            <span>✈️</span> Telegram
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Bot Token</label>
              <div className="flex gap-2">
                <input
                  type={showBotToken ? 'text' : 'password'}
                  value={settings.telegram_bot_token ?? ''}
                  onChange={e => setSettings(p => ({ ...p, telegram_bot_token: e.target.value }))}
                  placeholder="123456789:ABCdef..."
                  className="flex-1 bg-[#1a1d2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => setShowBotToken(v => !v)}
                  className="px-3 py-2 text-xs text-gray-400 hover:text-white border border-gray-700 rounded"
                >{showBotToken ? 'Hide' : 'Show'}</button>
              </div>
              <p className="text-xs text-gray-600 mt-1">Create a bot via @BotFather on Telegram</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Chat ID</label>
              <input
                type="text"
                value={settings.telegram_chat_id ?? ''}
                onChange={e => setSettings(p => ({ ...p, telegram_chat_id: e.target.value }))}
                placeholder="-1001234567890 or your user ID"
                className="w-full bg-[#1a1d2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        </div>

        {/* Discord */}
        <div className="bg-[#0d0f1a] border border-gray-800 rounded-xl p-5 mb-4">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
            <span>💬</span> Discord
          </h2>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Webhook URL</label>
            <input
              type="url"
              value={settings.discord_webhook_url ?? ''}
              onChange={e => setSettings(p => ({ ...p, discord_webhook_url: e.target.value }))}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full bg-[#1a1d2e] border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-gray-600 mt-1">Server Settings → Integrations → Webhooks → New Webhook</p>
          </div>
        </div>

        {/* Alert thresholds */}
        <div className="bg-[#0d0f1a] border border-gray-800 rounded-xl p-5 mb-4">
          <h2 className="font-semibold text-white mb-4">Alert Thresholds</h2>
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-2">Minimum Severity</label>
            <div className="flex gap-2 flex-wrap">
              {SEVERITY_OPTIONS.map(sev => (
                <button
                  key={sev}
                  onClick={() => setSettings(p => ({ ...p, min_severity: sev }))}
                  className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ${
                    settings.min_severity === sev
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {sev === 'critical' ? '🔴' : sev === 'high' ? '🟠' : sev === 'medium' ? '🟡' : '🟢'} {sev}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-2">
              Categories {settings.categories.length === 0 && <span className="text-gray-600">(all)</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-1.5 rounded text-xs capitalize transition-colors ${
                    settings.categories.includes(cat)
                      ? 'bg-amber-700 text-amber-100'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-2">Leave all unselected to receive alerts from all categories</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !settings.enabled}
            className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 font-medium rounded-lg text-sm transition-colors border border-gray-700"
          >
            {testing ? 'Sending…' : 'Send Test'}
          </button>
        </div>
        {!settings.enabled && (
          <p className="text-xs text-gray-600 mt-2 text-center">Enable alerts to send a test notification</p>
        )}
      </div>
    </div>
  )
}
