# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — api image (also runs the one-shot `migrate` service).
#
# Build context = the REPO ROOT (docker-compose.yml: context ., dockerfile apps/api/Dockerfile):
#   docker build -f apps/api/Dockerfile -t nexus-traffic-api:local .
#
# Stages
#   deps       root + workspace manifests and the lockfile only → `npm ci` (cached until a manifest
#              or package-lock.json changes). Lists the CURRENT workspaces explicitly; when a new
#              workspace the api depends on is added (packages/node, …), add its package.json here.
#   build      all sources → build @nexus/shared + @nexus/auth → tsc the api (tsconfig.build.json)
#              → render the public integration guide into docs/dist.
#   prod-deps  production node_modules only (no tsx/vitest/typescript), same workspace layout.
#   runtime    node:22-alpine + tini, non-root user `app`, only what the server needs at runtime.
#
# Runtime layout (npm workspace symlinks node_modules/@nexus/* → ../../packages/* stay valid):
#   /app/node_modules                 production dependencies (+ @nexus/* symlinks)
#   /app/packages/{shared,auth}       package.json + dist
#   /app/apps/api                     package.json + dist + migrations   (WORKDIR)
#   /app/docs/dist                    the built guide (config default docsDir resolves here)
#
# The package-lock.json must contain the Linux (musl) optional binaries. If `npm ci` fails here
# after a dependency change made on Windows, regenerate the lockfile inside Alpine:
#   docker run --rm -v "$PWD:/w" -w /w node:22-alpine npm install --package-lock-only --no-audit --no-fund
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_IMAGE=node:22-alpine

# ─── deps ────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include-workspace-root -w @nexus/shared -w @nexus/auth -w @nexus/api \
      --no-audit --no-fund

# ─── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
# Sources (filtered by .dockerignore: no node_modules, dist, .env, docs/dist, ai-context).
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/auth packages/auth
COPY apps/api apps/api
COPY scripts scripts
COPY docs docs
RUN npm run build:shared \
 && npm run build -w @nexus/api \
 && npm run docs:build \
 && test -f apps/api/dist/server.js \
 && test -f docs/dist/index.html

# ─── prod-deps ───────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --include-workspace-root -w @nexus/api -w @nexus/shared -w @nexus/auth \
      --no-audit --no-fund

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini \
 && addgroup -S app \
 && adduser -S -G app -h /app app
ENV NODE_ENV=production \
    TZ=UTC \
    PORT=4000
WORKDIR /app

COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=prod-deps --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=app:app /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=app:app /app/packages/auth/package.json ./packages/auth/package.json
COPY --from=build --chown=app:app /app/packages/auth/dist ./packages/auth/dist
COPY --from=build --chown=app:app /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /app/apps/api/migrations ./apps/api/migrations
COPY --from=build --chown=app:app /app/docs/dist ./docs/dist

WORKDIR /app/apps/api
USER app
EXPOSE 4000
# tini = PID 1: forwards SIGTERM to node (graceful shutdown) and reaps zombies.
ENTRYPOINT ["/sbin/tini", "--"]
# The migrate service overrides this with: node dist/db/migrate.js
CMD ["node", "dist/server.js"]
