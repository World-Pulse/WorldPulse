import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { authenticate } from '../middleware/auth'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'

// ─── CONSTANTS ────────────────────────────────────────────────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads', 'post-media')

// Accepted MIME types
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
])
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
])
const ALL_ALLOWED_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES])

const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024  // 10 MB for images
const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024  // 50 MB for videos

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/gif': '.gif',  'image/webp': '.webp', 'image/avif': '.avif',
}
const VIDEO_EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4', 'video/webm': '.webm',
  'video/quicktime': '.mov', 'video/x-msvideo': '.avi',
}

// ─── SETUP ────────────────────────────────────────────────────────────────
function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  }
}

function generateFilename(mimeType: string): string {
  const id  = crypto.randomBytes(16).toString('hex')
  const ext = IMAGE_EXTENSIONS[mimeType] ?? VIDEO_EXTENSIONS[mimeType] ?? '.bin'
  return `${id}${ext}`
}

function buildPublicUrl(filename: string): string {
  const base = process.env.UPLOADS_BASE_URL ?? 'http://localhost:3001'
  return `${base}/uploads/post-media/${filename}`
}

// ─── ROUTES ──────────────────────────────────────────────────────────────
export const registerUploadRoutes: FastifyPluginAsync = async (app) => {
  ensureUploadsDir()

  // Register multipart with a generous body limit (50 MB)
  await app.register(multipart, {
    limits: {
      fileSize:  VIDEO_SIZE_LIMIT,
      files:     4,
      fieldSize: 1024,
    },
  })

  // Serve uploaded files statically (if not using a CDN / nginx proxy)
  // In production, reverse-proxy /uploads/ to the uploads dir via nginx.
  // In dev, we register a simple file-serving GET route.
  app.get('/files/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string }
    // Basic path-traversal protection
    if (/[^a-zA-Z0-9._-]/.test(filename)) {
      return reply.status(400).send({ success: false, error: 'Invalid filename' })
    }

    const filePath = path.join(UPLOADS_DIR, filename)
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ success: false, error: 'File not found' })
    }

    const ext = path.extname(filename).toLowerCase()
    const contentType: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif',  '.webp': 'image/webp', '.avif': 'image/avif',
      '.mp4': 'video/mp4',  '.webm': 'video/webm', '.mov': 'video/quicktime',
    }
    reply.header('Content-Type', contentType[ext] ?? 'application/octet-stream')
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    return reply.send(fs.createReadStream(filePath))
  })

  // ─── UPLOAD ENDPOINT ──────────────────────────────────────
  // POST /api/v1/uploads
  // Accepts: multipart/form-data with field "file" (or up to 4 fields named "file")
  // Returns: { success: true, data: { url, urls, type } }
  app.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const files: Array<{ url: string; type: 'image' | 'video' }> = []

    try {
      const parts = req.files()

      for await (const part of parts) {
        const mimeType = part.mimetype

        if (!ALL_ALLOWED_TYPES.has(mimeType)) {
          // Drain stream to avoid memory leaks
          part.file.resume()
          return reply.status(400).send({
            success: false,
            error:   `Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, MOV`,
          })
        }

        const isVideo = ALLOWED_VIDEO_TYPES.has(mimeType)
        const filename = generateFilename(mimeType)
        const filePath = path.join(UPLOADS_DIR, filename)

        if (isVideo) {
          // Write video directly (no processing)
          let bytesWritten = 0
          const writeStream = fs.createWriteStream(filePath)
          const fileStream  = part.file

          fileStream.on('data', (chunk: Buffer) => {
            bytesWritten += chunk.length
            if (bytesWritten > VIDEO_SIZE_LIMIT) {
              writeStream.destroy()
              fileStream.destroy()
            }
          })

          await pipeline(fileStream, writeStream).catch((err: Error) => {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            throw err
          })

          if (bytesWritten > VIDEO_SIZE_LIMIT) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            return reply.status(413).send({ success: false, error: 'Video exceeds 50 MB size limit' })
          }

          files.push({ url: buildPublicUrl(filename), type: 'video' })
        } else {
          // Process image with sharp: resize if oversized, normalize format
          const chunks: Buffer[] = []
          let totalBytes = 0

          for await (const chunk of part.file) {
            totalBytes += (chunk as Buffer).length
            if (totalBytes > IMAGE_SIZE_LIMIT) {
              return reply.status(413).send({ success: false, error: 'Image exceeds 10 MB size limit' })
            }
            chunks.push(chunk as Buffer)
          }

          const imageBuffer = Buffer.concat(chunks)

          // Convert to WebP for storage efficiency, max 1920px wide
          const outputFilename = filename.replace(/\.[^.]+$/, '.webp')
          const outputPath     = path.join(UPLOADS_DIR, outputFilename)

          await sharp(imageBuffer)
            .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toFile(outputPath)

          files.push({ url: buildPublicUrl(outputFilename), type: 'image' })
        }
      }
    } catch (err) {
      app.log.error(err, 'Upload error')
      return reply.status(500).send({ success: false, error: 'Upload failed' })
    }

    if (files.length === 0) {
      return reply.status(400).send({ success: false, error: 'No files received' })
    }

    const firstFile = files[0]
    if (!firstFile) {
      return reply.status(400).send({ success: false, error: 'No files received' })
    }

    return reply.status(201).send({
      success: true,
      data: {
        url:   firstFile.url,
        urls:  files.map(f => f.url),
        types: files.map(f => f.type),
        count: files.length,
      },
    })
  })
}
