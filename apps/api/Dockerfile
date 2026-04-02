FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ─── DEPENDENCIES ────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/types/package.json packages/types/
COPY apps/api/package.json apps/api/
RUN pnpm install --no-frozen-lockfile

# ─── BUILD ───────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
# Copy the full pnpm virtual store + per-package node_modules symlink trees
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/types/ packages/types/
COPY apps/api/ apps/api/
RUN pnpm --filter @worldpulse/types build
RUN pnpm --filter @worldpulse/api build || true
# Create a self-contained deployment: resolves workspace symlinks into real copies
RUN pnpm deploy --filter @worldpulse/api --prod /prod/api

# ─── PRODUCTION IMAGE ────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 worldpulse

# Bust the dist cache on every deploy (deploy.sh passes --build-arg BUILD_TIME=<timestamp>)
ARG BUILD_TIME
RUN echo "Build: $BUILD_TIME"
COPY --from=builder --chown=worldpulse:nodejs /prod/api/dist ./dist
COPY --from=builder --chown=worldpulse:nodejs /prod/api/node_modules ./node_modules
COPY --from=builder --chown=worldpulse:nodejs /prod/api/package.json .
RUN mkdir -p /app/uploads/post-media && chown -R worldpulse:nodejs /app/uploads

USER worldpulse
EXPOSE 3001
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/index.js"]
