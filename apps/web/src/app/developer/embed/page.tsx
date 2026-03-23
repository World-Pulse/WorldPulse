'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  EMBED_DEFAULTS,
  EMBED_CATEGORIES,
  buildEmbedUrl,
  buildIframeSnippet,
  buildScriptSnippet,
  type EmbedConfig,
  type EmbedTheme,
  type EmbedCategory,
} from '@/lib/embed-config'

// ─── Constants ────────────────────────────────────────────────────────────────

type CodeTab = 'iframe' | 'script'

// ─── Sub-components ───────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-mono text-wp-text2 uppercase tracking-wider mb-1">
      {children}
    </label>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API unavailable
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="text-[12px] px-3 py-1.5 rounded-lg border border-[rgba(255,255,255,0.1)] text-wp-text2 hover:text-wp-amber hover:border-wp-amber transition-colors font-mono"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmbedConfiguratorPage() {
  const [origin, setOrigin] = useState('https://worldpulse.io')
  const [config, setConfig] = useState<EmbedConfig>(EMBED_DEFAULTS)
  const [tab, setTab] = useState<CodeTab>('iframe')
  const [previewKey, setPreviewKey] = useState(0)

  // Use the current window origin for local dev
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  // Debounce preview reloads so rapid slider/input changes don't spam the iframe
  const [debouncedConfig, setDebouncedConfig] = useState(config)
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedConfig(config)
      setPreviewKey(k => k + 1)
    }, 400)
    return () => clearTimeout(t)
  }, [config])

  const update = useCallback(
    <K extends keyof EmbedConfig>(key: K, value: EmbedConfig[K]) =>
      setConfig(prev => ({ ...prev, [key]: value })),
    [],
  )

  const iframeSrc  = buildEmbedUrl(origin, debouncedConfig)
  const iframeCode = buildIframeSnippet(origin, debouncedConfig)
  const scriptCode = buildScriptSnippet(origin, debouncedConfig)
  const activeCode = tab === 'iframe' ? iframeCode : scriptCode

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <a href="/developer" className="text-[13px] text-wp-text2 hover:text-wp-amber transition-colors">
            Developer API
          </a>
          <span className="text-wp-text3">/</span>
          <span className="text-[13px] text-wp-text">Embed Widget</span>
        </div>
        <h1 className="font-display text-[28px] tracking-[2px] text-wp-text mb-2">
          EMBED <span className="text-wp-amber">WIDGET</span>
        </h1>
        <p className="text-[14px] text-wp-text2 max-w-xl">
          Add a live WorldPulse signal feed to any website. Configure below,
          then copy the embed code — no API key required.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">

        {/* ── Controls ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Theme */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <Label>Theme</Label>
            <div className="flex gap-2 mt-1">
              {(['dark', 'light'] as EmbedTheme[]).map(t => (
                <button
                  key={t}
                  onClick={() => update('theme', t)}
                  className={[
                    'flex-1 py-1.5 rounded-lg text-[13px] font-medium border transition-colors capitalize',
                    config.theme === t
                      ? 'border-wp-amber text-wp-amber bg-[rgba(245,166,35,0.08)]'
                      : 'border-[rgba(255,255,255,0.08)] text-wp-text2 hover:border-[rgba(255,255,255,0.2)]',
                  ].join(' ')}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <Label>Category</Label>
            <select
              value={config.category}
              onChange={e => update('category', e.target.value as EmbedCategory)}
              className="w-full mt-1 bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-[13px] text-wp-text outline-none focus:border-wp-amber transition-colors"
            >
              {EMBED_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Signal count */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <Label>Signals to show: {config.limit}</Label>
            <input
              type="range"
              min={1}
              max={20}
              value={config.limit}
              onChange={e => update('limit', parseInt(e.target.value, 10))}
              className="w-full mt-2 accent-[#f5a623]"
            />
            <div className="flex justify-between text-[10px] text-wp-text3 mt-0.5">
              <span>1</span><span>20</span>
            </div>
          </div>

          {/* Dimensions */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <Label>Dimensions (px)</Label>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <span className="text-[10px] text-wp-text3 block mb-1">Width</span>
                <input
                  type="number"
                  min={240}
                  max={900}
                  value={config.width}
                  onChange={e =>
                    update('width', Math.max(240, parseInt(e.target.value, 10) || EMBED_DEFAULTS.width))
                  }
                  className="w-full bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-[13px] text-wp-text outline-none focus:border-wp-amber transition-colors"
                />
              </div>
              <div>
                <span className="text-[10px] text-wp-text3 block mb-1">Height</span>
                <input
                  type="number"
                  min={300}
                  max={900}
                  value={config.height}
                  onChange={e =>
                    update('height', Math.max(300, parseInt(e.target.value, 10) || EMBED_DEFAULTS.height))
                  }
                  className="w-full bg-wp-surface2 border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-[13px] text-wp-text outline-none focus:border-wp-amber transition-colors"
                />
              </div>
            </div>
          </div>

        </div>

        {/* ── Preview + Code ────────────────────────────────────── */}
        <div className="flex flex-col gap-5">

          {/* Live preview */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
            <p className="text-[11px] font-mono text-wp-text2 uppercase tracking-wider mb-3">
              Live Preview
            </p>
            <div
              className="flex justify-center"
              style={{ minHeight: Math.min(config.height, 520) + 8 }}
            >
              <iframe
                key={previewKey}
                src={iframeSrc}
                width={Math.min(config.width, 580)}
                height={Math.min(config.height, 520)}
                style={{ border: 'none', borderRadius: 8, display: 'block' }}
                title="WorldPulse Widget Preview"
                loading="lazy"
              />
            </div>
          </div>

          {/* Embed code */}
          <div className="glass border border-[rgba(255,255,255,0.07)] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <div className="flex gap-1">
                {(['iframe', 'script'] as CodeTab[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={[
                      'px-3 py-1 rounded-md text-[12px] font-mono transition-colors',
                      tab === t
                        ? 'bg-[rgba(245,166,35,0.12)] text-wp-amber'
                        : 'text-wp-text2 hover:text-wp-text',
                    ].join(' ')}
                  >
                    {t === 'iframe' ? '<iframe>' : '<script>'}
                  </button>
                ))}
              </div>
              <CopyButton text={activeCode} />
            </div>
            <pre className="p-4 text-[12px] font-mono text-[#a8b4c8] overflow-x-auto whitespace-pre leading-relaxed bg-[rgba(0,0,0,0.2)]">
              {activeCode}
            </pre>
          </div>

          {/* Hint */}
          <p className="text-[12px] text-wp-text3 leading-relaxed">
            {tab === 'iframe'
              ? 'Paste the <iframe> tag anywhere in your HTML. The widget refreshes live every 30 seconds.'
              : 'Paste the <script> tag where you want the widget to appear. It auto-injects the iframe with no extra HTML needed.'}
          </p>

        </div>
      </div>
    </div>
  )
}
