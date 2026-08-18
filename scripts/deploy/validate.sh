#!/bin/bash
# Confirm the API is actually serving before marking the deploy successful.
# /health probes S3 read+write, so a deploy with broken credentials fails
# validation instead of going live.
set -e
. "$(dirname "$0")/env.sh"
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${API_PORT}/health" || true)
  if [ "$code" = "200" ]; then
    echo "API healthy (HTTP 200) after ${i} attempt(s)"
    exit 0
  fi
  sleep 2
done
echo "API did not return HTTP 200 in time"
systemctl status "$SERVICE" --no-pager | tail -20 || true
exit 1
