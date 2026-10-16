/**
 * fingerprint.ts — in-house fingerprints of report text
 *
 * A fingerprint is a list of 256 numbers that stands for what a text is about,
 * so two reports can be compared by meaning rather than by shared words
 * ("IRGC boards a tanker" and "Iran seizes an oil ship" come out close).
 *
 * Made on our own server, with nothing sent anywhere: a free static model
 * (potion-retrieval-32M by Minish Lab, MIT licence, a distilled bge-base) looks
 * each word piece up in a table and averages the rows, so a report takes well
 * under a millisecond and needs no extra package. On 443 of WorldPulse's own
 * reports from 15 stories (Oct 16, 2026) it told same-story pairs from others
 * better than four larger models that need a neural-network runtime
 * (all-MiniLM-L6-v2, bge-small, gte-small, e5-small), and found the right
 * reports for plain-language searches more often. It replaces OpenAI's
 * embeddings, out of credit since Oct 10.
 *
 * The model is downloaded once from Hugging Face at a fixed revision, checked
 * against its SHA-256, and kept as a 16 MB compact copy (its first 256
 * dimensions, which carry the most information, at 8 bits per number with one
 * scale per row) in FINGERPRINT_DIR, a folder the API and the scraper share.
 *
 * This file is kept identical in apps/api/src/lib and apps/scraper/src/lib
 * (a test in each app checks that the two copies match).
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

/** Numbers per fingerprint */
export const FINGERPRINT_DIMS = 256

const REPO = 'minishlab/potion-retrieval-32M'
const REVISION = '6fc8051fab2a1e0ee76689cf08c853792ac285e7'

/** Stored with every fingerprint, so a later model change can't mix two kinds */
export const FINGERPRINT_MODEL = `potion-retrieval-32M@${REVISION.slice(0, 7)}/${FINGERPRINT_DIMS}`

const VOCAB = {
  file:   'vocab.txt',
  bytes:  492_156,
  sha256: '4b3452e69455f96c6cfc1cdb212d3b7b1a3e9d2505ab6f61a50022f61467a6a3',
}
const TABLE = {
  file:   'model.safetensors',
  bytes:  129_210_456,
  sha256: '07609e5bd33aad37900b3fd62f4ec96f6daec88ca4d46b9d8b928bfababf6ea0',
  rows:   63_091,
  dims:   512,
}
/** Word pieces read per text (the model's own limit) */
const MAX_TOKENS = 512
/** After a failed download, wait this long before trying again */
const RETRY_MS = 15 * 60_000
const MAGIC = 'WPFP'

// ─── Word pieces (the BERT "uncased" tokenizer the model was trained with) ──

const RE_CONTROL = /\p{C}/u
const RE_PUNCT = /\p{P}/u
const RE_SPACE = /\s/u
const RE_MARK = /\p{Mn}/gu

function isControl(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false
  return RE_CONTROL.test(String.fromCodePoint(cp))
}
function isPunctuation(cp: number): boolean {
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true
  return RE_PUNCT.test(String.fromCodePoint(cp))
}
function isChinese(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) || (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b920 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f)
}

/** Clean, space out Chinese characters, strip accents, lower-case (as the reference does) */
export function normalizeText(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0 || cp === 0xfffd || isControl(cp)) continue
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || RE_SPACE.test(ch)) { out += ' '; continue }
    if (isChinese(cp)) { out += ' ' + ch + ' '; continue }
    out += ch
  }
  out = out.normalize('NFD').replace(RE_MARK, '')
  // one character at a time: no context rules (such as the Greek final sigma)
  let low = ''
  for (const ch of out) low += ch.toLowerCase()
  return low
}

/** Split on spaces and around every punctuation mark */
export function splitWords(text: string): string[] {
  const words: string[] = []
  let cur = ''
  for (const ch of text) {
    if (ch === ' ') { if (cur) { words.push(cur); cur = '' } continue }
    if (isPunctuation(ch.codePointAt(0) ?? 0)) { if (cur) { words.push(cur); cur = '' } words.push(ch); continue }
    cur += ch
  }
  if (cur) words.push(cur)
  return words
}

