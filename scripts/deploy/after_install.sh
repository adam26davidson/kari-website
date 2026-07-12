#!/bin/bash
# Fix ownership/permissions on the freshly installed files.
set -e
chown ubuntu:ubuntu /home/ubuntu/kari-api/kari-website-api
chmod 755 /home/ubuntu/kari-api/kari-website-api
chown -R ubuntu:ubuntu /home/ubuntu/static-sites/kari-website
