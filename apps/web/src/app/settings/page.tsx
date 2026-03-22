'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface UserProfile {
  id: string
  handle: string
  displayName: string
  email: string
  bio: string | null
  avatarUrl: string | null
  location: string | null
  website: string | null
  accountType: string
  trustScore: number
  verified: boolean
}

type SettingsTab = 'profile' | 'account' | 'privacy' | 'appearance'

export default function SettingsPage() {
  const router = useRouter()
  const [tab, setTab]         = useState<SettingsTab>('profile')
  const [user, setUser]       = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  // Profile form state
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio]                 = useState('')
  const [location, setLocation]       = useState('')
  const [website, setWebsite]         = useState('')

  // Password form state
  const [currentPw, setCurrentPw]     = useState('')
  const [newPw, setNewPw]             = useState('')
  const [confirmPw, setConfirmPw]     = useState('')

  // Privacy
  const [privateProfile, setPrivateProfile] = useState(false)
  const [hideFollowers, setHideFollowers]   = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('wp_access_token')
    if (!token) { router.push('/auth/login'); return }

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
        // Use stored user as fallback
        const raw = localStorage.getItem('wp_user')
        if (raw) {
          const u = JSON.parse(raw) as UserProfile
          setUser(u)
          setDisplayName(u.displayName ?? '')
          setBio(u.bio ?? '')
          setLocation(u.location ?? '')
          setWebsite(u.website ?? '')
        }
      })
      .finally(() => setLoading(false))
  }, [router])

  async function saveProfile() {
    const token = localStorage.getItem('wp_access_token')
    if (!token) return
    setSaving(true)
    setError('')

    try {
      const res = await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, bio: bio || null, location: location || null, website: website || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Update failed')

      // Update stored user and sync TopNav in the same tab
      if (data.data) {
        localStorage.setItem('wp_user', JSON.stringify(data.data))
        setUser(data.data)
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'wp_user',
          newValue: JSON.stringify(data.data),
        }))
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    setError('')
    if (newPw !== confirmPw) { setError('Passwords do not match'); return }
    if (newPw.length < 8) { setError('Password must be at least 8 characters'); return }

    const token = localStorage.getItem('wp_access_token')
    if (!token) return
    setSaving(true)

    try {
      const res = await fetch(`${API_URL}/api/v1/auth/change-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Password change failed')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  function logout() {
    localStorage.removeItem('wp_access_token')
    localStorage.removeItem('wp_refresh_token')
    localStorage.removeItem('wp_user')
    router.push('/')
  }

  const TABS: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'profile',    label: 'Profile',    icon: '👤' },
    { id: 'account',    label: 'Account',    icon: '🔐' },
    { id: 'privacy',    label: 'Privacy',    icon: '🔒' },
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
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
    <div className="max-w-2xl mx-auto px-4 py-8">

      <div className="flex items-center gap-3 mb-6">
        <Link href={`/@${user.handle}`} className="text-wp-text3 hover:text-wp-amber text-[13px] transition-colors">
          ← @{user.handle}
        </Link>
        <span className="text-wp-text3">/</span>
        <h1 className="text-[18px] font-bold text-wp-text">Settings</h1>
      </div>

      {/* Mobile: horizontal tab bar; desktop: sidebar + panel grid */}
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

          {/* Feedback */}
          {error && (
            <div className="bg-[rgba(255,59,92,0.1)] border border-[rgba(255,59,92,0.3)] rounded-lg px-4 py-3 text-[13px] text-wp-red">{error}</div>
          )}
          {saved && (
            <div className="bg-[rgba(0,230,118,0.1)] border border-[rgba(0,230,118,0.3)] rounded-lg px-4 py-3 text-[13px] text-wp-green">✓ Saved successfully</div>
          )}

          {/* PROFILE TAB */}
          {tab === 'profile' && (
            <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 space-y-4">
              <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Public Profile</div>

              {/* Avatar placeholder */}
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

              {[
                { label: 'Display Name', value: displayName, setValue: setDisplayName, placeholder: 'Your Name', maxLength: 100 },
                { label: 'Location',     value: location,    setValue: setLocation,    placeholder: 'City, Country', maxLength: 100 },
                { label: 'Website',      value: website,     setValue: setWebsite,     placeholder: 'https://yoursite.com', maxLength: 255 },
              ].map(field => (
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

          {/* ACCOUNT TAB */}
          {tab === 'account' && (
            <div className="space-y-4">
              <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 space-y-4">
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
                    <div className="text-wp-text3 text-[11px] mb-0.5">Trust Score</div>
                    <div className="text-wp-green">{Math.round(user.trustScore * 100)}%</div>
                  </div>
                </div>
              </div>

              <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 space-y-4">
                <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Change Password</div>
                {[
                  { label: 'Current Password', value: currentPw, setValue: setCurrentPw, auto: 'current-password' },
                  { label: 'New Password',      value: newPw,     setValue: setNewPw,     auto: 'new-password' },
                  { label: 'Confirm Password',  value: confirmPw, setValue: setConfirmPw, auto: 'new-password' },
                ].map(field => (
                  <div key={field.label} className="flex flex-col gap-1">
                    <label className="text-[12px] text-wp-text2 font-medium">{field.label}</label>
                    <input
                      type="password"
                      value={field.value}
                      onChange={e => field.setValue(e.target.value)}
                      autoComplete={field.auto}
                      className="bg-wp-s2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[14px] text-wp-text outline-none focus:border-wp-amber transition-colors"
                    />
                  </div>
                ))}
                <button
                  onClick={changePassword}
                  disabled={saving || !currentPw || !newPw || !confirmPw}
                  className="w-full py-2.5 rounded-lg bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all disabled:opacity-50"
                >
                  {saving ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>
          )}

          {/* PRIVACY TAB */}
          {tab === 'privacy' && (
            <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 space-y-5">
              <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Privacy Settings</div>
              {[
                { key: 'privateProfile', value: privateProfile, setValue: setPrivateProfile, label: 'Private Profile', desc: 'Only approved followers can see your posts' },
                { key: 'hideFollowers',  value: hideFollowers,  setValue: setHideFollowers,  label: 'Hide Follower Count', desc: 'Your follower count will not be visible to others' },
              ].map(({ key, value, setValue, label, desc }) => (
                <div key={key} className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-medium text-wp-text">{label}</div>
                    <div className="text-[11px] text-wp-text3 mt-0.5">{desc}</div>
                  </div>
                  <button
                    onClick={() => setValue(v => !v)}
                    className={`relative w-10 h-5 rounded-full transition-all ${value ? 'bg-wp-amber' : 'bg-wp-s3'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all ${value ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}
              <button
                onClick={saveProfile}
                className="w-full py-2.5 rounded-lg bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all"
              >
                Save Privacy Settings
              </button>
            </div>
          )}

          {/* APPEARANCE TAB */}
          {tab === 'appearance' && (
            <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-5 space-y-4">
              <div className="font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase">Appearance</div>
              <div className="text-[13px] text-wp-text2 py-4 text-center">
                <div className="text-[32px] mb-2">🌑</div>
                WorldPulse uses a dark theme optimized for intelligence monitoring.<br />
                <span className="text-wp-text3">Additional themes coming soon.</span>
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
  )
}