export interface Vocab { ids: Map<string, number>; unk: number }

export function parseVocab(text: string): Vocab {
  const ids = new Map<string, number>()
  text.split('\n').forEach((line, i) => {
    const t = line.replace(/\r$/, '')
    if (t && !ids.has(t)) ids.set(t, i)
  })
  return { ids, unk: ids.get('[UNK]') ?? -1 }
}

/** Word-piece ids of a text, without the special tokens and without unknown pieces */
export function tokenIds(vocab: Vocab, text: string, max = MAX_TOKENS): number[] {
  const out: number[] = []
  for (const word of splitWords(normalizeText(text))) {
    const chars = Array.from(word)
    if (chars.length > 100) continue                       // an unknown word
    const pieces: number[] = []
    let start = 0
    while (start < chars.length) {
      let end = chars.length
      let found = -1
      while (start < end) {
        const sub = (start > 0 ? '##' : '') + chars.slice(start, end).join('')
        const id = vocab.ids.get(sub)
        if (id !== undefined) { found = id; break }
        end--
      }
      if (found < 0) { pieces.length = 0; break }          // the whole word is unknown
      pieces.push(found)
      start = end
    }
    for (const id of pieces) {
      if (id === vocab.unk) continue
      out.push(id)
      if (out.length >= max) return out
    }
  }
  return out
}

// ─── The model ───────────────────────────────────────────────────────────────

export interface FingerprintModel {
  vocab:  Vocab
  rows:   number
  scales: Float32Array
  values: Int8Array
}

/** Fingerprint of a text with a loaded model; null when no word of it is known */
export function fingerprintWith(model: FingerprintModel, text: string): Float32Array | null {
  const ids = tokenIds(model.vocab, text)
  if (ids.length === 0) return null
  const v = new Float32Array(FINGERPRINT_DIMS)
  for (const id of ids) {
    if (id >= model.rows) continue
    const s = model.scales[id] ?? 0
    const o = id * FINGERPRINT_DIMS
    for (let k = 0; k < FINGERPRINT_DIMS; k++) v[k] = (v[k] ?? 0) + (model.values[o + k] ?? 0) * s
  }
  // the average, scaled to length 1 (the scaling makes dividing by the count unnecessary)
  let norm = 0
  for (let k = 0; k < FINGERPRINT_DIMS; k++) norm += (v[k] ?? 0) * (v[k] ?? 0)
  norm = Math.sqrt(norm)
  if (!norm) return null
  for (let k = 0; k < FINGERPRINT_DIMS; k++) v[k] = (v[k] ?? 0) / norm
  return v
}

/** 1 = same meaning, 0 = unrelated (fingerprints have length 1) */
export function similarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let k = 0; k < Math.min(a.length, b.length); k++) dot += (a[k] ?? 0) * (b[k] ?? 0)
  return dot
}

/** The text a report is fingerprinted from: its headline and the start of its summary */
export function reportText(title: string | null | undefined, summary?: string | null): string {
  const t = String(title ?? '').trim()
  const s = String(summary ?? '').trim().slice(0, 400)
  return s && s !== t ? `${t}. ${s}` : t
}

/** pgvector's text form: [0.012345,-0.067890,...] */
export function toVectorLiteral(v: Float32Array): string {
  return '[' + Array.from(v, x => (Object.is(x, -0) ? 0 : x).toFixed(6)).join(',') + ']'
}

// ─── Loading: the compact copy, or download and build it once ──────────────

function modelDir(): string {
  return process.env.FINGERPRINT_DIR || path.join(process.cwd(), '.cache', 'fingerprint')
}
function compactPath(): string {
  return path.join(modelDir(), `potion-retrieval-32M-${REVISION.slice(0, 7)}-${FINGERPRINT_DIMS}.i8`)
}
function vocabPath(): string {
  return path.join(modelDir(), `potion-retrieval-32M-${REVISION.slice(0, 7)}.vocab.txt`)
}
function fileUrl(file: string): string {
  return `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`
}

