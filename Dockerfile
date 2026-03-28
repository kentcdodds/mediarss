# syntax=docker/dockerfile:1

FROM node:24-bookworm AS base
WORKDIR /app

# Install FFmpeg for metadata editing
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Install dependencies
FROM base AS install
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Final image
FROM base AS release
COPY --from=install /app/node_modules ./node_modules
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
CMD ["node", "--import", "./server/register-hooks.mjs", "index.ts"]
