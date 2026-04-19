# Code Review — Pre-Public Release Sweep

**Date:** 2026-04-16 (T-4 days to launch)
**Scope:** WorldPulse monorepo at `/opt/worldpulse`. Going public on GitHub Monday Apr 20.
**Method:** Static analysis by the Explore agent covering secrets, hygiene, and launch-blocking hygiene docs.

---

## CRITICAL: one immediate action required

**Rotate the live Stripe key today.** `apps/api/.env.prod` contains a live Stripe restricted key (`rk_live_...`) and webhook secret. The file is correctly gitignored and does **not** appear in git history. So it has never been publicly committed — this is not a "stop the press" public exposure.

But:
- The key has existed in a semi-shared location (local dev machine + production server file system).
- Once the repo is public, any mistake that accidentally commits `.env.prod` would immediately leak a live key. Rotation reduces the blast radius if that happens.
- Treat this as belt-and-suspenders hygiene: rotate now, document that the new key lives only in the server env (not in a committed file).

**Action steps (est. 15 min):**

1. Log into the Stripe dashboard → API keys → revoke `rk_live_51TGstQ5h85I1AGiU...`.
2. Generate a new restricted key with the same permissions.
3. Update `/opt/worldpulse/apps/api/.env.prod` on the prod server with the new value (do not commit).
4. Regenerate the webhook signing secret from Stripe → Developers → Webhooks → worldpulse endpoint → roll secret.
5. Redeploy API: `.\scripts\deploy-bg.ps1 -Service api`.
6. Verify with a test Stripe event that signatures validate.
7. Delete the old key material from the local `.env.prod` file and any password-manager/notes entries.

---

## Findings by category

### 1. Secrets & credentials

**Git history:** Clean. `git log --all --full-history -- "*.env*"` returns no `.env.prod` or `.env.local` commits. Only `.env.example` files are tracked (expected).

**`.gitignore`:** Correctly lists `.env`, `.env.local`, `.env.production`, `.env.prod`, `.env.*.local`, `.env.staging`.

**Local `.env.prod` contents (sensitive — never to be committed):**

