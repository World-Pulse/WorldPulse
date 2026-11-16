/**
 * A daily cap on what one account can upload (H-0056 part 2, Nov 2026).
 * Uploads had a size limit per file but none per account, so one account
 * could fill the server's disk (Oct 12 showed what that does).
 *
 * Counted per account per UTC day in Redis: files and bytes. The check runs
 * before a file is written and the count after, so a call that goes over is
 * stopped at the next file. If Redis is down uploads are allowed (the
 * per-file limits still apply) rather than blocked for everyone.
 */
import { redis } from '../db/redis'

export const UPLOAD_FILES_PER_DAY = 40
export const UPLOAD_BYTES_PER_DAY = 300 * 1024 * 1024  // 300 MB

export function uploadDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export const uploadFilesKey = (userId: string, day = uploadDay()) => `upload:files:${userId}:${day}`
export const uploadBytesKey = (userId: string, day = uploadDay()) => `upload:bytes:${userId}:${day}`

/** True while the account is under both caps. */
export async function uploadAllowed(userId: string): Promise<boolean> {
  try {
    const [files, bytes] = await Promise.all([redis.get(uploadFilesKey(userId)), redis.get(uploadBytesKey(userId))])
    return Number(files || 0) < UPLOAD_FILES_PER_DAY && Number(bytes || 0) < UPLOAD_BYTES_PER_DAY
  } catch {
    return true
  }
}

/** Count one stored file of `bytes` bytes against the account's day. */
export async function countUpload(userId: string, bytes: number): Promise<void> {
  try {
    const fk = uploadFilesKey(userId)
    const bk = uploadBytesKey(userId)
    await redis.incr(fk)
    await redis.incrby(bk, Math.max(0, Math.round(bytes)))
    // a little over a day, so the keys clean themselves up
    await Promise.all([redis.expire(fk, 26 * 3600), redis.expire(bk, 26 * 3600)])
  } catch {
    // counting is best effort
  }
}
