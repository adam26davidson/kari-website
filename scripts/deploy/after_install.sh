#!/bin/bash
# Fix ownership/permissions on the freshly installed files.
set -e
# shellcheck source=scripts/deploy/env.sh
. "$(dirname "$0")/env.sh"
chown ubuntu:ubuntu "$API_DIR/kari-website-api"
chmod 755 "$API_DIR/kari-website-api"
chown -R ubuntu:ubuntu "$STATIC_DIR"
# The source snapshot the admin helper reads (appspec `repo` -> API_DIR/repo).
# The API runs as ubuntu and only ever reads it. Guarded so a rollback to a
# bundle from before the snapshot existed still installs cleanly.
if [ -d "$API_DIR/repo" ]; then
  chown -R ubuntu:ubuntu "$API_DIR/repo"
fi
