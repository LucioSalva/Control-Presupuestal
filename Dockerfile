# syntax=docker/dockerfile:1.7

# ================================================================
#  CONTROL PRESUPUESTAL — Dockerfile (multi-stage)
# ================================================================
#  Build context: project root (./)
#  Source code:   ./server
#
#  Stages:
#    1) deps    -> install ALL dependencies (incl. dev) for build
#    2) build   -> run obfuscation (build.js) producing public/dist
#    3) prod-deps -> install only production dependencies
#    4) runtime -> minimal image, non-root, tini, healthcheck
# ================================================================

ARG NODE_VERSION=20.18.1-alpine3.20

# -----------------------------------------------------------------
# 1) deps — install full dependency tree (dev + prod) for build
# -----------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Only copy manifests first to maximise layer cache
COPY server/package.json server/package-lock.json ./

# Reproducible install; keep dev deps because build.js needs
# javascript-obfuscator (it lives in devDependencies).
RUN npm ci --no-audit --no-fund


# -----------------------------------------------------------------
# 2) build — run frontend obfuscation (public/js -> public/dist/js)
# -----------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Reuse node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Bring the actual source. .dockerignore strips node_modules,
# .env, uploads, logs, etc.
COPY server/ ./

# Generate obfuscated bundles into public/dist/js
RUN node build.js


# -----------------------------------------------------------------
# 3) prod-deps — production-only node_modules
# -----------------------------------------------------------------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force


# -----------------------------------------------------------------
# 4) runtime — final minimal image
# -----------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# tini = correct PID 1, propagates SIGTERM/SIGINT to Node
# wget = used by HEALTHCHECK to hit /api/health
RUN apk add --no-cache tini wget

ENV NODE_ENV=production \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

# Production node_modules (no devDependencies)
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# Application code + obfuscated dist
COPY --from=build --chown=node:node /app ./

# Override the dev node_modules that came in from the build stage
# with the production-only ones (last COPY wins).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# Runtime-writable paths (uploads will be backed by a named volume
# in docker-compose). Created here so the dir exists with correct
# ownership even if the volume is empty.
RUN mkdir -p /app/uploads/oficios \
 && chown -R node:node /app/uploads

# Drop privileges
USER node

EXPOSE 3000

# Healthcheck against the existing /api/health endpoint (public,
# no auth required).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null --tries=1 --timeout=4 http://127.0.0.1:3000/api/health || exit 1

# tini as PID 1 -> clean signal handling and zombie reaping.
# We invoke node directly (not `npm start`) to avoid an extra
# process layer and to skip the `prestart` build step at runtime
# (build was already done in the build stage).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
