'use client'

import { useState, useRef, useCallback } from 'react'
import { PollCreator } from './PollCreator'
import type { PollDraft } from './PollCreator'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const EMPTY_POLL: PollDraft = {
  question:  '',
  options:   ['', ''],
  expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
}

const MAX_IMAGES  = 4
const MAX_IMG_MB  = 10
const MAX_VID_MB  = 50

type MediaFile = { file: File; preview: string; kind: 'image' | 'video' }

export function Composer() {
  const [content,    setContent]    = useState('')
  const [focused,    setFocused]    = useState(false)
  const [showPoll,   setShowPoll]   = useState(false)
  const [poll,       setPoll]       = useState<PollDraft>(EMPTY_POLL)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [media,      setMedia]      = useState<MediaFile[]>([])
  const [uploading,  setUploading]  = useState(false)
  const textareaRef   = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((files: FileList, kind: 'image' | 'video') => {
    setError(null)
    const arr = Array.from(files)
    if (kind === 'video' && arr.length > 1) { setError('Only one video per post'); return }
    for (const f of arr) {
      const limitMb = kind === 'image' ? MAX_IMG_MB : MAX_VID_MB
      if (f.size > limitMb * 1024 * 1024) { setError(`File exceeds ${limitMb} MB`); return }
    }
    if (kind === 'image') {
      const cur = media.filter(m => m.kind === 'image').length
      if (cur + arr.length > MAX_IMAGES) { setError(`Maximum ${MAX_IMAGES} images`); return }
    }
    if (kind === 'video' && media.some(m => m.kind === 'video')) { setError('Only one video per post'); return }
    setMedia(prev => [...prev, ...arr.map(f => ({ file: f, preview: URL.createObjectURL(f), kind }))])
  }, [media])

  const removeMedia = (idx: number) => {
    setMedia(prev => { const n = [...prev]; URL.revokeObjectURL(n[idx].preview); n.splice(idx, 1); return n })
  }

  const charCount = content.length
  const charLimit = 500
  const over      = charCount > charLimit

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
    }
  }

  const togglePoll = () => {
    setShowPoll(v => {
      if (!v) setPoll(EMPTY_POLL)
      return !v
    })
  }

  const canSubmit = !over && !submitting && (
    content.trim().length > 0 || (showPoll && poll.question.trim().length > 0)
  )

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)

    try {
      // Upload media if any
      let mediaUrls:  string[] = []
      let mediaTypes: string[] = []
      if (media.length > 0) {
        setUploading(true)
        const token = typeof window !== 'undefined' ? localStorage.getItem('wp_token') : null
        const form  = new FormData()
        for (const m of media) form.append('file', m.file)
        const upRes = await fetch(`${API_URL}/api/v1/uploads`, {
          method:  'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body:    form,
        })
        const upData = await upRes.json() as { success: boolean; data?: { urls: string[]; types: string[] }; error?: string }
        if (!upData.success) throw new Error(upData.error ?? 'Upload failed')
        mediaUrls  = upData.data?.urls  ?? []
        mediaTypes = upData.data?.types ?? []
        setUploading(false)
      }

      // Build post payload
      const postPayload: Record<string, unknown> = {
        content:    content.trim() || poll.question.trim(),
        postType:   showPoll ? 'poll' : 'signal',
        mediaUrls,
        mediaTypes,
      }

      // Create post
      const postRes = await fetch(`${API_URL}/api/v1/posts`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(postPayload),
      })

      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to create post')
      }

      const postData = await postRes.json() as { data: { id: string } }

      // If poll, create poll attached to the post
      if (showPoll && poll.question.trim() && poll.options.filter(o => o.trim()).length >= 2) {
        const pollPayload = {
          question:  poll.question.trim(),
          options:   poll.options.filter(o => o.trim()),
          expiresAt: poll.expiresAt || undefined,
          postId:    postData.data.id,
        }
        await fetch('/api/v1/polls', {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
          body:        JSON.stringify(pollPayload),
        })
      }

      // Reset form
      setContent('')
      setShowPoll(false)
      setPoll(EMPTY_POLL)
      setMedia([])
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
      setUploading(false)
    }
  }

  return (
    <div
      className={`px-5 py-4 border-b border-[rgba(255,255,255,0.07)] flex gap-3 bg-wp-surface transition-all ${focused ? 'bg-wp-s2' : ''}`}
      aria-label="Create a post"
    >
      {/* Avatar */}
      <div
        className="w-[38px] h-[38px] rounded-full bg-gradient-to-br from-wp-amber to-orange-600 flex items-center justify-center font-bold text-[14px] text-black flex-shrink-0 cursor-pointer"
        aria-hidden="true"
      >
        U
      </div>

      <div className="flex-1 min-w-0">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Share a signal, observation, or insight with the world..."
          rows={2}
          aria-label="Post content"
          aria-multiline="true"
          aria-required="true"
          className="w-full bg-transparent border-none outline-none text-wp-text font-body text-[15px] resize-none leading-[1.6] placeholder-wp-text3 caret-wp-amber min-h-[48px]"
        />

        {/* Poll creator */}
        {showPoll && (
          <PollCreator
            value={poll}
            onChange={setPoll}
            onClose={() => setShowPoll(false)}
          />
        )}

        {/* Media previews */}
        {media.length > 0 && (
          <div className="flex gap-2 mt-2 mb-1 flex-wrap" aria-label="Attached media">
            {media.map((m, idx) => (
              <div key={m.preview} className="relative group flex-shrink-0">
                {m.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.preview}
                    alt={`Preview ${idx + 1}`}
                    className="w-16 h-16 object-cover rounded-lg border border-[rgba(255,255,255,0.1)]"
                  />
                ) : (
                  <div className="w-24 h-16 bg-wp-s3 rounded-lg border border-[rgba(255,255,255,0.1)] flex flex-col items-center justify-center gap-1">
                    <span className="text-[18px]" aria-hidden="true">🎬</span>
                    <span className="font-mono text-[9px] text-wp-text3 px-1 truncate max-w-[80px]">{m.file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeMedia(idx)}
                  aria-label={`Remove ${m.kind} ${idx + 1}`}
                  className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-wp-red text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <p role="alert" className="text-wp-red text-[11px] mt-1">{error}</p>
        )}

        {/* Hidden file inputs */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
          multiple
          className="hidden"
          aria-hidden="true"
          onChange={e => e.target.files && addFiles(e.target.files, 'image')}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          aria-hidden="true"
          onChange={e => e.target.files && addFiles(e.target.files, 'video')}
        />

        <div className={`flex items-center gap-2 pt-2 border-t border-[rgba(255,255,255,0.05)] mt-1 transition-opacity ${focused || content || showPoll ? 'opacity-100' : 'opacity-60'}`}>
          {/* Poll toggle button */}
          <button
            type="button"
            onClick={togglePoll}
            aria-label={showPoll ? 'Remove poll' : 'Add poll'}
            aria-pressed={showPoll}
            className={`text-[16px] px-[6px] py-1 rounded-lg transition-all
              ${showPoll
                ? 'text-wp-amber bg-[rgba(245,166,35,0.15)] opacity-100'
                : 'text-wp-amber opacity-70 hover:opacity-100 hover:bg-[rgba(245,166,35,0.1)]'
              }`}
          >
            📊
          </button>

          {/* Image upload button */}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={media.filter(m => m.kind === 'image').length >= MAX_IMAGES || media.some(m => m.kind === 'video')}
            aria-label={`Add images (${media.filter(m=>m.kind==='image').length}/${MAX_IMAGES})`}
            className="text-wp-amber text-[16px] px-[6px] py-1 rounded-lg opacity-70 hover:opacity-100 hover:bg-[rgba(245,166,35,0.1)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            📷
          </button>

          {/* Video upload button */}
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={media.length > 0}
            aria-label="Add video (MP4/WebM/MOV, max 50 MB)"
            className="text-wp-amber text-[16px] px-[6px] py-1 rounded-lg opacity-70 hover:opacity-100 hover:bg-[rgba(245,166,35,0.1)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            🎬
          </button>

          {/* Other action icons */}
          {['📍', '🔗', '📡'].map(icon => (
            <button
              key={icon}
              type="button"
              aria-label={
                icon === '📍' ? 'Add location' :
                icon === '🔗' ? 'Add link' :
                'Add source'
              }
              className="text-wp-amber text-[16px] px-[6px] py-1 rounded-lg opacity-70 hover:opacity-100 hover:bg-[rgba(245,166,35,0.1)] transition-all"
            >
              {icon}
            </button>
          ))}

          {/* Verification indicator */}
          <div className="flex items-center gap-1 ml-2 font-mono text-[10px] text-wp-text3">
            <span className="w-[6px] h-[6px] rounded-full bg-wp-green" aria-hidden="true" />
            Source verification ON
          </div>

          {/* Char count + submit */}
          <div className="ml-auto flex items-center gap-3">
            {uploading && (
              <span className="font-mono text-[11px] text-wp-amber animate-pulse" aria-live="polite">Uploading…</span>
            )}
            {content.length > 0 && !uploading && (
              <span
                className={`font-mono text-[11px] ${over ? 'text-wp-red' : 'text-wp-text3'}`}
                aria-live="polite"
                aria-label={`${charLimit - charCount} characters remaining`}
              >
                {charLimit - charCount}
              </span>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-label="Broadcast post"
              aria-busy={submitting}
              className="px-5 py-[7px] rounded-full bg-wp-amber text-black font-bold text-[13px] hover:bg-[#ffb84d] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Sending…' : 'Broadcast'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
