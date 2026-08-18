#!/bin/bash
# Stop the API so its binary can be replaced cleanly.
set -e
. "$(dirname "$0")/env.sh"
systemctl stop "$SERVICE" || true
