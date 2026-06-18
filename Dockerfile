# ── Stage 1: Build ────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies for native modules (sqlite3, sharp)
RUN apk add --no-cache python3 make g++ vips-dev

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts && npm rebuild sqlite3 sharp

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc -p tsconfig.json && \
    mkdir -p dist/src/core/operator && \
    cp -r src/core/operator/public dist/src/core/operator/public

# ── Stage 2: Runtime ──────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Runtime dependencies for sharp and sqlite3
RUN apk add --no-cache vips

# Copy built output
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Install only production dependencies (no devDependencies, no TypeScript)
RUN npm ci --omit=dev --ignore-scripts && npm rebuild sharp sqlite3

# Copy supporting files
COPY characters/ ./characters/
COPY Permanent_Active_Directives.txt ./

# Default environment
ENV NODE_ENV=production \
    PRISM_MODE=server \
    PRISM_ENV_PROFILE=prod \
    PRISM_DASHBOARD_PORT=7070 \
    PRISM_WORKSPACE_ROOT=/data/Prism_Refraction

# Create workspace directory
RUN mkdir -p /data/Prism_Refraction

EXPOSE 7070

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:7070/health || exit 1

CMD ["node", "dist/src/index.js"]
