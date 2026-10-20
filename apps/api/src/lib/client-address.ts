/**
 * Whose address a request is counted against (rate limits, flags, logs):
 * the one nginx saw (plan V3e, Oct 20, 2026).
 *
 * nginx, the only way in from outside (the API's port isn't published),
 * appends the address it sees to whatever X-Forwarded-For the client sent.
 * The API trusted the whole header (trustProxy: true), so req.ip was its
 * left-most entry, which the client writes: any client could name its own
 * address and get a fresh rate limit on every call.
 *
 * Now only proxies on the server's own private network (nginx on the Docker
 * network) are trusted, so req.ip is the address nginx added. A connection
 * from anywhere else is its own address whatever its headers say, and calls
 * from inside the server with no such header (the website's own server) keep
 * their own address. (A hop count can't be used: Fastify 5.12 trusts nothing
 * for one, since a count can't check who is connecting.)
 */
export const TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal']
