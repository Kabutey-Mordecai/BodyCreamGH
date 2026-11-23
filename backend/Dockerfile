# =============================================================================
# backend/Dockerfile — Production image (multi-stage build)
#
# Stage 1 (deps): installs only production npm dependencies
# Stage 2 (runner): copies deps + source into a minimal Alpine image
#
# The two-stage approach keeps the final image lean by leaving behind
# the npm cache and any build-only tooling.
#
# Build:
#   docker build -t cosmetics-api ./backend
#
# Run (standalone, expects a running PostgreSQL elsewhere):
#   docker run --env-file .env -p 3000:3000 cosmetics-api
# =============================================================================

# ── Stage 1: install production dependencies ──────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Copy manifests first so Docker caches this layer and only re-runs
# npm ci when package.json / package-lock.json actually change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev   # skip devDependencies (nodemon etc.)

# ── Stage 2: production runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Run as a non-root user — container breakout damage is contained if something
# goes wrong.  UID 1001 avoids conflicts with common system UIDs.
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy pre-installed deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (respects .dockerignore)
COPY --chown=nodejs:nodejs . .

# Pre-create writable runtime directories for logs and uploads
RUN mkdir -p /app/logs /app/uploads/products /app/uploads/media && chown -R nodejs:nodejs /app/logs /app/uploads

USER nodejs

# Document the port the app listens on (still needs -p 3000:3000 at runtime)
EXPOSE 3000

# Health check so Docker / Compose knows when the container is ready.
# Waits 15s before the first check to give pg-boss time to start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD sh -c 'wget -qO- "http://localhost:${PORT:-3000}/api/health" || exit 1'

CMD ["node", "src/server.js"]
