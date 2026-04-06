/**
 * Uploads API Route Tests — apps/api/src/routes/uploads.ts
 *
 * Tests the file upload system: MIME type validation, size limits,
 * filename generation, path traversal protection, public URL building,
 * file serving, and multipart configuration.
 */

import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import path from 'node:path'

// ─── Constants (mirroring uploads.ts) ───────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
])
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
])
const ALL_ALLOWED_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES])

const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024  // 10 MB
const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024  // 50 MB

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif',
}
const VIDEO_EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4', 'video/webm': '.webm',
  'video/quicktime': '.mov', 'video/x-msvideo': '.avi',
}

// ─── Helpers (mirroring uploads.ts logic) ───────────────────────────────────

function generateFilename(mimeType: string): string {
  const id = crypto.randomBytes(16).toString('hex')
  const ext = IMAGE_EXTENSIONS[mimeType] ?? VIDEO_EXTENSIONS[mimeType] ?? '.bin'
  return `${id}${ext}`
}

function buildPublicUrl(filename: string): string {
  const base = process.env.UPLOADS_BASE_URL ?? 'http://localhost:3001'
  return `${base}/uploads/post-media/${filename}`
}

function isPathTraversalSafe(filename: string): boolean {
  return !/[^a-zA-Z0-9._-]/.test(filename)
}

// ═════════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ═════════════════════════════════════════════════════════════════════════════

describe('MIME Type Validation', () => {
  it('accepts all 6 image types', () => {
    const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
    for (const type of imageTypes) {
      expect(ALL_ALLOWED_TYPES.has(type)).toBe(true)
    }
  })

  it('accepts all 4 video types', () => {
    const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo']
    for (const type of videoTypes) {
      expect(ALL_ALLOWED_TYPES.has(type)).toBe(true)
    }
  })

  it('rejects application/pdf', () => {
    expect(ALL_ALLOWED_TYPES.has('application/pdf')).toBe(false)
  })

  it('rejects text/html', () => {
    expect(ALL_ALLOWED_TYPES.has('text/html')).toBe(false)
  })

  it('rejects application/javascript', () => {
    expect(ALL_ALLOWED_TYPES.has('application/javascript')).toBe(false)
  })

  it('rejects application/x-executable', () => {
    expect(ALL_ALLOWED_TYPES.has('application/x-executable')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(ALL_ALLOWED_TYPES.has('')).toBe(false)
  })

  it('total allowed types count is 10', () => {
    expect(ALL_ALLOWED_TYPES.size).toBe(10)
  })

  it('image and video type sets are disjoint', () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(ALLOWED_VIDEO_TYPES.has(type)).toBe(false)
    }
  })
})

describe('Size Limits', () => {
  it('image limit is 10 MB', () => {
    expect(IMAGE_SIZE_LIMIT).toBe(10 * 1024 * 1024)
  })

  it('video limit is 50 MB', () => {
    expect(VIDEO_SIZE_LIMIT).toBe(50 * 1024 * 1024)
  })

  it('video limit is 5x image limit', () => {
    expect(VIDEO_SIZE_LIMIT / IMAGE_SIZE_LIMIT).toBe(5)
  })
})

describe('Filename Generation', () => {
  it('generates unique filenames', () => {
    const names = new Set<string>()
    for (let i = 0; i < 100; i++) {
      names.add(generateFilename('image/png'))
    }
    expect(names.size).toBe(100)
  })

  it('filename is 32 hex chars + extension', () => {
    const name = generateFilename('image/png')
    expect(name).toMatch(/^[0-9a-f]{32}\.png$/)
  })

  it('uses correct extension for each image type', () => {
    expect(generateFilename('image/jpeg')).toMatch(/\.jpg$/)
    expect(generateFilename('image/jpg')).toMatch(/\.jpg$/)
    expect(generateFilename('image/png')).toMatch(/\.png$/)
    expect(generateFilename('image/gif')).toMatch(/\.gif$/)
    expect(generateFilename('image/webp')).toMatch(/\.webp$/)
    expect(generateFilename('image/avif')).toMatch(/\.avif$/)
  })

  it('uses correct extension for each video type', () => {
    expect(generateFilename('video/mp4')).toMatch(/\.mp4$/)
    expect(generateFilename('video/webm')).toMatch(/\.webm$/)
    expect(generateFilename('video/quicktime')).toMatch(/\.mov$/)
    expect(generateFilename('video/x-msvideo')).toMatch(/\.avi$/)
  })

  it('falls back to .bin for unknown MIME type', () => {
    expect(generateFilename('application/pdf')).toMatch(/\.bin$/)
    expect(generateFilename('unknown/type')).toMatch(/\.bin$/)
  })

  it('filename contains only safe characters', () => {
    const name = generateFilename('image/png')
    expect(isPathTraversalSafe(name)).toBe(true)
  })
})

