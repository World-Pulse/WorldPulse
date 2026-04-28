'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from '@/lib/i18n'

const CATEGORIES = [
  { value: 'breaking',    label: 'Breaking News' },
  { value: 'conflict',    label: 'Conflict' },
  { value: 'geopolitics', label: 'Geopolitics' },
  { value: 'climate',     label: 'Climate' },
  { value: 'health',      label: 'Health' },
  { value: 'economy',     label: 'Economy' },
  { value: 'technology',  label: 'Technology' },
  { value: 'science',     label: 'Science' },
  { value: 'elections',   label: 'Elections' },
  { value: 'culture',     label: 'Culture' },
  { value: 'disaster',    label: 'Disaster' },
  { value: 'security',    label: 'Security' },
  { value: 'sports',      label: 'Sports' },
  { value: 'space',       label: 'Space' },
  { value: 'other',       label: 'Other' },
] as const

type FormState = {
  name: string
  url: string
  rss_url: string
  category: string
  reason: string
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export default function SuggestSourcePage() {
  const t = useTranslations('sources.suggest')

  const [form, setForm] = useState<FormState>({
    name: '',
    url: '',
    rss_url: '',
    category: '',
    reason: '',
  })

  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    // Clear field error on change
    if (fieldErrors[name as keyof FormState]) {
      setFieldErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {}

    if (!form.name.trim() || form.name.trim().length < 2) {
      errors.name = 'Source name must be at least 2 characters'
    }
    if (!form.url.trim()) {
      errors.url = 'Website URL is required'
    } else {
      try { new URL(form.url) } catch { errors.url = 'Please enter a valid URL' }
    }
    if (form.rss_url.trim()) {
      try { new URL(form.rss_url) } catch { errors.rss_url = 'Please enter a valid RSS feed URL' }
    }
    if (!form.category) {
      errors.category = 'Please select a category'
    }
    if (!form.reason.trim() || form.reason.trim().length < 20) {
      errors.reason = 'Reason must be at least 20 characters'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    setSubmitState('submitting')
    setErrorMessage('')

    try {
      const res = await fetch(`${API_BASE}/api/v1/sources/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof window !== 'undefined' && localStorage.getItem('wp_access_token')
            ? { Authorization: `Bearer ${localStorage.getItem('wp_access_token')}` }
            : {}),
        },
        body: JSON.stringify({
          name:     form.name.trim(),
          url:      form.url.trim(),
          rss_url:  form.rss_url.trim() || undefined,
          category: form.category,
          reason:   form.reason.trim(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          setErrorMessage(data.error ?? 'This source or suggestion already exists')
        } else if (res.status === 400 && data.details) {
          const apiErrors: Partial<Record<keyof FormState, string>> = {}
          for (const [key, msgs] of Object.entries(data.details)) {
            if (Array.isArray(msgs) && msgs.length > 0) {
              apiErrors[key as keyof FormState] = msgs[0] as string
            }
          }
          setFieldErrors(apiErrors)
        } else {
          setErrorMessage(data.error ?? 'Something went wrong. Please try again.')
        }
        setSubmitState('error')
        return
      }

      setSubmitState('success')
    } catch {
      setErrorMessage('Network error. Check your connection and try again.')
      setSubmitState('error')
    }
  }

  function handleReset() {
    setForm({ name: '', url: '', rss_url: '', category: '', reason: '' })
    setSubmitState('idle')
    setErrorMessage('')
    setFieldErrors({})
  }

  if (submitState === 'success') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-[rgba(0,230,118,0.15)] border border-[rgba(0,230,118,0.3)] flex items-center justify-center text-[28px] mx-auto mb-6">
          ✓
        </div>
        <h1 className="font-display text-[32px] tracking-wider text-wp-green mb-3">
          {t('successTitle')}
        </h1>
        <p className="text-[15px] text-wp-text2 leading-relaxed mb-8">
          {t('successMessage')}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleReset}
            className="px-6 py-[10px] rounded-lg border border-[rgba(255,255,255,0.1)] text-wp-text2 hover:border-wp-amber hover:text-wp-amber transition-all text-[14px] font-medium"
          >
            {t('submitAnother')}
          </button>
          <Link
            href="/"
            className="px-6 py-[10px] rounded-lg bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all"
          >
            Back to Feed
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <Link href="/sources" className="text-wp-text3 hover:text-wp-amber text-[13px] transition-colors mb-4 inline-flex items-center gap-1">
          ← Back to sources
        </Link>
        <h1 className="font-display text-[36px] tracking-wider text-wp-text mt-2">
          {t('title')}
        </h1>
        <p className="text-[15px] text-wp-text2 mt-2">
          {t('subtitle')}
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>

        {/* Source Name */}
        <div>
          <label htmlFor="name" className="block font-mono text-[11px] tracking-widest text-wp-text3 uppercase mb-2">
            {t('nameLabel')} <span className="text-wp-red">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            value={form.name}
            onChange={handleChange}
            placeholder={t('namePlaceholder')}
            className={`w-full bg-wp-s2 border rounded-lg px-4 py-[10px] text-[14px] text-wp-text placeholder:text-wp-text3 outline-none transition-all
              ${fieldErrors.name
                ? 'border-wp-red focus:border-wp-red'
                : 'border-[rgba(255,255,255,0.07)] focus:border-[rgba(255,255,255,0.2)]'
              }`}
          />
          {fieldErrors.name && (
            <p className="text-wp-red text-[12px] mt-1">{fieldErrors.name}</p>
          )}
        </div>

        {/* URL */}
        <div>
          <label htmlFor="url" className="block font-mono text-[11px] tracking-widest text-wp-text3 uppercase mb-2">
            {t('urlLabel')} <span className="text-wp-red">*</span>
          </label>
          <input
            id="url"
            name="url"
            type="url"
            value={form.url}
            onChange={handleChange}
            placeholder={t('urlPlaceholder')}
            className={`w-full bg-wp-s2 border rounded-lg px-4 py-[10px] text-[14px] text-wp-text placeholder:text-wp-text3 outline-none transition-all
              ${fieldErrors.url
                ? 'border-wp-red focus:border-wp-red'
                : 'border-[rgba(255,255,255,0.07)] focus:border-[rgba(255,255,255,0.2)]'
              }`}
          />
          {fieldErrors.url && (
            <p className="text-wp-red text-[12px] mt-1">{fieldErrors.url}</p>
          )}
        </div>

        {/* RSS Feed URL */}
        <div>
          <label htmlFor="rss_url" className="block font-mono text-[11px] tracking-widest text-wp-text3 uppercase mb-2">
            {t('rssLabel')}
          </label>
          <input
            id="rss_url"
            name="rss_url"
            type="url"
            value={form.rss_url}
            onChange={handleChange}
            placeholder={t('rssPlaceholder')}
            className={`w-full bg-wp-s2 border rounded-lg px-4 py-[10px] text-[14px] text-wp-text placeholder:text-wp-text3 outline-none transition-all
              ${fieldErrors.rss_url
                ? 'border-wp-red focus:border-wp-red'
                : 'border-[rgba(255,255,255,0.07)] focus:border-[rgba(255,255,255,0.2)]'
              }`}
          />
          {fieldErrors.rss_url && (
            <p className="text-wp-red text-[12px] mt-1">{fieldErrors.rss_url}</p>
          )}
        </div>

        {/* Category */}
        <div>
          <label htmlFor="category" className="block font-mono text-[11px] tracking-widest text-wp-text3 uppercase mb-2">
            {t('categoryLabel')} <span className="text-wp-red">*</span>
          </label>
          <select
            id="category"
            name="category"
            value={form.category}
            onChange={handleChange}
            className={`w-full bg-wp-s2 border rounded-lg px-4 py-[10px] text-[14px] text-wp-text outline-none transition-all appearance-none cursor-pointer
              ${fieldErrors.category
                ? 'border-wp-red focus:border-wp-red'
                : 'border-[rgba(255,255,255,0.07)] focus:border-[rgba(255,255,255,0.2)]'
              }
              ${!form.category ? 'text-wp-text3' : ''}`}
          >
            <option value="" disabled>— Select category —</option>
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
          {fieldErrors.category && (
            <p className="text-wp-red text-[12px] mt-1">{fieldErrors.category}</p>
          )}
        </div>

        {/* Reason */}
        <div>
          <label htmlFor="reason" className="block font-mono text-[11px] tracking-widest text-wp-text3 uppercase mb-2">
            {t('reasonLabel')} <span className="text-wp-red">*</span>
          </label>
          <textarea
            id="reason"
            name="reason"
            value={form.reason}
            onChange={handleChange}
            placeholder={t('reasonPlaceholder')}
            rows={5}
            className={`w-full bg-wp-s2 border rounded-lg px-4 py-[10px] text-[14px] text-wp-text placeholder:text-wp-text3 outline-none transition-all resize-vertical min-h-[120px]
              ${fieldErrors.reason
                ? 'border-wp-red focus:border-wp-red'
                : 'border-[rgba(255,255,255,0.07)] focus:border-[rgba(255,255,255,0.2)]'
              }`}
          />
          <div className="flex items-center justify-between mt-1">
            {fieldErrors.reason
              ? <p className="text-wp-red text-[12px]">{fieldErrors.reason}</p>
              : <span />
            }
            <span className={`font-mono text-[11px] ${form.reason.length > 1800 ? 'text-wp-amber' : 'text-wp-text3'}`}>
              {form.reason.length}/2000
            </span>
          </div>
        </div>

        {/* Global error */}
        {submitState === 'error' && errorMessage && (
          <div className="bg-[rgba(255,59,92,0.1)] border border-[rgba(255,59,92,0.3)] rounded-lg px-4 py-3 text-[13px] text-wp-red">
            {errorMessage}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitState === 'submitting'}
          className="w-full py-[12px] rounded-lg bg-wp-amber text-black font-bold text-[14px] hover:bg-[#ffb84d] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitState === 'submitting' ? 'Submitting…' : t('submitButton')}
        </button>
      </form>
    </div>
  )
}
