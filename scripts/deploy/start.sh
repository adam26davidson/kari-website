#!/bin/bash
# Start the API with the newly deployed binary.
set -e
. "$(dirname "$0")/env.sh"
systemctl daemon-reload
systemctl start "$SERVICE"
