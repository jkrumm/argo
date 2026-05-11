FROM oven/bun:1.3-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY packages/dashboard/package.json ./packages/dashboard/
RUN bun install --production --ignore-scripts --filter @argo/api

COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/drizzle.config.ts ./apps/api/

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl ca-certificates \
  && addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules /app/node_modules
COPY --from=builder --chown=app:app /app/apps/api /app/apps/api
COPY --from=builder --chown=app:app /app/package.json /app/package.json

RUN mkdir -p /app/data && chown app:app /app/data

ENV NODE_ENV=production
EXPOSE 4000

USER app

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:4000/health || exit 1

CMD ["bun", "run", "apps/api/src/index.ts"]
