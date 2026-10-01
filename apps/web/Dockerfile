# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — web dashboard image (Next.js 16 standalone, served at /traffic).
#
# Build context = the REPO ROOT (docker-compose.yml: context ., dockerfile apps/web/Dockerfile):
#   docker build -f apps/web/Dockerfile -t nexus-traffic-web:local .
#
# Stages
#   deps     root + workspace manifests and the lockfile only → `npm ci` for shared, auth and web
#            (cached until a manifest or package-lock.json changes).
#   build    sources → build @nexus/shared + @nexus/auth (next.config.ts imports PUBLIC_BASE_PATH
#            from the shared dist) → `next build` (output 'standalone'; Turbopack compiles the
#            shared/auth TypeScript sources into the bundle).
#   runtime  node:22-alpine + tini, non-root user `nextjs`, ONLY the standalone server + assets.
#
# Runtime layout (outputFileTracingRoot = repo root, so the standalone tree mirrors the monorepo):
#   /app/apps/web/server.js            the Next server (CMD)
#   /app/apps/web/.next/static         hashed JS/CSS/fonts (copied separately: standalone omits them)
#   /app/apps/web/public               robots.txt
#   /app/node_modules                  only the traced runtime dependencies
#
# Secrets are NEVER baked in: LIBAS_JWT_SECRET & co. arrive at runtime from docker-compose.yml.
# NEXT_PUBLIC_SOCKET_PATH is a build ARG because Next inlines NEXT_PUBLIC_* at build time (S4).
#
# The package-lock.json must contain the Linux (musl) optional binaries (next swc, lightningcss,
# tailwind oxide). If `npm ci` fails here after a dependency change made on Windows, regenerate it:
#   docker run --rm -v "$PWD:/w" -w /w node:22-alpine npm install --package-lock-only --no-audit --no-fund
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_IMAGE=node:22-alpine

# ─── deps ────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include-workspace-root -w @nexus/shared -w @nexus/auth -w @nexus/web \
      --no-audit --no-fund

# ─── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
ARG NEXT_PUBLIC_SOCKET_PATH=/traffic/socket.io
ENV NEXT_PUBLIC_SOCKET_PATH=${NEXT_PUBLIC_SOCKET_PATH} \
    NEXT_TELEMETRY_DISABLED=1
# Sources (filtered by .dockerignore: no node_modules, dist, .next, .env).
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/auth packages/auth
COPY apps/web apps/web
RUN npm run build:shared \
 && npm run build -w @nexus/web \
 && test -f apps/web/.next/standalone/apps/web/server.js

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini \
 && addgroup -S nextjs \
 && adduser -S -G nextjs -h /app nextjs
ENV NODE_ENV=production \
    TZ=UTC \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nextjs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
# tini = PID 1: forwards SIGTERM to node (graceful shutdown) and reaps zombies.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
