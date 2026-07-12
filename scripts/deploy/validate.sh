#!/bin/bash
# Confirm the API is actually serving before marking the deploy successful.
set -e
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/haiku || true)
  if [ "$code" = "200" ]; then
    echo "API healthy (HTTP 200) after ${i} attempt(s)"
    exit 0
  fi
  sleep 2
done
echo "API did not return HTTP 200 in time"
systemctl status kari-api.service --no-pager | tail -20 || true
exit 1
