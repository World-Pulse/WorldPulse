/**
 * The map's live cameras (Oct 19, 2026, Map Lab): the popup that shows a
 * camera's current picture inside the map, instead of a link to another site.
 * The pictures come from our API (GET /api/v1/cameras/:id/image), which says
 * when the source took each one (X-Picture-Time).
 */

import { escapeHtml, safeHttpUrl } from './map-utils'

export interface CameraFeed {
  id:          string
  name:        string
  region:      string
  country:     string
  countryCode: string
  city?:       string
  lat:         number
  lng:         number
  /** The current picture, through our API */
  snapshotUrl: string
  /** The source's own camera page */
  embedUrl:    string
  sourceName?: string
  type:        'traffic' | 'weather' | 'city' | 'nature'
  isLive:      boolean
}

export interface CameraPopupProps {
  name:        string
  city?:       string
  country:     string
  type:        string
  sourceName?: string
  embedUrl?:   string
}

/**
 * A camera's picture for this minute, for the camera wall (/cameras): the API
 * keeps one a minute, so the browser's copy is reused within it
 */
export function cameraPictureUrl(snapshotUrl: string, minute: number): string {
  return `${snapshotUrl}${snapshotUrl.includes('?') ? '&' : '?'}m=${minute}`
}

/** "just now", "4 min ago", "2 h ago" for when a picture was taken */
export function pictureAgeLabel(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.floor((now - t) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.floor(min / 60)} h ago`
}

const TYPE_LABEL: Record<string, string> = { traffic: 'Road camera', weather: 'Road weather camera', city: 'City camera', nature: 'Nature camera' }

/** The popup: a 16:9 frame the picture fills when it arrives, where it is, and who runs the camera */
export function cameraPopupHtml(p: CameraPopupProps): string {
  const place = [p.city, p.city && p.city.includes(p.country) ? '' : p.country].filter(Boolean).join(', ')
  const page = safeHttpUrl(p.embedUrl ?? '')
  const credit = p.sourceName ? `Camera: ${escapeHtml(p.sourceName)}` : 'Camera source'
  return `
    <div class="wp-cam" style="width:min(300px,70vw)">
      <div style="display:flex;align-items:center;gap:6px;font:700 10px/1 system-ui;letter-spacing:.08em;color:#2dd4bf;margin-bottom:7px;padding-right:20px">
        <span style="width:7px;height:7px;border-radius:50%;background:#2dd4bf;box-shadow:0 0 0 3px rgba(45,212,191,.22)"></span>
        LIVE CAMERA
        <span class="wp-cam-age" style="margin-left:auto;font:500 10px/1 system-ui;letter-spacing:0;color:#9aa5b4"></span>
      </div>
      <div style="position:relative;width:100%;aspect-ratio:16/9;background:#0b1220;border-radius:6px;overflow:hidden">
        <img class="wp-cam-img" alt="${escapeHtml(`Live view: ${p.name}`)}" style="width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .25s" />
        <div class="wp-cam-msg" style="position:absolute;inset:0;display:grid;place-items:center;padding:12px;text-align:center;font:12px/1.4 system-ui;color:#9aa5b4">Loading the picture…</div>
      </div>
      <div style="font:600 13px/1.4 system-ui;color:#e2e6f0;margin-top:8px">${escapeHtml(p.name)}</div>
      <div style="font:11px/1.4 system-ui;color:#9aa5b4">${escapeHtml(place)}${place ? ' · ' : ''}${escapeHtml(TYPE_LABEL[p.type] ?? 'Camera')}</div>
      ${page
        ? `<a href="${escapeHtml(page)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:4px;font:11px system-ui;color:#2dd4bf;text-decoration:underline">${credit} ↗</a>`
        : `<div style="margin-top:4px;font:11px system-ui;color:#9aa5b4">${credit}</div>`}
    </div>`
}

/**
 * Shows a camera's current picture in its popup, and a fresh one every
 * minute while the popup stays open. Returns the function that stops it.
 */
export function startCameraPicture(root: HTMLElement, snapshotUrl: string, fetchImpl: typeof fetch = fetch): () => void {
  const img = root.querySelector<HTMLImageElement>('.wp-cam-img')
  const msg = root.querySelector<HTMLElement>('.wp-cam-msg')
  const age = root.querySelector<HTMLElement>('.wp-cam-age')
  const url = safeHttpUrl(snapshotUrl)
  let objectUrl: string | null = null
  let stopped = false
  let takenAt: string | null = null

  const showAge = () => { if (age) age.textContent = pictureAgeLabel(takenAt) }

  const load = async () => {
    if (!img || !msg || !url) return
    try {
      const res = await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}m=${Math.floor(Date.now() / 60_000)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      takenAt = res.headers.get('X-Picture-Time')
      const blob = await res.blob()
      if (stopped) return
      const next = URL.createObjectURL(blob)
      img.onload = () => { img.style.opacity = '1'; msg.style.display = 'none' }
      img.src = next
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = next
      showAge()
    } catch {
      // keep the last picture if there is one; say so if there never was
      if (!objectUrl && msg) msg.textContent = 'No picture from this camera right now. Try another one nearby.'
    }
  }

  void load()
  const timer = setInterval(() => { void load() }, 60_000)
  const ageTimer = setInterval(showAge, 20_000)
  return () => {
    stopped = true
    clearInterval(timer)
    clearInterval(ageTimer)
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}
