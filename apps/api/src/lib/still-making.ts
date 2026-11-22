/**
 * An answer still being made when its caller stops waiting (Nov 22, 2026).
 *
 * lib/swr-cache.ts's `waitSeconds`: with nothing kept, a caller waits that long for the answer, then gets
 * StillMaking while the make goes on in the background and keeps the answer, so the next caller has it at once.
 * Before, with the server's load at 24 on its 2 CPUs after a deploy, a visitor or an AI app waited out the query's
 * whole time limit (up to 2 minutes, past nginx's 90 seconds) for nothing, and the next one started over.
 */
import type { FastifyReply } from 'fastify'
import { sendError } from './errors'

export class StillMaking extends Error {
  constructor(readonly key: string) {
    super(`still being made: ${key}`)
    this.name = 'StillMaking'
  }
}

/** How long a caller who stopped waiting is told to wait before asking again */
export const ASK_AGAIN_SECONDS = 60
/** Marks this 503 for the AI tools (routes/mcp.ts ask), which pass its message on instead of a general one */
export const STILL_MAKING_HEADER = 'x-still-making'

/** 503 with retry-after, for a caller who stopped waiting: `what` says what is under way ("The chokepoints are being counted") */
export function sendStillMaking(reply: FastifyReply, what: string): ReturnType<FastifyReply['send']> {
  reply.header('retry-after', String(ASK_AGAIN_SECONDS))
  reply.header(STILL_MAKING_HEADER, '1')
  return sendError(reply, 503, 'SERVICE_UNAVAILABLE', `${what} on a busy server; try again in a minute`)
}
