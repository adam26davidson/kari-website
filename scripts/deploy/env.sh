#!/bin/bash
# Per-environment settings shared by the CodeDeploy lifecycle hooks.
# CodeDeploy exports DEPLOYMENT_GROUP_NAME to every hook, which lets one set
# of scripts serve both deployment groups. The paths here must match the
# `files:` destinations in the matching appspec (appspec.yml for prod,
# appspec.test.yml for test) and the systemd units on the instance.
if [ "$DEPLOYMENT_GROUP_NAME" = "kari-website-test" ]; then
  SERVICE=kari-api-test.service
  STATIC_DIR=/home/ubuntu/static-sites/kari-website-test
  API_DIR=/home/ubuntu/kari-api-test
  API_PORT=3001
else
  SERVICE=kari-api.service
  STATIC_DIR=/home/ubuntu/static-sites/kari-website
  API_DIR=/home/ubuntu/kari-api
  API_PORT=3000
fi
