#!/bin/zsh

SOURCE_BUCKET="s3://karidavidson.com"
DEST_BUCKET="s3://test.karidavidson.com"

echo "Syncing from $SOURCE_BUCKET to $DEST_BUCKET..."
aws s3 sync $SOURCE_BUCKET $DEST_BUCKET --delete

if [[ $? -eq 0 ]]; then
  echo "Sync complete."
else
  echo "Sync failed."
fi