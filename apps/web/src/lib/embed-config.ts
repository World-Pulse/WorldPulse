export type EmbedTheme = 'dark' | 'light'

export type EmbedCategory =
  | 'all'
  | 'breaking'
  | 'conflict'
  | 'geopolitics'
  | 'climate'
  | 'health'
  | 'economy'
  | 'technology'
  | 'science'
  | 'elections'
  | 'culture'
  | 'disaster'
  | 'security'

export interface EmbedConfig {
  theme: EmbedTheme
  limit: number
  category: EmbedCategory
  width: number
  height: number
}

export const EMBED_DEFAULTS: EmbedConfig = {
  theme: 'dark',
  limit: 5,
  category: 'all',
  width: 360,
  height: 500,
}

export const EMBED_CATEGORIES: { value: EmbedCategory; label: string }[] = [
  { value: 'all',         label: 'All Categories' },
  { value: 'breaking',    label: 'Breaking' },
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
]

/** Builds the /embed iframe src URL from a config object. */
export function buildEmbedUrl(origin: string, config: EmbedConfig): string {
  const params = new URLSearchParams({
    theme: config.theme,
    limit: String(config.limit),
  })
  if (config.category !== 'all') {
    params.set('category', config.category)
  }
  return `${origin}/embed?${params.toString()}`
}

/** Generates a copy-paste <iframe> HTML snippet. */
export function buildIframeSnippet(origin: string, config: EmbedConfig): string {
  const src = buildEmbedUrl(origin, config)
  return [
    `<iframe`,
    `  src="${src}"`,
    `  width="${config.width}"`,
    `  height="${config.height}"`,
    `  style="border:none;border-radius:8px"`,
    `  title="WorldPulse Live Signals"`,
    `  loading="lazy"`,
    `></iframe>`,
  ].join('\n')
}

/** Generates a copy-paste <script> snippet for the widget loader. */
export function buildScriptSnippet(origin: string, config: EmbedConfig): string {
  const attrs: string[] = [
    `src="${origin}/widget.js"`,
    `data-theme="${config.theme}"`,
    `data-limit="${config.limit}"`,
  ]
  if (config.category !== 'all') {
    attrs.push(`data-category="${config.category}"`)
  }
  attrs.push(`data-width="${config.width}"`)
  attrs.push(`data-height="${config.height}"`)
  return `<script\n  ${attrs.join('\n  ')}\n></script>`
}
