# Stage 1: Build
FROM oven/bun:1.3-alpine AS build
WORKDIR /app

ARG VITE_API_URL=https://argo.jkrumm.com/api
ENV VITE_API_URL=$VITE_API_URL

COPY package.json bun.lock ./
COPY packages/dashboard/package.json ./packages/dashboard/
COPY apps/api/package.json ./apps/api/

RUN bun install

# API src needed for @argo/api type resolution (type-only, stripped at build)
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/tsconfig.json ./apps/api/
COPY packages/dashboard/ ./packages/dashboard/

WORKDIR /app/packages/dashboard
RUN bun run build

# Stage 2: Serve with nginx
FROM nginx:alpine

RUN apk add --no-cache curl

COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost/ || exit 1
