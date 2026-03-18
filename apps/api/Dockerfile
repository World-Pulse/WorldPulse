FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ─── DEPENDENCIES ────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY packages/types/package.json packages/types/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# ─── BUILD ───────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY packages/types/ packages/types/
COPY apps/api/ apps/api/
RUN pnpm --filter @worldpulse/types build
RUN pnpm --filter @worldpulse/api build

# ─── PRODUCTION IMAGE ────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 worldpulse

COPY --from=builder --chown=worldpulse:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=worldpulse:nodejs /app/apps/api/package.json .
COPY --from=builder --chown=worldpulse:nodejs /app/node_modules ./node_modules

USER worldpulse
EXPOSE 3001
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
