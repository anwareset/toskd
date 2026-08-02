# syntax=docker/dockerfile:1

# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Cache pnpm store across builds (BuildKit required)
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- Stage 2: Runtime ----
FROM node:22-alpine AS runtime

WORKDIR /app

# Create non-root user early (single layer)
RUN addgroup -g 1001 -S app && adduser -S app -u 1001 -G app

# Copy only what's needed at runtime
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/

ENV NODE_ENV=production

EXPOSE 3000

# BuildKit required (enabled by default in Docker 23+).
# For older Docker: DOCKER_BUILDKIT=1 docker build ...
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode===200?0:1))"

USER app

CMD ["node", "src/server.js"]
