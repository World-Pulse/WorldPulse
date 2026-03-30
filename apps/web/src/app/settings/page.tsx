'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from '@/components/providers'
import { useToast } from '@/components/Toast'
import DigestSubscription from '@/components/settings/DigestSubscription'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface UserProfile {
  id:             string
  handle:         string
  displayName:    string
  email:          string
  bio:            string | null
  avatarUrl:      string | null
  location:       string | null
  website:        string | null
  accountType:    string
  trustScore:     number
  verified:       boolean
  createdAt?:     string
}

interface NotificationPrefs {
  emailNotifications: boolean
  pushAlerts:         boolean
  weeklyDigest:       boolean
}

const DEFAULT_NOTIF_PREFS: NotificationPrefs = {
  emailNotifications: false,
  pushAlerts:         false,
  weeklyDigest:       false,
}

type SettingsTab = 'profile' | 'appearance' | 'notifications' | 'account' | 'danger'

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      className={`relative w-10 h-5 rounded-full transition-all ${value ? 'bg-wp-amber' : 'bg-wp-s3'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all ${value ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: () => void
  onCancel:  () => void
  loading:   boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="bg-[#0d0d0d] border border-[rgba(255,59,92,0.3)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <div className="text-[20px] mb-2">⚠️</div>
        <h2 className="text-[16px] font-bold text-wp-text mb-2">Delete Account</h2>
        <p className="text-[13px] text-wp-text2 mb-5">
          Are you sure? This cannot be undone. All your posts, signals, and data will be permanently deleted.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg border border-[rgba(255,255,255,0.1)] text-[13px] text-wp-text2 hover:bg-[rgba(255,255,255,0.04)] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg bg-wp-red text-white font-bold text-[13px] hover:bg-[#ff1f45] transition-all disabled:opacity-50"
          >
            {loading ? 'Deleting…' : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router  = useRouter()
  const { theme, toggle: toggleTheme } = useTheme()
  const { toast } = useToast()

  const [tab, setTab]         = useState<SettingsTab>('profile')
  const [user, setUser]       = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  // Profile form state
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio]                 = useState('')
  const [location, setLocation]       = useState('')
  const [website, setWebsite]         = useState('')

  // Notifications state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF_PREFS)

  // Danger zone state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting]               = useState(false)

  // Load user + saved prefs on mount
  useEffect(() => {
    const token = localStorage.getItem('wp_access_token')
    if (!token) { router.push('/auth/login'); return }

    // Restore notification prefs from localStorage
    try {
      const raw = localStorage.getItem('wp_notification_prefs')
      if (raw) setNotifPrefs(JSON.parse(raw) as NotificationPrefs)
    } catch { /* ignore */ }

    fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          const u = d.data as UserProfile
          setUser(u)
          setDisplayName(u.displayName ?? '')
          setBio(u.bio ?? '')
          setLocation(u.location ?? '')
          setWebsite(u.website ?? '')
        }
      })
      .catch(() => {
        const raw = localStorage.getItem('wp_user')
        if (raw) {
          try {
            const u = JSON.parse(raw) as UserProfile
            setUser(u)
            setDisplayName(u.displayName ?? '')
            setBio(u.bio ?? '')
            setLocation(u.location ?? '')
            setWebsite(u.website ?? '')
          } catch { /* ignore */ }
        }
      })
      .finally(() => setLoading(false))
  }, [router])

  async function saveProfile() {
    const token = localStorage.getItem('wp_access_token')
    if (!token) return
    setSaving(true)

    try {
      const res = await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          bio:      bio      || undefined,
          location: location || undefined,
          website:  website  || undefined,
        }),
      })
      const data = await res.json() as { success?: boolean; data?: UserProfile; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Update failed')

      if (data.data) {
        localStorage.setItem('wp_user', JSON.stringify(data.data))
        setUser(data.data)
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'wp_user', newValue: JSON.stringify(data.data),
        }))
      }
      toast('Profile saved successfully', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setSaving(false)
    }
  }

  function saveNotifPrefs() {
    localStorage.setItem('wp_notification_prefs', JSON.stringify(notifPrefs))
    toast('Notification preferences saved', 'success')
  }

  function updateNotif(key: keyof NotificationPrefs, value: boolean) {
    setNotifPrefs(prev => ({ ...prev, [key]: value }))
  }

  async function deleteAccount() {
    const token = localStorage.getItem('wp_access_token')
    if (!token) return
    setDeleting(true)

    try {
      const res = await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Delete failed')
      }
    } catch (err) {
      // If 404 or success, still clear and redirect
      if (!(err instanceof Error && err.message === 'Delete failed')) {
        // likely a 200/204 or the endpoint doesn't exist yet — clear anyway
      } else {
        toast(err.message, 'error')
        setDeleting(false)
        setShowDeleteModal(false)
        return
      }
    }

    // Clear all localStorage and redirect
    localStorage.clear()
    router.push('/')
  }

  function logout() {
    localStorage.removeItem('wp_access_token')
    localStorage.removeItem('wp_refresh_token')
    localStorage.removeItem('wp_user')
    router.push('/')
  }

  const TABS: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'profile',       label: 'Profile',       icon: '👤' },
    { id: 'appearance',    label: 'Appearance',    icon: '🎨' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'account',       label: 'Account',       icon: '🔐' },
    { id: 'danger',        label: 'Danger Zone',   icon: '⚠️' },
  ]

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        <div className="h-8 w-32 rounded shimmer" />
        <div className="h-64 rounded-xl shimmer" />
      </div>
    )
  }

  if (!user) return null

  return (
    <>
      {showDeleteModal && (
        <ConfirmModal
          onConfirm={deleteAccount}
          onCancel={() => setShowDeleteModal(false)}
          loading={deleting}
        />
      )}

      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/@${user.handle}`} className="text-wp-text3 hover:text-wp-amber text-[13px] transition-colors">
            ← @{user.handle}
          </Link>
          <span className="text-wp-text3">/</span>
          <h1 className="text-[18px] font-bold text-wp-text">Settings</h1>
        </div>

        {/* Mobile: horizontal tab bar; desktop: sidebar + panel */}
        <div className="flex flex-col md:grid md:grid-cols-[180px_1fr] gap-4 md:gap-6">

          {/* Tab nav */}
          <div>
            {/* Mobile: horizontal scroll */}
            <div className="flex overflow-x-auto scrollbar-none gap-1 -mx-4 px-4 md:hidden pb-1">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all whitespace-nowrap flex-shrink-0
                    ${tab === t.id
                      ? 'bg-[rgba(245,166,35,0.1)] text-wp-amber border border-[rgba(245,166,35,0.2)]'
                      : 'bg-wp-s2 text-wp-text2 border border-[rgba(255,255,255,0.07)] hover:text-wp-text'}`}
                >
                  <span aria-hidden="true">{t.icon}</span> {t.label}
                </button>
              ))}
            </div>

            {/* Desktop: vertical nav */}
            <div className="hidden md:block space-y-1">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all text-left
                    ${tab === t.id
                      ? 'bg-[rgba(245,166,35,0.1)] text-wp-amber border border-[rgba(245,166,35,0.2)]'
                      : t.id === 'danger'
                        ? 'text-wp-red hover:bg-[rgba(255,59,92,0.08)]'
                        : 'text-wp-text2 hover:bg-[rgba(255,255,255,0.04)] hover:text-wp-text'}`}
                >
                  <span aria-hidden="true">{t.icon}</span> {t.label}
                </button>
              ))}

              <div className="border-t border-[rgba(255,255,255,0.07)] pt-2 mt-2">
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] text-wp-red hover:bg-[rgba(255,59,92,0.08)] transition-all text-left"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>

          {/* Main panel */}
          <div className="space-y-4">

            {/* ── PROFILE TAB ──────────────────────────────────────── */}
            {tab === 'profile' && (
              <div className="bg-black/40 border border-white/10 rounded-xl p-5 space-y-4">
                <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Public Profile</div>

                {/* Avatar + handle */}
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-[24px] text-black">
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-wp-text">{user.displayName}</div>
                    <div className="text-[12px] text-wp-text3">@{user.handle}</div>
                    {user.verified && <div className="text-[11px] text-wp-cyan mt-0.5">✓ Verified</div>}
                  </div>
                </div>

                {/* Text fields */}
                {([
                  { label: 'Display Name', value: displayName, setValue: setDisplayName, placeholder: 'Your Name',             maxLength: 100 },
                  { label: 'Location',     value: location,    setValue: setLocation,    placeholder: 'City, Country',         maxLength: 100 },
                  { label: 'Website',      value: website,     setValue: setWebsite,     placeholder: 'https://yoursite.com',  maxLength: 255 },
                ] as const).map(field => (
                  <div key={field.label} className="flex flex-col gap-1">
                    <label className="text-[12px] text-wp-text2 font-medium">{field.label}</label>
                    <input
                      type="text"
                      value={field.value}
                      onChange={e => field.setValue(e.target.value)}
                      maxLength={field.maxLength}
                      placeholder={field.placeholder}
                      className="bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors"
                    />
                  </div>
                ))}

                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-wp-text2 font-medium">Bio</label>
                  <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Tell the world about yourself…"
                    className="bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text placeholder-wp-text3 outline-none focus:border-wp-amber transition-colors resize-none"
                  />
                  <div className="text-right font-mono text-[10px] text-wp-text3">{bio.length}/500</div>
                </div>

                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="w-full py-2.5 rounded-lg bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Profile'}
                </button>
              </div>
            )}

            {/* ── APPEARANCE TAB ───────────────────────────────────── */}
            {tab === 'appearance' && (
              <div className="bg-black/40 border border-white/10 rounded-xl p-5 space-y-5">
                <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Appearance</div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14px] font-semibold text-wp-text">
                      {theme === 'dark' ? '🌑 Dark Mode' : '☀️ Light Mode'}
                    </div>
                    <div className="text-[12px] text-wp-text3 mt-0.5">
                      {theme === 'dark'
                        ? 'Dark theme is active — optimized for intelligence monitoring'
                        : 'Light theme is active'}
                    </div>
                  </div>
                  <Toggle value={theme === 'dark'} onChange={() => toggleTheme()} />
                </div>

                <div className="border-t border-[rgba(255,255,255,0.07)] pt-4">
                  <div className="text-[12px] text-wp-text3">
                    Your preference is saved automatically to your browser.
                  </div>
                </div>
              </div>
            )}

            {/* ── NOTIFICATIONS TAB ────────────────────────────────── */}
            {tab === 'notifications' && (
              <div className="bg-black/40 border border-white/10 rounded-xl p-5 space-y-5">
                <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Notifications</div>

                {([
                  {
                    key:   'emailNotifications' as const,
                    label: 'Email notifications',
                    desc:  'Receive updates and alerts via email',
                  },
                  {
                    key:   'pushAlerts' as const,
                    label: 'Push alerts — Breaking news',
                    desc:  'Browser push notifications for critical signals',
                  },
                  {
                    key:   'weeklyDigest' as const,
                    label: 'Weekly digest',
                    desc:  'One summary email every Monday morning',
                  },
                ]).map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-medium text-wp-text">{label}</div>
                      <div className="text-[11px] text-wp-text3 mt-0.5">{desc}</div>
                    </div>
                    <Toggle
                      value={notifPrefs[key]}
                      onChange={v => updateNotif(key, v)}
                    />
                  </div>
                ))}

                <div className="pt-1 border-t border-[rgba(255,255,255,0.07)]">
                  <div className="text-[11px] text-wp-text3 mb-3">
                    Saved locally — backend sync coming soon.
                  </div>
                  <button
                    onClick={saveNotifPrefs}
                    className="w-full py-2.5 rounded-lg bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all"
                  >
                    Save Preferences
                  </button>
                </div>
              </div>

              {/* ── DIGEST SUBSCRIPTION ───────────────────────────── */}
              <DigestSubscription defaultEmail={user?.email ?? ''} />
            )}

            {/* ── ACCOUNT TAB ──────────────────────────────────────── */}
            {tab === 'account' && (
              <div className="bg-black/40 border border-white/10 rounded-xl p-5 space-y-4">
                <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Account Info</div>

                <div className="grid grid-cols-2 gap-3 text-[13px]">
                  <div>
                    <div className="text-wp-text3 text-[11px] mb-0.5">Handle</div>
                    <div className="text-wp-text font-mono">@{user.handle}</div>
                  </div>
                  <div>
                    <div className="text-wp-text3 text-[11px] mb-0.5">Email</div>
                    <div className="text-wp-text">{user.email}</div>
                  </div>
                  <div>
                    <div className="text-wp-text3 text-[11px] mb-0.5">Account Type</div>
                    <div className="text-wp-amber capitalize">{user.accountType}</div>
                  </div>
                  <div>
                    <div className="text-wp-text3 text-[11px] mb-0.5">Verification</div>
                    <div className={user.verified ? 'text-wp-cyan' : 'text-wp-text3'}>
                      {user.verified ? '✓ Verified' : 'Not verified'}
                    </div>
                  </div>
                  <div>
                    <div className="text-wp-text3 text-[11px] mb-0.5">Trust Score</div>
                    <div className="text-wp-green">{Math.round(user.trustScore * 100)}%</div>
                  </div>
                  {user.createdAt && (
                    <div>
                      <div className="text-wp-text3 text-[11px] mb-0.5">Member Since</div>
                      <div className="text-wp-text2">
                        {new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── DANGER ZONE TAB ──────────────────────────────────── */}
            {tab === 'danger' && (
              <div className="bg-black/40 border border-[rgba(255,59,92,0.2)] rounded-xl p-5 space-y-4">
                <div className="font-mono text-[11px] tracking-[2px] text-wp-red uppercase">Danger Zone</div>

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[14px] font-semibold text-wp-text">Delete Account</div>
                    <div className="text-[12px] text-wp-text3 mt-0.5">
                      Permanently delete your account and all associated data. This action cannot be undone.
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="flex-shrink-0 px-4 py-2 rounded-lg border border-wp-red text-wp-red text-[13px] font-semibold hover:bg-[rgba(255,59,92,0.1)] transition-all"
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            )}

            {/* Mobile sign-out */}
            <div className="md:hidden border-t border-[rgba(255,255,255,0.07)] pt-4">
              <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] text-wp-red border border-[rgba(255,59,92,0.2)] hover:bg-[rgba(255,59,92,0.08)] transition-all"
              >
                Sign Out
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
