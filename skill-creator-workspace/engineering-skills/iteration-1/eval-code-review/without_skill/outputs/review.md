# Code Review: Rate Limiting Middleware
**File:** `apps/api/src/middleware/rateLimit.ts`
**Review Date:** 2026-03-28
**Status:** CRITICAL ISSUES FOUND - DO NOT MERGE

---

## Executive Summary

This rate limiting implementation has **serious security vulnerabilities** and design flaws that require immediate remediation before deployment. The hardcoded authentication bypass and weak key generation create exploitable attack vectors.

---

## Critical Issues

### 1. **CRITICAL: Hardcoded Internal Token (Security Vulnerability)**

**Location:** Line 11
```typescript
skip: (req) => req.headers['x-internal-token'] === 'secret123'
```

**Issue:**
- The token `'secret123'` is hardcoded in source code and will be committed to the repository
- Any developer, contractor, or compromised account can bypass rate limits
- The token is likely visible in git history permanently
- This completely defeats the purpose of rate limiting for authenticated internal requests

**Risk Level:** CRITICAL
**Impact:** Complete bypass of rate limiting; potential for DDoS or resource exhaustion

**Recommendations:**
1. Move the token to an environment variable: `process.env.INTERNAL_TOKEN`
2. Generate a cryptographically secure token (not a simple string like 'secret123')
3. Rotate the token immediately after deployment
4. Use a proper secret management system (e.g., AWS Secrets Manager, HashiCorp Vault)
5. Audit git history and remove the exposed secret
6. Consider using mTLS or API key authentication instead of a header token

**Example Fix:**
```typescript
skip: (req) => req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN
```

---

### 2. **HIGH: Unsafe Key Generation - X-Forwarded-For Spoofing**

**Location:** Line 9 (apiLimiter)
```typescript
keyGenerator: (req) => req.headers['x-forwarded-for'] as string || req.ip
```

**Issue:**
- The `x-forwarded-for` header is user-controlled and can be spoofed
- An attacker can send requests with different `x-forwarded-for` values to bypass rate limits
- If the header is missing, it falls back to `req.ip`, which may also be unreliable depending on your proxy configuration

**Risk Level:** HIGH
**Impact:** Rate limit bypass; attackers can make unlimited requests from a single source

**Recommendations:**
1. Only trust `x-forwarded-for` if your proxy is verified (e.g., reverse proxy you control)
2. Implement a whitelist of trusted proxy IPs
3. Verify proxy configuration in production
4. Consider using a combination of IP + session ID for authenticated users
5. Log and monitor for suspicious rate limit bypass attempts

**Example Fix:**
```typescript
const TRUSTED_PROXIES = [process.env.PROXY_IP]; // Only trust specific proxy IPs

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => {
    // Trust x-forwarded-for only from trusted proxies
    if (TRUSTED_PROXIES.includes(req.ip)) {
      return (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip;
    }
    return req.ip;
  },
  skip: (req) => req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN,
  handler: (req, res) => {
    res.status(429).json({ error: 'too many requests' })
  }
})
```

---

### 3. **HIGH: Email-Based Rate Limiting Has Collision Risk**

**Location:** Line 16 (authLimiter)
```typescript
keyGenerator: (req) => req.body.email || req.ip
```

**Issue:**
- Email addresses from `req.body` are user-controlled during auth attempts
- An attacker could provide a different email in the request body than what they're actually attacking
- The fallback to `req.ip` is inconsistent - some requests use email, others use IP, making rate limiting ineffective
- No validation that the email is even present or valid

**Risk Level:** HIGH
**Impact:** Brute force attacks on authentication endpoints; attackers can target specific emails without rate limiting

**Recommendations:**
1. Always use the IP address as the key for auth endpoints (not email)
2. Implement a secondary limit on email addresses if needed, but keep IP-based limits as primary
3. Add request body validation and sanitization
4. Consider implementing progressive delays (longer waits) for repeated failures
5. Add monitoring for brute force patterns

**Example Fix:**
```typescript
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.ip, // Always use IP, not user input
  handler: (req, res) => {
    res.status(429).json({ error: 'too many attempts' })
  }
})
```

---

## High-Priority Issues

### 4. **MEDIUM: Missing Request Logging and Monitoring**

**Issue:**
- No logging when rate limits are hit
- Can't detect attack patterns or monitor for abuse
- Makes debugging customer issues difficult

**Recommendations:**
```typescript
handler: (req, res) => {
  logger.warn('Rate limit exceeded', {
    ip: req.ip,
    endpoint: req.path,
    email: req.body?.email,
    timestamp: new Date().toISOString()
  });
  res.status(429).json({ error: 'too many attempts' })
}
```

---

### 5. **MEDIUM: Window Size and Max Settings May Be Insufficient**

**Location:** Lines 8 and 15

**Issue:**
- 100 requests per minute might be too high for auth endpoints (allows many brute force attempts)
- 20 attempts in 15 minutes might be too high if legitimate users fail frequently
- No consideration for different user types (mobile vs. desktop, bots vs. humans)

**Recommendations:**
1. Reduce auth limiter to 5-10 attempts per 15 minutes
2. Increase API limiter window or reduce max based on actual traffic patterns
3. Implement adaptive rate limiting (stricter for failures, looser for success)
4. Add separate, stricter limits for password reset and account recovery

---

