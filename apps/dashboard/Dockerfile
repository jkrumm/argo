# Stage 1: Build
FROM oven/bun:1.3-alpine AS build
WORKDIR /app

ARG VITE_API_URL=https://argo.jkrumm.com/api
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_HYPERDX_ENDPOINT
ENV VITE_HYPERDX_ENDPOINT=$VITE_HYPERDX_ENDPOINT

ARG VITE_HYPERDX_API_KEY
ENV VITE_HYPERDX_API_KEY=$VITE_HYPERDX_API_KEY

ARG VITE_HYPERDX_SERVICE_NAME=argo-dashboard
ENV VITE_HYPERDX_SERVICE_NAME=$VITE_HYPERDX_SERVICE_NAME

COPY package.json bun.lock ./
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/api/package.json ./apps/api/
COPY packages/charts/package.json ./packages/charts/

RUN bun install

# API src needed for @argo/api type resolution (type-only, stripped at build)
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/tsconfig.json ./apps/api/
COPY tsconfig.base.json ./
COPY packages/charts/ ./packages/charts/
COPY apps/dashboard/ ./apps/dashboard/

WORKDIR /app/apps/dashboard
RUN bun run build

# Stage 2: Serve with nginx
FROM nginx:alpine

RUN apk add --no-cache curl

COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost/ || exit 1
