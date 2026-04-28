## Code Review: Rate Limiting API Middleware

**Verdict**: 🔴 Request changes

### Summary

This middleware implements rate limiting for API and authentication endpoints using the express-rate-limit library. The implementation has critical security vulnerabilities that enable bypass attacks and expose sensitive information in request bodies. These must be fixed before merging.

### 🔴 Must Fix

| File | Line | Issue | Why it matters |
|------|------|-------|----------------|
| rateLimit.ts | 7-8 | Hardcoded `x-internal-token` with value `'secret123'` | Credentials in source code can be exposed in version control, logs, and error messages. Anyone with repo access can bypass rate limiting entirely. |
| rateLimit.ts | 6 | `x-forwarded-for` header used directly as rate limit key without validation | Clients can forge `x-forwarded-for` headers to bypass rate limiting by rotating IPs. Proper extraction requires checking proxy chain and trusting only the first or last IP based on infrastructure. |
| rateLimit.ts | 15 | `req.body.email` used in keyGenerator for rate limit key | Request body is read for rate limiting, but the keyGenerator runs before body parsing completes reliably. This creates a race condition and may silently fail to rate limit, especially in high-concurrency scenarios. Additionally, using email as a rate limit key with no validation leaks user enumeration data in edge cases. |

### 🟡 Should Fix

| File | Line | Issue | Category |
|------|------|-------|----------|
| rateLimit.ts | 5 | Missing configuration for `standardHeaders` and `legacyHeaders` | Performance/UX: clients should receive `RateLimit-*` headers to respect rate limits gracefully. Opacity harms API UX. |
| rateLimit.ts | 10-13 | No metrics or logging when rate limit triggered | Correctness/Observability: without logs, you cannot detect attack patterns, monitor legitimate spikes, or debug false positives. |
| rateLimit.ts | 5, 11 | Hard-coded window and limit values with no environment configuration | Maintainability: changing limits requires code redeploy. Should be environment variables for operational flexibility. |
| rateLimit.ts | 1-16 | No error recovery or graceful degradation if store unavailable | Correctness: if the in-memory store fills or crashes, rate limiting silently stops. Should fail-safe to deny rather than allow. |

### 💡 Consider

- **Import paths**: Confirm that `express-rate-limit` is listed in `package.json` dependencies; if this is a new dependency, add it to the review description so reviewers are aware of the new transitive dependency graph.

- **Store choice**: The default in-memory store does not work for multi-instance deployments (e.g., load-balanced servers). If this API runs on multiple servers, you'll need a Redis or distributed store. Consider documenting this assumption or adding a store parameter that defaults to in-memory but can be overridden.

- **Route coverage**: Ensure these limiters are actually applied to the routes that need them. The review shows exports but not middleware application. Verify in the main app router that `apiLimiter` wraps all public endpoints and `authLimiter` wraps login/signup routes.

- **Testing**: Add tests that verify:
  - Rate limit threshold is enforced (requests at max pass, max+1 fails)
  - Bypass via `x-internal-token` only works with the correct value
  - Forged `x-forwarded-for` headers do not bypass limits (test with rotated IPs)
  - Both limiters recover after window expires (idempotency)

### ✅ What's Good

- **Separate limiters for different endpoints**: Using `apiLimiter` for general traffic and `authLimiter` for authentication with a longer window (15 min vs 1 min) and tighter limit (20 vs 100) reflects appropriate threat modeling. Brute force attacks on auth should be more restrictive than general API use.

- **Explicit error response**: Custom `handler` ensures responses are consistent with your API schema rather than relying on library defaults.

- **Non-blocking design**: Rate limiting is applied via middleware and doesn't introduce synchronous blocking operations in the critical path (assuming the underlying store is reasonably fast).

---

## Recommended Changes

### Critical (before merge)

1. **Move `x-internal-token` to environment variable:**
   ```typescript
   const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
   if (!INTERNAL_TOKEN) {
     throw new Error('INTERNAL_TOKEN env var is required');
   }

   skip: (req) => req.headers['x-internal-token'] === INTERNAL_TOKEN,
   ```

2. **Validate and extract `x-forwarded-for` properly:**
   ```typescript
   keyGenerator: (req) => {
     // If behind a trusted proxy, extract the client IP from the chain
     const forwarded = req.headers['x-forwarded-for'];
     if (forwarded) {
       // Take the first IP in the chain (leftmost) as the original client
       return forwarded.split(',')[0].trim();
     }
     return req.ip;
   },
   ```

3. **Fix the auth limiter keyGenerator to use IP, not email:**
   ```typescript
   keyGenerator: (req) => req.ip,
   ```
   Store email-based rate limiting if needed, but do so *after* validating the email format and never expose raw email in headers or logs.

### High (before or shortly after merge)

4. **Add rate limit headers and environment variables:**
   ```typescript
   export const apiLimiter = rateLimit({
     windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10),
     max: parseInt(process.env.API_RATE_LIMIT_MAX || '100', 10),
     keyGenerator: (req) => { /* ... */ },
     skip: (req) => req.headers['x-internal-token'] === INTERNAL_TOKEN,
     handler: (req, res) => {
       res.status(429).json({ error: 'too many requests' });
     },
     standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers
     legacyHeaders: false,   // Disable `X-RateLimit-*` headers
   });
   ```

5. **Add logging:**
   ```typescript
   handler: (req, res) => {
     logger.warn('Rate limit exceeded', {
       ip: req.ip,
       endpoint: req.path,
       timestamp: new Date().toISOString(),
     });
     res.status(429).json({ error: 'too many requests' });
   },
   ```