### 6. **MEDIUM: No Handler for Success Path or Metrics**

**Issue:**
- No tracking of successful rate limit operations
- Can't measure if limits are effective
- Missing metrics for ops/product teams

**Recommendations:**
```typescript
handler: (req, res) => {
  const limitKey = req.ip;
  metrics.increment('rate_limit.exceeded', {
    endpoint: req.path,
    ip: limitKey
  });
  res.status(429).json({ error: 'too many attempts' })
}
```

---

## Code Quality Issues

### 7. **Type Safety Gaps**

**Location:** Line 9
```typescript
keyGenerator: (req) => req.headers['x-forwarded-for'] as string || req.ip
```

**Issue:**
- Assumes `req.headers['x-forwarded-for']` is always a string (it could be an array in Express)
- The `|| req.ip` fallback doesn't guarantee a string return

**Recommendation:**
```typescript
keyGenerator: (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return ip && typeof ip === 'string' ? ip.trim() : (req.ip || 'unknown');
}
```

---

### 8. **Missing Import Type Safety**

**Issue:**
- No TypeScript types for the express-rate-limit configuration
- No validation of handler parameters

**Recommendation:**
```typescript
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit'

export const apiLimiter: RateLimitRequestHandler = rateLimit({
  // ...
})
```

---

### 9. **No Store Configuration**

**Location:** Lines 6-20

**Issue:**
- Using default in-memory store for rate limiting
- In production with multiple server instances, each server will have its own rate limit counter
- Requests distributed across servers will bypass limits
- Memory will leak if the app restarts frequently

**Recommendations:**
1. Use Redis for distributed rate limiting: `npm install rate-limit-redis`
2. Implement persistent storage for multi-instance deployments
3. Document the store requirement in code comments

**Example Fix:**
```typescript
import RedisStore from 'rate-limit-redis';
import redis from 'redis';

const client = redis.createClient();

export const apiLimiter = rateLimit({
  store: new RedisStore({
    client: client,
    prefix: 'rate-limit:'
  }),
  windowMs: 60 * 1000,
  max: 100,
  // ...
})
```

---

## Missing Configuration

### 10. **No Configuration Management**

**Issue:**
- Rate limits are hardcoded
- Can't adjust limits without redeploying
- No feature flags for gradual rollout

**Recommendations:**
```typescript
const config = {
  api: {
    windowMs: parseInt(process.env.API_RATE_WINDOW || '60000'),
    max: parseInt(process.env.API_RATE_MAX || '100'),
  },
  auth: {
    windowMs: parseInt(process.env.AUTH_RATE_WINDOW || '900000'),
    max: parseInt(process.env.AUTH_RATE_MAX || '20'),
  }
};
```

---

### 11. **No Skip Conditions for Health Checks**

**Issue:**
- Health check endpoints might get rate limited if they come from same IP
- Load balancers might trigger false alarms

**Recommendations:**
```typescript
skip: (req) =>
  req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN ||
  req.path === '/health' ||
  req.path === '/healthz'
```

---

## Testing & Deployment Concerns

### 12. **No Error Handling Documentation**

**Issue:**
- Unclear how clients should handle 429 responses
- No retry guidance (should they use exponential backoff?)
- Missing Retry-After header

**Recommendations:**
```typescript
handler: (req, res) => {
  res.set('Retry-After', '60'); // Tell clients when to retry
  res.status(429).json({
    error: 'too many requests',
    retryAfter: 60
  })
}
```

---

### 13. **Performance Considerations**

**Issue:**
- `keyGenerator` function is called for every request
- `x-forwarded-for` parsing could be expensive in high-traffic scenarios
- No caching of key generation logic

**Recommendations:**
- Profile the keyGenerator performance under load
- Consider pre-processing proxy headers
- Benchmark against alternative approaches

---

## Deployment Checklist

Before merging, ensure:

- [ ] Remove hardcoded token from code
- [ ] Configure environment variables for all secrets
- [ ] Set up Redis for distributed rate limiting
- [ ] Add logging/metrics integration
- [ ] Document rate limiting strategy in architecture docs
- [ ] Update API documentation with rate limit headers
- [ ] Test rate limit behavior under load
- [ ] Implement gradual rollout with feature flags
- [ ] Set up monitoring/alerting for rate limit triggers
- [ ] Review and rotate any exposed secrets in git history
- [ ] Test with multiple server instances
- [ ] Validate proxy IP configuration in all environments

---

## Summary of Required Changes (By Priority)

| Priority | Issue | Action |
|----------|-------|--------|
| CRITICAL | Hardcoded token 'secret123' | Move to env var, rotate immediately |
| HIGH | X-Forwarded-For spoofing risk | Implement trusted proxy validation |
| HIGH | Email-based key collision | Use IP-based keying for auth |
| MEDIUM | No distributed store (Redis) | Add Redis for multi-instance support |
| MEDIUM | Missing logging/metrics | Implement request logging |
| MEDIUM | No type safety improvements | Add explicit types |
| LOW | Missing Retry-After header | Add to 429 responses |
| LOW | Hardcoded config values | Externalize to environment |

---

## Conclusion

**RECOMMENDATION: DO NOT MERGE** until critical and high-priority issues are addressed. The hardcoded token and unsafe key generation are exploitable security vulnerabilities. This code requires significant refactoring for production safety.

Consider this a foundational approach that needs security hardening and operational improvements before deployment.
