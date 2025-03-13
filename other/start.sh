#!/bin/sh
set -e

# Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy

# Set the journal mode to WAL for better concurrency
echo "Setting journal mode to WAL for main database..."
sqlite3 $DATABASE_PATH "PRAGMA journal_mode = WAL;"

# Set the journal mode to WAL for cache database
echo "Setting journal mode to WAL for cache database..."
sqlite3 $CACHE_DATABASE_PATH "PRAGMA journal_mode = WAL;"

# Generate Prisma types
echo "Generating Prisma types..."
npx prisma generate --sql

# Start the application
echo "Starting the application..."
exec npm start 