/** Header (16 bytes) + one scale per row + 256 values per row */
export function encodeCompact(rows: number, scales: Float32Array, values: Int8Array): Buffer {
  const head = Buffer.alloc(16)
  head.write(MAGIC, 0, 'ascii')
  head.writeUInt32LE(rows, 4)
  head.writeUInt32LE(FINGERPRINT_DIMS, 8)
  head.writeUInt32LE(0, 12)
  return Buffer.concat([
    head,
    Buffer.from(scales.buffer, scales.byteOffset, scales.byteLength),
    Buffer.from(values.buffer, values.byteOffset, values.byteLength),
  ])
}

export function decodeCompact(buf: Buffer): { rows: number; scales: Float32Array; values: Int8Array } {
  if (buf.length < 16 || buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('not a fingerprint model file')
  const rows = buf.readUInt32LE(4)
  const dims = buf.readUInt32LE(8)
  if (dims !== FINGERPRINT_DIMS || buf.length !== 16 + rows * 4 + rows * dims) throw new Error('fingerprint model file has the wrong size')
  // copy into aligned arrays (a Buffer's offset into its pool need not be a multiple of 4)
  const scales = new Float32Array(rows)
  Buffer.from(scales.buffer).set(buf.subarray(16, 16 + rows * 4))
  const values = new Int8Array(rows * dims)
  Buffer.from(values.buffer).set(buf.subarray(16 + rows * 4))
  return { rows, scales, values }
}

async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, file)
}

