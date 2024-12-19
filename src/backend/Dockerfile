# -----------------------------
# Stage 1: Builder
# -----------------------------
FROM node:18-alpine AS builder

# Install build essentials and security updates
RUN apk update && \
    apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files with proper ownership
COPY --chown=node:node package*.json ./

# Install production dependencies with exact versions
RUN npm ci --only=production

# Copy source code and config files
COPY --chown=node:node . .

# Set proper file permissions
RUN chmod -R 755 /usr/src/app

# Build TypeScript code with optimizations
RUN npm run build

# Prune development dependencies
RUN npm prune --production

# Remove build tools and clean cache
RUN apk del python3 make g++ && \
    npm cache clean --force

# -----------------------------
# Stage 2: Development
# -----------------------------
FROM node:18-alpine AS development

# Install development tools and security updates
RUN apk update && \
    apk add --no-cache \
    python3 \
    make \
    g++ \
    wget \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files with proper ownership
COPY --chown=node:node package*.json ./

# Install all dependencies including devDependencies
RUN npm install

# Copy source code and config files
COPY --chown=node:node . .

# Set development environment variables
ENV NODE_ENV=development
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV TZ=UTC

# Configure TypeScript watch mode
RUN npm install -g nodemon ts-node

# Expose ports for app and debugging
EXPOSE 3000 9229

# Setup nodemon for hot-reloading
CMD ["npm", "run", "dev"]

# -----------------------------
# Stage 3: Production
# -----------------------------
FROM node:18-alpine AS production

# Create non-root user
RUN addgroup -g 1001 nodejs && \
    adduser -u 1001 -G nodejs -s /bin/sh -D nodejs

# Install runtime dependencies and security updates
RUN apk update && \
    apk add --no-cache \
    wget \
    tzdata \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /usr/src/app

# Copy built artifacts from builder stage
COPY --from=builder --chown=nodejs:nodejs /usr/src/app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /usr/src/app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /usr/src/app/package*.json ./

# Set secure file permissions
RUN chmod -R 755 /usr/src/app && \
    chown -R nodejs:nodejs /usr/src/app

# Configure production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV TZ=UTC

# Setup health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Enable production optimizations
ENV NODE_ENV=production

# Remove unnecessary tools and switch to non-root user
USER nodejs

# Expose application port
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]