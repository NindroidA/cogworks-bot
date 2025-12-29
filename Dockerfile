# Stage 1: Builder
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install all dependencies (including dev for building)
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN bun run build

# Stage 2: Production
FROM oven/bun:1-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S cogworks -u 1001 -G nodejs

# Copy package files
COPY package.json bun.lock ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production && \
    rm -rf /root/.bun/install/cache

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy public assets if they exist
COPY --chown=cogworks:nodejs public/ ./public/

# Set ownership
RUN chown -R cogworks:nodejs /app

# Switch to non-root user
USER cogworks

# Environment variables
ENV NODE_ENV=production
ENV RELEASE=prod
ENV HEALTH_PORT=3000

# Expose health check port
EXPOSE 3000

# Health check using existing endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${HEALTH_PORT}/health/live || exit 1

# Start the bot
CMD ["bun", "run", "./dist/src/index.js"]