async function download(file: string, timeoutMs: number): Promise<Response> {
  const res = await fetch(fileUrl(file), { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok || !res.body) throw new Error(`downloading ${file}: HTTP ${res.status}`)
  return res
}

export interface TableSpec { bytes: number; sha256: string; rows: number; dims: number }

/**
 * Stream the model's table, check its SHA-256, and keep only what we use:
 * the first 256 numbers of each row, as 8-bit values with one scale per row.
 */
export function buildCompact(stream: AsyncIterable<Uint8Array>): Promise<{ rows: number; scales: Float32Array; values: Int8Array }> {
  return convertTable(stream, TABLE)
}

/** buildCompact for any table of this layout (the tests use a small one) */
export async function convertTable(stream: AsyncIterable<Uint8Array>, spec: TableSpec): Promise<{ rows: number; scales: Float32Array; values: Int8Array }> {
  if (spec.dims < FINGERPRINT_DIMS) throw new Error('model table has too few dimensions')
  const hash = createHash('sha256')
  const rowBytes = spec.dims * 4
  const scales = new Float32Array(spec.rows)
  const values = new Int8Array(spec.rows * FINGERPRINT_DIMS)
  const row = new Float32Array(FINGERPRINT_DIMS)
  let pending: Buffer = Buffer.alloc(0)
  let headerLen = -1
  let started = false
  let r = 0
  let total = 0
  for await (const chunk of stream) {
    hash.update(chunk)
    total += chunk.length
    pending = pending.length ? Buffer.concat([pending, Buffer.from(chunk)]) : Buffer.from(chunk)
    if (headerLen < 0 && pending.length >= 8) {
      headerLen = Number(pending.readBigUInt64LE(0))
      if (headerLen <= 0 || headerLen > 1_000_000) throw new Error('model table has an unreadable header')
    }
    if (!started && headerLen >= 0 && pending.length >= 8 + headerLen) {
      const header = JSON.parse(pending.toString('utf8', 8, 8 + headerLen)) as Record<string, { dtype?: string; shape?: number[]; data_offsets?: number[] }>
      const t = header.embeddings
      if (!t || t.dtype !== 'F32' || t.shape?.[0] !== spec.rows || t.shape?.[1] !== spec.dims || t.data_offsets?.[0] !== 0) {
        throw new Error('model table is not the expected shape')
      }
      pending = pending.subarray(8 + headerLen)
      started = true
    }
    if (!started) continue
    while (pending.length >= rowBytes && r < spec.rows) {
      let max = 0
      for (let k = 0; k < FINGERPRINT_DIMS; k++) {
        const x = pending.readFloatLE(k * 4)
        row[k] = x
        const a = Math.abs(x)
        if (a > max) max = a
      }
      const s = max / 127 || 1
      scales[r] = s
      const o = r * FINGERPRINT_DIMS
      for (let k = 0; k < FINGERPRINT_DIMS; k++) values[o + k] = Math.round((row[k] ?? 0) / s)
      pending = pending.subarray(rowBytes)
      r++
    }
  }
  const digest = hash.digest('hex')
  if (total !== spec.bytes || digest !== spec.sha256) throw new Error('model table failed its checksum')
  if (r !== spec.rows) throw new Error('model table ended early')
  return { rows: r, scales, values }
}

async function readOrBuild(): Promise<{ model: FingerprintModel; source: 'cache' | 'download' }> {
  try {
    const [compact, vocabText] = await Promise.all([fs.readFile(compactPath()), fs.readFile(vocabPath(), 'utf8')])
    const c = decodeCompact(compact)
    return { model: { vocab: parseVocab(vocabText), ...c }, source: 'cache' }
  } catch {
    // not built yet (or unreadable): download and build it below
  }
  // tests never download 130 MB (they mock this, or give a FINGERPRINT_DIR with the model)
  if (process.env.VITEST && !process.env.FINGERPRINT_ALLOW_DOWNLOAD) throw new Error('no model download in tests')
  await fs.mkdir(modelDir(), { recursive: true })
  const vres = await download(VOCAB.file, 120_000)
  const vbuf = Buffer.from(await vres.arrayBuffer())
  if (vbuf.length !== VOCAB.bytes || createHash('sha256').update(vbuf).digest('hex') !== VOCAB.sha256) {
    throw new Error('model vocabulary failed its checksum')
  }
  const tres = await download(TABLE.file, 15 * 60_000)
  const c = await buildCompact(tres.body as unknown as AsyncIterable<Uint8Array>)
  await writeAtomic(compactPath(), encodeCompact(c.rows, c.scales, c.values))
  await writeAtomic(vocabPath(), vbuf)
  return { model: { vocab: parseVocab(vbuf.toString('utf8')), ...c }, source: 'download' }
}

let loading: Promise<FingerprintModel | null> | null = null
let failedAt = 0
let status: { ready: boolean; source: string | null; error: string | null; at: string | null } = {
  ready: false, source: null, error: null, at: null,
}

/** The model, loading it on first use; null while it can't be had (tried again after 15 minutes) */
export function loadFingerprintModel(): Promise<FingerprintModel | null> {
  if (loading) return loading
  if (failedAt && Date.now() - failedAt < RETRY_MS) return Promise.resolve(null)
  loading = readOrBuild()
    .then(({ model, source }) => {
      status = { ready: true, source, error: null, at: new Date().toISOString() }
      return model
    })
    .catch((err: unknown) => {
      failedAt = Date.now()
      loading = null
      status = { ready: false, source: null, error: String((err as Error)?.message ?? err).slice(0, 200), at: new Date().toISOString() }
      return null
    })
  return loading
}

/** Whether the model is loaded, where from, and the last error */
export function fingerprintStatus(): { ready: boolean; source: string | null; error: string | null; at: string | null } {
  return { ...status }
}

/** Fingerprint of a text; null when the model isn't available or no word is known */
export async function fingerprint(text: string): Promise<Float32Array | null> {
  const model = await loadFingerprintModel()
  return model ? fingerprintWith(model, text) : null
}

/** For tests: forget the loaded model */
export function resetFingerprintModel(): void {
  loading = null
  failedAt = 0
  status = { ready: false, source: null, error: null, at: null }
}
