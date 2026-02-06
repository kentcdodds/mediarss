# syntax=docker/dockerfile:1

FROM oven/bun:1 AS base
WORKDIR /app

# Install FFmpeg for metadata editing
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Install dependencies (includes dev deps for patch-package)
FROM base AS install
COPY package.json bun.lock ./
COPY patches/ ./patches/
RUN bun install --frozen-lockfile

# Production-only dependencies
FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Final image
FROM base AS release
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=install /app/node_modules/@remix-run/component ./node_modules/@remix-run/component
COPY . .

# Create data directory for SQLite databases
RUN mkdir -p /data

# Default environment variables
ENV NODE_ENV=production
ENV PORT=22050
ENV DATABASE_PATH=/data/sqlite.db
ENV CACHE_DATABASE_PATH=/data/cache.db

# Expose the default port (22050 = audiobook sample rate 🎧)
EXPOSE 22050

# Run the application
CMD ["bun", "run", "start"]
