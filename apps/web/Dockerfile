FROM node:20-alpine AS base
RUN npm install -g pnpm@9

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
RUN pnpm install --no-frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY packages/ packages/
COPY apps/web/ apps/web/
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* vars must be available at build time — Next.js inlines them
# into the JS bundle during `next build`. Runtime env vars are too late.
ARG NEXT_PUBLIC_API_URL=https://api.world-pulse.io
ARG NEXT_PUBLIC_WS_URL=wss://api.world-pulse.io
ARG NEXT_PUBLIC_MEILI_HOST=https://api.world-pulse.io/search
ARG NEXT_PUBLIC_MEILI_KEY
ARG NEXT_PUBLIC_VAPID_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_MEILI_HOST=$NEXT_PUBLIC_MEILI_HOST
ENV NEXT_PUBLIC_MEILI_KEY=$NEXT_PUBLIC_MEILI_KEY
ENV NEXT_PUBLIC_VAPID_KEY=$NEXT_PUBLIC_VAPID_KEY

RUN pnpm --filter @worldpulse/types build
RUN pnpm --filter @worldpulse/web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
