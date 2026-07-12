#!/bin/bash
# Start the API with the newly deployed binary.
set -e
systemctl daemon-reload
systemctl start kari-api.service
