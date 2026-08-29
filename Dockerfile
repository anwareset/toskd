# syntax=docker/dockerfile:1

# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@next-12 --activate

WORKDIR /app

# Cache pnpm store across builds (BuildKit required)
# pnpm-workspace.yaml ikut di-copy: memuat allowBuilds protobufjs (dibutuhkan
# pnpm 10+/12; pnpm 9 mengabaikannya — single-package workspace).
# pnpm 12 di-install dari tag next-12 (latest npm masih menunjuk pnpm 11).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- Stage 2: Runtime ----
FROM node:22-alpine AS runtime

WORKDIR /app

# tini: lightweight init used as PID 1. It forwards SIGINT/SIGTERM to node
# and reaps zombie processes, so Ctrl+C (`docker run -it`) and `docker stop`
# work out of the box — no need for `docker run --init`.
# Merged with non-root user creation into ONE layer (both run as root before
# `USER app`) to keep the image lean.
RUN apk add --no-cache tini \
    && addgroup -g 1001 -S app \
    && adduser -S app -u 1001 -G app

# Copy only what's needed at runtime
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/

ENV NODE_ENV=production

# Release metadata untuk endpoint /health. APP_VERSION berasal dari
# canonical stable SemVer git tag; GIT_COMMIT_SHA berasal dari commit tag.
# Keduanya di-inject oleh release workflow dan fallback hanya untuk local build.
ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION
ARG GIT_SHA=unknown
ENV GIT_COMMIT_SHA=$GIT_SHA

EXPOSE 3000

# BuildKit required (enabled by default in Docker 23+).
# For older Docker: DOCKER_BUILDKIT=1 docker build ...
# Healthcheck memakai /health (bukan /) — baru "healthy" jika server + DB
# benar-benar siap (200), bukan sekadar HTTP up (root selalu 200 walau DB mati).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1))"

USER app

# tini as PID 1; node runs as its child (signals are forwarded to it).
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "src/server.js"]
