#!/bin/bash
# Stop the API so its binary can be replaced cleanly.
set -e
systemctl stop kari-api.service || true