| Key | Value shape | Action |
|---|---|---|
| `DATABASE_URL` | `postgresql://wp_user:wp_secret_local@...` | Low-risk (local-shape value on public IP). Rotate if prod-exposed. |
| `REDIS_URL` | `redis://:wp_redis_local@...` | Low-risk password. Rotate post-launch. |
| `MEILI_KEY` | `wp_meili_local_key` | Rotate post-launch. |
| `JWT_SECRET` | `wp_jwt_secret_local_change_in_prod` | **Rotate today** — signed tokens will be invalid but reissue on next login is acceptable pre-launch. |
| `STRIPE_SECRET_KEY` | `rk_live_51TGstQ5h85I1AGiU...` | **CRITICAL — rotate today (see above).** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_cGTo4vk6EAyl5344...` | **Rotate today (see above).** |
| `GRAFANA_PASSWORD` | `wp_grafana_admin_2026` | Rotate post-launch. |

**Source code secret grep:** No hardcoded API keys or tokens in `apps/api/src/`, `apps/web/src/`, `apps/scraper/src/`. Connection strings are pulled from env vars everywhere.

### 2. Pre-public hygiene

**TODO / FIXME / XXX / HACK:** **1** in application source (`apps/api/src/routes/wind.ts:137` — GRIB2 parsing, post-launch). Acceptable.

**`console.log` in source:** 16 instances, all in acceptable locations:
- `apps/api/src/db/migrate.ts:26,722` — migration startup logs. Keep.
- `apps/api/src/db/postgres.ts:49` — connection success log. Keep.
- `apps/api/src/db/redis.ts:34` — connection success log. Keep.
- `apps/api/src/scripts/geocode-signals.ts:105-174` — CLI utility script. Keep.
- `apps/api/src/scripts/security-check.ts:184-196` — CLI utility script. Keep.

No `console.log` in request-handling code paths. Clean.

**Commented-out code:** None found in application source.

**Personal file paths:** None in committed code.

**Commit message review (last 20 commits):** Professional. Format: `feat:`, `fix:`, `feat(infra):`, etc. No embarrassments.

**Placeholder text:** The only "placeholder" references are in STIX data structures (legitimate domain terminology). No Lorem Ipsum.

**Competitor name references:** None in source code.

**`|| true` error swallowing:**

- **`apps/api/Dockerfile:23` — `RUN pnpm --filter @worldpulse/api build || true`** — **Problem.** This is the documented tech debt that silently ships stale dist when TypeScript build fails. Tracked in `project_api_typescript_debt.md`. **Decision: do NOT fix before launch** (removing `|| true` would block the Docker build and we have ~100 TS errors to clean up first). Post-launch task for Apr 27+.
- `deploy.sh`, `nginx/certbot.sh`: `|| true` used on non-critical housekeeping steps. Acceptable.

### 3. Launch blockers

| File | Status | Action |
|---|---|---|
| `LICENSE` | ✅ Present (MIT, matches README badge) | None |
| `README.md` | ✅ Present, substantial | Proof-read Sunday |
| `CONTRIBUTING.md` | ✅ Present, non-empty | None |
| `CODE_OF_CONDUCT.md` | ❌ **Missing at root** (inline in CONTRIBUTING) | **Add by Sunday** — GitHub's Community Standards looks for root-level CoC |
| `SECURITY.md` | ❌ **Missing at root** (only `security/AUDIT.md`) | **Add by Sunday** — responsible disclosure channel |
| `.env files in .gitignore` | ✅ Correct | None |
| HTTP public-write endpoints | ✅ All properly authenticated or IP-rate-limited | None |
| Rate limiting on public endpoints | ✅ Global + per-route; Redis-backed, Cloudflare-aware | None |

**Authentication posture on write endpoints:**
- All `POST` routes use `preHandler: [authenticate]` or `[optionalAuth]`.
- `POST /signals/:id/flag` uses `optionalAuth` + custom IP-based rate limit — acceptable public endpoint.
- No unauthenticated bulk-write endpoints.

---

## Ship-today priority list

In order:

### P0 — do today

1. **Rotate Stripe live key + webhook secret.** (see "CRITICAL" section above) — ~15 min.
2. **Rotate `JWT_SECRET` in prod.** `.env.prod` still has the placeholder-named `wp_jwt_secret_local_change_in_prod`. Replace with a real 64+ char random value; redeploy API; users will need to re-login once. Acceptable during soft launch (zero users today). — ~5 min.

### P1 — by Sunday

3. **Add `SECURITY.md`** at repo root. Responsible-disclosure policy pointing to a security@ alias or GitHub security advisory. One page. — ~15 min.
4. **Add `CODE_OF_CONDUCT.md`** at repo root. Copy the Contributor Covenant or the snippet already in CONTRIBUTING.md. — ~5 min.
5. **Rotate Postgres password in prod.** Low risk but the current value is memorable (documented in memory as `wp_postgres_local`). Before repo goes public, swap to a stronger random value and update app env. — ~30 min.
6. **Rotate Redis password and Meilisearch master key** in prod on the same swap. — ~20 min.

### P2 — post-launch (week of Apr 27)

7. **Remove `|| true` from `apps/api/Dockerfile:23`.** Depends on cleaning up ~100 TypeScript errors first. Tracked in `project_api_typescript_debt.md`.
8. **Implement GRIB2 parsing** for `apps/api/src/routes/wind.ts` or explicitly mark the route as v1.1.
9. **Add `.github/ISSUE_TEMPLATE/`** — bug report + feature request templates. Raises the quality of incoming issues once the repo is public.
10. **Add `.github/PULL_REQUEST_TEMPLATE.md`** — checklist for PR submitters.
11. **Wire Sentry alerts** on 5xx error rate > 1% over 5 min. Manual log review is acceptable for launch week only.

---

## Pre-launch go/no-go checklist

Ticked when green. Block launch if any P0 or P1 is red by Sunday.

```
[ ] P0: Stripe live key rotated + verified
[ ] P0: JWT secret rotated + verified
[ ] P1: SECURITY.md added
[ ] P1: CODE_OF_CONDUCT.md added
[ ] P1: Postgres password rotated
[ ] P1: Redis + Meilisearch passwords rotated
[ ] Go-live check: repo ready to go public
[ ] Go-live check: new `.env.prod` backed up securely (password manager, not in the repo)
```

---

## Two things I'd recommend but didn't flag as blockers

**Docs on sensitive env vars.** Add a comment block at the top of `apps/api/.env.example` that explicitly lists which vars are secrets and how to rotate them. Future contributors will thank you.

**Dependabot or similar.** Once the repo is public, enable GitHub Dependabot for weekly dependency security updates. Takes 2 minutes. Prevents one class of "you had a known CVE for 4 months" headlines.

---

## Post-sweep summary

Ninety-five percent of the repo is clean for public release. The Stripe live key in `.env.prod` is the one ship-today item. The two missing root-level hygiene docs (`SECURITY.md`, `CODE_OF_CONDUCT.md`) are ship-by-Sunday items. Everything else is manageable post-launch.

Source references used:
- Explore agent findings (Apr 16 sweep)
- `project_api_typescript_debt.md`
- `.gitignore` (`worldpulse/.gitignore:13-18`)
- `apps/api/Dockerfile:23`
- `apps/api/src/routes/wind.ts:137`
