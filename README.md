# MediaRSS

<div align="center">
  <h1 align="center">MediaRSS</h1>
  <strong align="center">
    An RSS feed generator for media (audio/video).
  </strong>
</div>

## Self-Hosting

### Prerequisites

- Docker
- A server or machine to host the application
- Basic understanding of Docker volumes for data persistence
- Media files organized in one or more directories on your host machine

### Synology NAS Setup

If you're running this on a Synology NAS, follow these specific instructions:

1. Install Docker from the Synology Package Center if you haven't already.

2. Create a shared folder for the database files:

   - Open Control Panel → Shared Folder
   - Create a new shared folder named `docker-data` (or your preferred name)
   - Inside this folder, create a directory called `mediarss`

3. Note your media locations:

   - Synology typically stores media files in `/volume1/[shared-folder-name]`
   - You can mount any number of media directories from your Synology

4. Open Docker in Synology DSM:

   - Go to "Registry" and search for the mediarss image
   - Download the image
   - Go to "Container" and launch using the image

5. When setting up the container in the Synology Docker UI:

   - In the "Advanced Settings" → "Volume" tab:
     - Add a volume mount for the database:
       - Mount path: `/data`
       - Local path: `/volume1/docker-data/mediarss`
     - Add your media volume mounts (add as many as you need):
       - Mount path: `/media/[your-name]` (e.g., `/media/shows`,
         `/media/personal`, etc.)
       - Local path: `/volume1/[your-folder]`
       - Check "Read-only"
   - In the "Port Settings" tab:

     - Local Port: 8765 (or your preferred port)
     - Container Port: 44100 (or whatever you set PORT to in the env settings)

   - In the "Environment" tab:
     - Add the standard environment variables as needed
     - For multiple media paths, specify them in MEDIA_PATHS:
       - Variable: MEDIA_PATHS
       - Value: /media/shows:/media/personal (colon-separated list of your mount
         points)

The rest of the standard instructions apply for managing the container.

### Quick Start (Non-Synology)

1. Pull the Docker image:

```bash
docker pull [your-image-name]
```

2. Create directories for persistent storage and ensure your media directories
   exist:

```bash
# Create directory for database storage
mkdir -p /path/to/your/data

# Your media directories should already exist
```

3. Run the container:

```bash
docker run -d \
  --name mediarss \
  -p 8765:8765 \
  -v /path/to/your/data:/data \
  -v /path/to/media1:/media/shows:ro \
  -v /path/to/media2:/media/personal:ro \
  -v /path/to/media3:/media/other:ro \
  -e MEDIA_PATHS=/media/shows:/media/personal:/media/other \
  [your-image-name]
```

Note: The `:ro` flag in the media volume mounts makes them read-only, which is
recommended for security.

### Volume Mounts

The application requires these volume mounts:

1. **Database Volume** (`/data`):

   - Purpose: Stores SQLite databases
   - Mount point: `/data`
   - Example: `-v /path/to/your/data:/data`

2. **Media Volumes** (any number allowed):
   - Purpose: Access to your media files
   - Mount point pattern: `/media/[your-name]`
   - Examples:
     - `-v /path/to/media1:/media/shows:ro`
     - `-v /path/to/media2:/media/personal:ro`
   - Should be mounted read-only (`:ro`)
   - Name the mount points anything that makes sense for your use case

### Media Directory Structure

You can organize your media directories however you prefer. Here's an example
structure:

```
/media/shows/
├── educational/
│   ├── course1/
│   └── course2/
└── entertainment/
    ├── show1/
    └── show2/

/media/personal/
├── family-videos/
└── recordings/

/media/other/
└── misc-media/
```

### Environment Variables

The following environment variables can be configured:

- `PORT`: External port (default: 8765)
- `DATABASE_PATH`: Path to the main SQLite database (default: /data/sqlite.db)
- `CACHE_DATABASE_PATH`: Path to the cache SQLite database (default:
  /data/cache.db)
- `MEDIA_PATHS`: Colon-separated list of media directories inside container
  (e.g., /media/shows:/media/personal)

### Database Persistence

The application uses SQLite for both the main database and cache storage. Both
databases are stored in the `/data` directory inside the container:

- Main database: `/data/sqlite.db`
- Cache database: `/data/cache.db`

To ensure your data persists between container restarts and updates, you
**must** mount a volume or bind mount to the `/data` directory as shown in the
run command above.

### Backup and Restore

To backup your databases, simply copy the files from your mounted data
directory. For example:

```bash
# Stop the container before backup
docker stop mediarss

# Backup the databases
cp /path/to/your/data/sqlite.db /path/to/backup/sqlite.db
cp /path/to/your/data/cache.db /path/to/backup/cache.db

# Restart the container
docker start mediarss
```

To restore from backup:

```bash
# Stop the container
docker stop mediarss

# Restore the databases
cp /path/to/backup/sqlite.db /path/to/your/data/sqlite.db
cp /path/to/backup/cache.db /path/to/your/data/cache.db

# Restart the container
docker start mediarss
```

### Upgrading

To upgrade to a new version:

```bash
# Pull the new image
docker pull [your-image-name]

# Stop the current container
docker stop mediarss

# Remove the old container
docker rm mediarss

# Run the new container (using the same data directory and media mount)
docker run -d \
  --name mediarss \
  -p 8765:8765 \
  -v /path/to/your/data:/data \
  -v /path/to/media1:/media/shows:ro \
  -v /path/to/media2:/media/personal:ro \
  -v /path/to/media3:/media/other:ro \
  -e MEDIA_PATHS=/media/shows:/media/personal:/media/other \
  [your-image-name]
```

Your data will be preserved as long as you use the same volume mount points.

## Alternatives

[Audiobookshelf](https://github.com/advplyr/audiobookshelf) is a fully featured
audio media server. It doesn't support private RSS feeds and it's a little too
much for what I want, so I built my own thing. But you might like it.
