'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { AuthUser } from '@worldpulse/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface FormState {
  displayName: string
  bio:         string
  location:    string
  website:     string
}

const FIELD_LIMITS: Record<keyof FormState, number> = {
  displayName: 100,
  bio:         500,
  location:    100,
  website:     255,
}

export default function EditProfilePage() {
  const router = useRouter()

  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)
  const [handle, setHandle]     = useState('')
  const [accountType, setAccountType] = useState('')

  const [form, setForm] = useState<FormState>({
    displayName: '',
    bio:         '',
    location:    '',
    website:     '',
  })

  // Load authenticated user on mount
  useEffect(() => {
    async function load() {
      const token = localStorage.getItem('wp_access_token')
      if (!token) {
        router.replace('/auth/login')
        return
      }

      try {
        const res = await fetch(`${API_URL}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (res.status === 401) {
          router.replace('/auth/login')
          return
        }

        const data = await res.json() as { success: boolean; data: AuthUser }
        if (!data.success) {
          router.replace('/auth/login')
          return
        }

        const u = data.data
        setHandle(u.handle)
        setAccountType(u.accountType)
        setForm({
          displayName: u.displayName ?? '',
          bio:         u.bio         ?? '',
          location:    u.location    ?? '',
          website:     u.website     ?? '',
        })
      } catch {
        router.replace('/auth/login')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [router])

  const set = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const val = e.target.value.slice(0, FIELD_LIMITS[field])
    setForm(prev => ({ ...prev, [field]: val }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    const token = localStorage.getItem('wp_access_token')
    if (!token) { router.replace('/auth/login'); return }

    try {
      const res = await fetch(`${API_URL}/api/v1/users/me`, {
        method:  'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: form.displayName.trim(),
          bio:         form.bio.trim(),
          location:    form.location.trim(),
          website:     form.website.trim(),
        }),
      })

      const data = await res.json() as { success: boolean; error?: string }

      if (!res.ok || !data.success) {
        setError(data.error ?? 'Failed to save profile')
        return
      }

      // Sync displayName into localStorage wp_user so TopNav reflects change
      const raw = localStorage.getItem('wp_user')
      if (raw) {
        try {
          const stored = JSON.parse(raw) as Record<string, unknown>
          localStorage.setItem('wp_user', JSON.stringify({ ...stored, displayName: form.displayName.trim() }))
        } catch { /* ignore */ }
      }

      setSuccess(true)
      window.dispatchEvent(new StorageEvent('storage', { key: 'wp_user' }))
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 space-y-4">
        <div className="h-8 w-48 rounded shimmer" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl shimmer" />
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">

      {/* ── Header ── */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href={`/users/${handle}`}
          className="text-wp-text3 hover:text-wp-text transition-colors text-[20px] leading-none"
          aria-label="Back to profile"
        >
          ←
        </Link>
        <div>
          <h1 className="text-[22px] font-bold text-wp-text">Edit Profile</h1>
          <div className="font-mono text-[13px] text-wp-text3">@{handle}</div>
        </div>
        <div className="ml-auto">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-[18px] text-black">
            {form.displayName.charAt(0).toUpperCase() || handle.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      {/* ── Account type (read-only) ── */}
      <div className="bg-wp-s2 border border-[rgba(255,255,255,0.07)] rounded-xl p-4 mb-6">
        <div className="font-mono text-[10px] tracking-[2px] text-wp-text3 uppercase mb-1">Account Type</div>
        <div className="text-[14px] text-wp-text2 capitalize">{accountType}</div>
        <div className="text-[12px] text-wp-text3 mt-1">
          Account type is assigned by WorldPulse and cannot be changed here.
        </div>
      </div>

      {/* ── Form ── */}
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5" noValidate>

        {/* Display name */}
        <div>
          <label className="block font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-2" htmlFor="displayName">
            Display Name
          </label>
          <input
            id="displayName"
            type="text"
            value={form.displayName}
            onChange={set('displayName')}
            maxLength={FIELD_LIMITS.displayName}
            placeholder="Your display name"
            required
            className="w-full bg-wp-s2 border border-[rgba(255,255,255,0.1)] rounded-xl px-4 py-3 text-[14px] text-wp-text placeholder-wp-text3 focus:outline-none focus:border-wp-amber transition-colors"
          />
          <div className="flex justify-end mt-1 text-[11px] text-wp-text3">
            {form.displayName.length}/{FIELD_LIMITS.displayName}
          </div>
        </div>

        {/* Bio */}
        <div>
          <label className="block font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-2" htmlFor="bio">
            Bio
          </label>
          <textarea
            id="bio"
            value={form.bio}
            onChange={set('bio')}
            maxLength={FIELD_LIMITS.bio}
            placeholder="Tell the world about yourself…"
            rows={4}
            className="w-full bg-wp-s2 border border-[rgba(255,255,255,0.1)] rounded-xl px-4 py-3 text-[14px] text-wp-text placeholder-wp-text3 focus:outline-none focus:border-wp-amber transition-colors resize-none"
          />
          <div className="flex justify-end mt-1 text-[11px] text-wp-text3">
            {form.bio.length}/{FIELD_LIMITS.bio}
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="block font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-2" htmlFor="location">
            Location
          </label>
          <input
            id="location"
            type="text"
            value={form.location}
            onChange={set('location')}
            maxLength={FIELD_LIMITS.location}
            placeholder="e.g. London, UK"
            className="w-full bg-wp-s2 border border-[rgba(255,255,255,0.1)] rounded-xl px-4 py-3 text-[14px] text-wp-text placeholder-wp-text3 focus:outline-none focus:border-wp-amber transition-colors"
          />
        </div>

        {/* Website */}
        <div>
          <label className="block font-mono text-[11px] tracking-[2px] text-wp-text3 uppercase mb-2" htmlFor="website">
            Website
          </label>
          <input
            id="website"
            type="url"
            value={form.website}
            onChange={set('website')}
            maxLength={FIELD_LIMITS.website}
            placeholder="https://yourwebsite.com"
            className="w-full bg-wp-s2 border border-[rgba(255,255,255,0.1)] rounded-xl px-4 py-3 text-[14px] text-wp-text placeholder-wp-text3 focus:outline-none focus:border-wp-amber transition-colors"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="bg-[rgba(255,59,92,0.1)] border border-[rgba(255,59,92,0.3)] rounded-xl px-4 py-3 text-[13px] text-wp-red">
            {error}
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="bg-[rgba(0,230,118,0.1)] border border-[rgba(0,230,118,0.3)] rounded-xl px-4 py-3 text-[13px] text-wp-green">
            Profile saved successfully.
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 py-3 rounded-xl bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <Link
            href={`/users/${handle}`}
            className="px-6 py-3 rounded-xl bg-wp-s2 border border-[rgba(255,255,255,0.1)] text-wp-text2 text-[14px] font-medium hover:border-[rgba(255,255,255,0.2)] transition-all text-center"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* ── Danger zone ── */}
      <div className="mt-10 border border-[rgba(255,59,92,0.2)] rounded-xl p-5">
        <h2 className="text-[14px] font-semibold text-wp-red mb-2">Danger Zone</h2>
        <p className="text-[13px] text-wp-text3 mb-4">
          Account deletion is permanent and cannot be undone. All your posts, signals, and data will be removed.
        </p>
        <button
          type="button"
          disabled
          className="px-4 py-2 rounded-lg border border-[rgba(255,59,92,0.4)] text-wp-red text-[13px] font-medium opacity-40 cursor-not-allowed"
          title="Contact support to delete your account"
        >
          Delete Account
        </button>
      </div>
    </div>
  )
}
