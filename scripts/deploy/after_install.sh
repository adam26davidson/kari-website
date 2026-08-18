#!/bin/bash
# Fix ownership/permissions on the freshly installed files.
set -e
. "$(dirname "$0")/env.sh"
chown ubuntu:ubuntu "$API_DIR/kari-website-api"
chmod 755 "$API_DIR/kari-website-api"
chown -R ubuntu:ubuntu "$STATIC_DIR"
