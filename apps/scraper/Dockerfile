FROM node:20-alpine AS base
RUN npm install -g pnpm@9

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/types/package.json packages/types/
COPY apps/scraper/package.json apps/scraper/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY packages/types/ packages/types/
COPY apps/scraper/ apps/scraper/
RUN pnpm --filter @worldpulse/types build
RUN pnpm --filter @worldpulse/scraper build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 scraper
COPY --from=builder --chown=scraper:nodejs /app/apps/scraper/dist ./dist
COPY --from=builder --chown=scraper:nodejs /app/node_modules ./node_modules
COPY --from=builder /app/apps/scraper/package.json .
USER scraper
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
