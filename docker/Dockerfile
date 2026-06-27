# ─── Builder ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/proxy/package.json ./apps/proxy/

# Install deps
RUN npm install --workspaces --include-workspace-root

# Copy source files
COPY tsconfig.base.json ./
COPY providers.yaml ./
COPY packages/core/ ./packages/core/
COPY apps/proxy/ ./apps/proxy/

# Build core and proxy
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=apps/proxy

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy only built artifacts
COPY --from=builder /app/providers.yaml ./
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/apps/proxy/dist ./apps/proxy/dist
COPY --from=builder /app/apps/proxy/package.json ./apps/proxy/
COPY --from=builder /app/node_modules ./node_modules

# Non-root user for security
RUN addgroup -S vaultedge && adduser -S vaultedge -G vaultedge
USER vaultedge

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1

CMD ["node", "apps/proxy/dist/server.js"]
