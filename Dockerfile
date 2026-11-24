# ==========================================
# Stage 1: Build TypeScript Application
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests first for Docker layer caching
COPY package*.json ./
RUN npm ci

# Copy source code and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ==========================================
# Stage 2: Production Runner
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package manifests and install ONLY production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JS and Drizzle migrations from Stage 1
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./

# Run as non-root user for container security
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]