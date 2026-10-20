FROM node:24-alpine AS base
RUN npm install -g pnpm@9

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/types/package.json packages/types/
COPY apps/scraper/package.json apps/scraper/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/apps/scraper/node_modules ./apps/scraper/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/types/ packages/types/
COPY apps/scraper/ apps/scraper/
RUN pnpm --filter @worldpulse/types build
RUN pnpm --filter @worldpulse/scraper build || true
RUN pnpm deploy --filter @worldpulse/scraper --prod /prod/scraper

FROM node:24-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 scraper
# The in-house fingerprint model is kept here (a volume shared with the API;
# the volume takes this folder's owner when it is first created)
RUN mkdir -p /app/models && chown scraper:nodejs /app/models
ARG BUILD_TIME
RUN echo "Build: $BUILD_TIME"
COPY --from=builder --chown=scraper:nodejs /prod/scraper/dist ./dist
COPY --from=builder --chown=scraper:nodejs /prod/scraper/node_modules ./node_modules
COPY --from=builder --chown=scraper:nodejs /prod/scraper/package.json .
USER scraper
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
