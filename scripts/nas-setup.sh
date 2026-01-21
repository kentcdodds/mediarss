#!/bin/bash
#
# MediaRSS NAS Setup Script
# =========================
#
# This script pulls the latest MediaRSS Docker image and starts the container.
# Copy this script to your NAS and modify the configuration below before running.
#
# Usage:
#   1. Copy this script to your NAS
#   2. Edit the CONFIGURATION section below
#   3. Make it executable: chmod +x nas-setup.sh
#   4. Run it: ./nas-setup.sh
#

set -e  # Exit on any error

###############################################################################
# HELPER FUNCTIONS
###############################################################################

# Get the NAS IP address (tries multiple methods for compatibility)
get_local_ip() {
    # Method 1: hostname -I (most Linux systems including Synology DSM 7+)
    local ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    
    # Method 2: ip route (fallback)
    if [[ -z "$ip" ]]; then
        ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+')
    fi
    
    # Method 3: ifconfig (older systems)
    if [[ -z "$ip" ]]; then
        ip=$(ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1 | awk '{print $2}' | sed 's/addr://')
    fi
    
    echo "${ip:-YOUR_NAS_IP}"
}

###############################################################################
# CONFIGURATION - MODIFY THESE VALUES FOR YOUR SETUP
###############################################################################

# Docker image name (this is the public image from Docker Hub)
IMAGE_NAME="kentcdodds/mediarss"

# Container name
CONTAINER_NAME="mediarss"

# Port mapping: HOST_PORT:CONTAINER_PORT
# 22050 = Standard audiobook sample rate (22.05 kHz) 🎧
# You shouldn't have to change these, but if you need to, you can.
HOST_PORT="22050"
CONTAINER_PORT="22050"

# Path on your NAS where MediaRSS will store its database files
# This MUST be persistent storage (not inside the container)
# Examples:
#   Synology: /volume1/docker/mediarss
#   QNAP: /share/Container/mediarss
#   Generic: /srv/mediarss/data
DATA_PATH="/volume1/docker/mediarss"

# Media directories to mount (add as many as you need)
# Format: "HOST_PATH:CONTAINER_PATH:NAME"
#   - HOST_PATH: The path on your NAS where your media files are
#   - CONTAINER_PATH: Where to mount it inside the container (use /media/something)
#   - NAME: A unique name for this media path (used in URLs, no spaces)
#
# Examples for different NAS systems:
#   Synology: "/volume1/media/audiobooks:/media/audiobooks:audiobooks"
#   QNAP: "/share/Multimedia/Audiobooks:/media/audiobooks:audiobooks"
#   Generic: "/srv/media/audiobooks:/media/audiobooks:audiobooks"
#
# Add your media paths here (one per line):
MEDIA_MOUNTS=(
    # Add media directories below:
    # "/path/to/your/media:/media/your-name:your-name"

		# DELETE THE EXAMPLES BELOW
		# For example:
    "/volume1/media/audiobooks:/media/audiobooks:audiobooks"
		# This is:
		# - Host path: /volume1/media/audiobooks
		# - Container path: /media/audiobooks
		# - Name: audiobooks

    "/volume1/media/audio-series:/media/audio-series:audio-series"
		# This is:
		# - Host path: /volume1/media/audio-series
		# - Container path: /media/audio-series
		# - Name: audio-series
)

###############################################################################
# END OF CONFIGURATION - You shouldn't need to modify below this line
###############################################################################

echo "🎵 MediaRSS Setup Script"
echo "========================"
echo ""

# Build volume arguments and MEDIA_PATHS environment variable
# Mount /data for database and /app/data/artwork for uploaded artwork
VOLUME_ARGS="-v ${DATA_PATH}:/data -v ${DATA_PATH}/artwork:/app/data/artwork"
MEDIA_PATHS=""

for mount in "${MEDIA_MOUNTS[@]}"; do
    # Skip empty lines and comments
    [[ -z "$mount" || "$mount" =~ ^# ]] && continue
    
    # Parse the mount string
    IFS=':' read -r host_path container_path name <<< "$mount"
    
    if [[ -z "$host_path" || -z "$container_path" || -z "$name" ]]; then
        echo "⚠️  Invalid mount format: $mount"
        echo "   Expected format: HOST_PATH:CONTAINER_PATH:NAME"
        continue
    fi
    
    # Add to volume arguments (read-only for media)
    VOLUME_ARGS="${VOLUME_ARGS} -v ${host_path}:${container_path}:ro"
    
    # Build MEDIA_PATHS string
    if [[ -n "$MEDIA_PATHS" ]]; then
        MEDIA_PATHS="${MEDIA_PATHS},"
    fi
    MEDIA_PATHS="${MEDIA_PATHS}${name}:${container_path}"
    
    echo "📁 Media mount: ${name} -> ${host_path}"
done

if [[ -z "$MEDIA_PATHS" ]]; then
    echo "❌ Error: No media paths configured!"
    echo "   Please edit the MEDIA_MOUNTS array in this script."
    exit 1
fi

echo ""
echo "📦 Pulling latest image: ${IMAGE_NAME}"
docker pull "${IMAGE_NAME}"

echo ""
echo "🛑 Stopping existing container (if any)..."
docker stop "${CONTAINER_NAME}" 2>/dev/null || true
docker rm "${CONTAINER_NAME}" 2>/dev/null || true

echo ""
echo "🚀 Starting MediaRSS container..."
echo "   Port: ${HOST_PORT}"
echo "   Data: ${DATA_PATH}"
echo ""

# Ensure data directories exist
mkdir -p "${DATA_PATH}"
mkdir -p "${DATA_PATH}/artwork"

# Run the container
docker run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    -p "${HOST_PORT}:${CONTAINER_PORT}" \
    ${VOLUME_ARGS} \
    -e "MEDIA_PATHS=${MEDIA_PATHS}" \
    "${IMAGE_NAME}"

echo ""
echo "✅ MediaRSS is now running!"
echo ""
NAS_IP=$(get_local_ip)
echo "🌐 Access the admin dashboard at: http://${NAS_IP}:${HOST_PORT}"
echo ""
echo "📝 Notes:"
echo "   - Your data is stored at: ${DATA_PATH}"
echo "   - Database files: ${DATA_PATH}/*.db"
echo "   - Uploaded artwork: ${DATA_PATH}/artwork/"
echo "   - Media directories are mounted read/write for uploading media and editing metadata"
echo "   - Container will auto-restart on reboot"
echo ""
echo "🔧 Useful commands:"
echo "   View logs:     docker logs ${CONTAINER_NAME}"
echo "   Stop:          docker stop ${CONTAINER_NAME}"
echo "   Restart:       docker restart ${CONTAINER_NAME}"
echo "   Update:        Run this script again to pull the latest version"
