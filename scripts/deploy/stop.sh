#!/bin/bash
# Stop the API so its binary can be replaced cleanly.
set -e
# shellcheck source=scripts/deploy/env.sh
. "$(dirname "$0")/env.sh"
systemctl stop "$SERVICE" || true
