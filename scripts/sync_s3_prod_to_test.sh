#!/usr/bin/env bash
# Mirror the production bucket onto the test bucket.
set -uo pipefail

SOURCE_BUCKET="s3://karidavidson.com"
DEST_BUCKET="s3://test.karidavidson.com"

echo "Syncing from $SOURCE_BUCKET to $DEST_BUCKET..."
if aws s3 sync "$SOURCE_BUCKET" "$DEST_BUCKET" --delete; then
  echo "Sync complete."
else
  echo "Sync failed." >&2
  exit 1
fi