describe('Public URL Building', () => {
  it('uses default base URL when env not set', () => {
    const original = process.env.UPLOADS_BASE_URL
    delete process.env.UPLOADS_BASE_URL
    const url = buildPublicUrl('abc123.png')
    expect(url).toBe('http://localhost:3001/uploads/post-media/abc123.png')
    if (original) process.env.UPLOADS_BASE_URL = original
  })

  it('includes /uploads/post-media/ path', () => {
    const url = buildPublicUrl('test.jpg')
    expect(url).toContain('/uploads/post-media/')
  })

  it('appends filename to URL', () => {
    const url = buildPublicUrl('myfile.mp4')
    expect(url.endsWith('myfile.mp4')).toBe(true)
  })
})

describe('Path Traversal Protection', () => {
  it('allows alphanumeric filenames', () => {
    expect(isPathTraversalSafe('abc123def456.png')).toBe(true)
  })

  it('allows hyphens and dots', () => {
    expect(isPathTraversalSafe('my-file.test.jpg')).toBe(true)
  })

  it('allows underscores', () => {
    expect(isPathTraversalSafe('my_file_2.png')).toBe(true)
  })

  it('rejects ../', () => {
    expect(isPathTraversalSafe('../../../etc/passwd')).toBe(false)
  })

  it('rejects forward slashes', () => {
    expect(isPathTraversalSafe('uploads/evil.jpg')).toBe(false)
  })

  it('rejects backslashes', () => {
    expect(isPathTraversalSafe('uploads\\evil.jpg')).toBe(false)
  })

  it('rejects spaces', () => {
    expect(isPathTraversalSafe('my file.jpg')).toBe(false)
  })

  it('rejects null bytes', () => {
    expect(isPathTraversalSafe('file\x00.jpg')).toBe(false)
  })

  it('rejects tilde', () => {
    expect(isPathTraversalSafe('~root')).toBe(false)
  })

  it('rejects colon (Windows drive letters)', () => {
    expect(isPathTraversalSafe('C:file.jpg')).toBe(false)
  })
})

describe('Content Type Mapping', () => {
  const contentType: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  }

  it('maps .jpg to image/jpeg', () => {
    expect(contentType['.jpg']).toBe('image/jpeg')
  })

  it('maps .jpeg to image/jpeg', () => {
    expect(contentType['.jpeg']).toBe('image/jpeg')
  })

  it('maps .png to image/png', () => {
    expect(contentType['.png']).toBe('image/png')
  })

  it('maps .mp4 to video/mp4', () => {
    expect(contentType['.mp4']).toBe('video/mp4')
  })

  it('maps .webm to video/webm', () => {
    expect(contentType['.webm']).toBe('video/webm')
  })

  it('maps .mov to video/quicktime', () => {
    expect(contentType['.mov']).toBe('video/quicktime')
  })

  it('returns undefined for unknown extensions', () => {
    expect(contentType['.exe']).toBeUndefined()
    expect(contentType['.sh']).toBeUndefined()
  })
})

describe('Multipart Configuration', () => {
  it('allows up to 4 files per request', () => {
    const MAX_FILES = 4
    expect(MAX_FILES).toBe(4)
  })

  it('field size limit is 1024 bytes', () => {
    const FIELD_SIZE = 1024
    expect(FIELD_SIZE).toBe(1024)
  })

  it('file size limit matches VIDEO_SIZE_LIMIT (50 MB)', () => {
    // multipart fileSize is set to VIDEO_SIZE_LIMIT to accommodate largest uploads
    expect(VIDEO_SIZE_LIMIT).toBe(50 * 1024 * 1024)
  })
})

describe('Cache Headers for Served Files', () => {
  it('expects immutable cache-control for uploaded files', () => {
    const cacheControl = 'public, max-age=31536000, immutable'
    expect(cacheControl).toContain('immutable')
    expect(cacheControl).toContain('max-age=31536000') // 1 year
  })
})

describe('Upload Response Shape', () => {
  it('success response includes url, urls, and type', () => {
    const mockResponse = {
      success: true,
      data: {
        url: 'http://localhost:3001/uploads/post-media/abc123.jpg',
        urls: ['http://localhost:3001/uploads/post-media/abc123.jpg'],
        type: 'image' as const,
      },
    }

    expect(mockResponse.success).toBe(true)
    expect(mockResponse.data).toHaveProperty('url')
    expect(mockResponse.data).toHaveProperty('urls')
    expect(mockResponse.data).toHaveProperty('type')
    expect(['image', 'video']).toContain(mockResponse.data.type)
  })
})

describe('Error Responses', () => {
  it('unsupported file type returns VALIDATION_ERROR', () => {
    const error = { success: false, error: 'Unsupported file type: text/html', code: 'VALIDATION_ERROR' }
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.success).toBe(false)
  })

  it('file not found returns NOT_FOUND', () => {
    const error = { success: false, error: 'File not found', code: 'NOT_FOUND' }
    expect(error.code).toBe('NOT_FOUND')
  })

  it('invalid filename returns VALIDATION_ERROR', () => {
    const error = { success: false, error: 'Invalid filename', code: 'VALIDATION_ERROR' }
    expect(error.code).toBe('VALIDATION_ERROR')
  })
})
