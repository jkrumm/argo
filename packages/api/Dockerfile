FROM oven/bun:1.3-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/api/package.json ./packages/api/
RUN bun install --production --ignore-scripts

COPY packages/api/src ./packages/api/src
COPY packages/api/tsconfig.json ./packages/api/
COPY packages/api/drizzle.config.ts ./packages/api/

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl ca-certificates \
  && addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules /app/node_modules
COPY --from=builder --chown=app:app /app/packages/api /app/packages/api
COPY --from=builder --chown=app:app /app/package.json /app/package.json

# Drizzle SQLite path (mounted by compose at /app/data)
RUN mkdir -p /app/data && chown app:app /app/data

ENV NODE_ENV=production
EXPOSE 4000

USER app

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:4000/health || exit 1

CMD ["bun", "run", "packages/api/src/index.ts"]
