/**
 * Reading zip files (and so XLSX workbooks, which are zips) without a library: the central
 * directory says where each file's bytes are; stored or deflated files are what USDA's and the
 * World Bank's downloads use. (Oct 23, 2026: the commodity watch's sources.)
 */

import { inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  name: string
  /** 0 stored, 8 deflated */
  method: number
  /** The file's bytes as stored in the zip (compressed when method is 8) */
  data: Buffer
}

/** Every file in a zip, in the central directory's order */
export function zipEntries(zip: Buffer): ZipEntry[] {
  let eocd = -1
  // The end-of-central-directory record: in the last 64 KB, after an optional comment
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)')
  const count = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let k = 0; k < count; k++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip central directory is damaged')
    const method = zip.readUInt16LE(offset + 10)
    const compressed = zip.readUInt32LE(offset + 20)
    const nameLen = zip.readUInt16LE(offset + 28)
    const extraLen = zip.readUInt16LE(offset + 30)
    const commentLen = zip.readUInt16LE(offset + 32)
    const local = zip.readUInt32LE(offset + 42)
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLen)
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`zip local header for ${name} not found`)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    entries.push({ name, method, data: zip.subarray(start, start + compressed) })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** A file listed in a zip's central directory, where its local header starts, and its sizes */
export interface ZipListing { name: string; method: number; compressed: number; size: number; local: number }

/**
 * The central directory from the end of a zip only (its last bytes, starting at tailStart): for
 * files too big to download whole, whose parts are then fetched by byte range. Zip64 not handled.
 */
export function centralDirectory(tail: Buffer, tailStart: number): ZipListing[] {
  let eocd = -1
  for (let i = tail.length - 22; i >= Math.max(0, tail.length - 65_557); i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('no end of central directory in the bytes read')
  const count = tail.readUInt16LE(eocd + 10)
  let offset = tail.readUInt32LE(eocd + 16) - tailStart
  if (offset < 0) throw new Error('the central directory starts before the bytes read')
  const out: ZipListing[] = []
  for (let k = 0; k < count; k++) {
    if (tail.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip central directory is damaged')
    const nameLen = tail.readUInt16LE(offset + 28)
    out.push({
      name: tail.toString('utf8', offset + 46, offset + 46 + nameLen),
      method: tail.readUInt16LE(offset + 10),
      compressed: tail.readUInt32LE(offset + 20),
      size: tail.readUInt32LE(offset + 24),
      local: tail.readUInt32LE(offset + 42),
    })
    offset += 46 + nameLen + tail.readUInt16LE(offset + 30) + tail.readUInt16LE(offset + 32)
  }
  return out
}

/** Where a file's data starts, from its local header's first 30 bytes */
export function dataStart(localHeader: Buffer, local: number): number {
  if (localHeader.readUInt32LE(0) !== 0x04034b50) throw new Error('zip local header not found')
  return local + 30 + localHeader.readUInt16LE(26) + localHeader.readUInt16LE(28)
}

/** A small file's contents (a whole workbook part; not the 200 MB PSD file, which is streamed) */
export function entryText(entry: ZipEntry): string {
  if (entry.method === 0) return entry.data.toString('utf8')
  if (entry.method === 8) return inflateRawSync(entry.data).toString('utf8')
  throw new Error(`zip method ${entry.method} not supported (${entry.name})`)
}
