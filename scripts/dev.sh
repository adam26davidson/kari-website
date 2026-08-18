#!/usr/bin/env bash
# One-command dev stack (issue #194).
#
#   scripts/dev.sh          hermetic local MinIO: compose up + seed + API + UI
#   scripts/dev.sh --aws    no MinIO; API uses your SSO credentials against
#                           the test.karidavidson.com bucket
#
# Ctrl-C tears everything down (API, UI, and the MinIO container).
set -euo pipefail

cd "$(dirname "$0")/.."

mode=minio
for arg in "$@"; do
  case "$arg" in
    --aws) mode=aws ;;
    -h | --help)
      echo "usage: scripts/dev.sh [--aws]"
      exit 0
      ;;
    *)
      echo "unknown option: $arg (usage: scripts/dev.sh [--aws])" >&2
      exit 1
      ;;
  esac
done

for cmd in cargo node npm; do
  command -v "$cmd" > /dev/null || {
    echo "$cmd is required but not installed" >&2
    exit 1
  }
done

if [ ! -d ui/node_modules ]; then
  echo "Installing UI dependencies..."
  (cd ui && npm install)
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  if [ "${#pids[@]}" -gt 0 ]; then
    kill "${pids[@]}" 2> /dev/null || true
    wait "${pids[@]}" 2> /dev/null || true
  fi
  if [ "$mode" = minio ]; then
    docker compose down
  fi
}
trap cleanup INT TERM EXIT

# `docker compose up` fails with a name conflict when a container already
# holds the fixed `container_name` from docker-compose.yml but compose won't
# reuse it: it belongs to another compose project (a worktree with a
# different directory name), or it exited (invisible to plain `docker ps`,
# still holding the name). It's a throwaway seeded MinIO, so removing it is
# always safe; only this project's own running container is left for compose.
remove_stale_container() {
  local name=$1 cid state owner project
  cid=$(docker ps -aq --filter "name=^${name}\$")
  [ -n "$cid" ] || return 0
  state=$(docker inspect -f '{{.State.Status}}' "$cid")
  owner=$(docker inspect -f \
    '{{index .Config.Labels "com.docker.compose.project"}}' "$cid")
  project=${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]')}
  if [ "$state" = running ] && [ "$owner" = "$project" ]; then
    return 0
  fi
  echo "Removing stale $name container ($state, compose project:" \
    "${owner:-none}) so docker compose can recreate it"
  docker rm -f "$cid" > /dev/null
}

ui_args=()
if [ "$mode" = minio ]; then
  command -v docker > /dev/null || {
    echo "docker is required for local MinIO mode" >&2
    exit 1
  }
  remove_stale_container kari-e2e-s3
  docker compose up -d --wait minio
  (cd ui && node e2e/seed.mjs)
  # Mirror api/.env; exported here because the API runs from the repo root
  # (see comment below) and never reads that file.
  export BUCKET_NAME=kari-e2e
  export AWS_ENDPOINT_URL=http://localhost:9000
  export AWS_REGION=us-east-1
  export AWS_ACCESS_KEY_ID=kari-e2e
  export AWS_SECRET_ACCESS_KEY=kari-e2e-secret
  # .env.test points VITE_S3_URL at the local MinIO bucket.
  ui_args=(-- --mode test)
else
  command -v aws > /dev/null || {
    echo "the aws CLI is required for --aws mode" >&2
    exit 1
  }
  if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "AWS credentials missing or expired — run: aws sso login" >&2
    exit 1
  fi
  export BUCKET_NAME=test.karidavidson.com
  # No AWS_ENDPOINT_URL / static keys: the SDK uses the SSO chain.
  # (ui/.env.development already points VITE_S3_URL at the test bucket.)
fi

# Run the API from the repo root on purpose: dotenv only finds api/.env when
# the cwd is api/, so the exports above are the API's entire configuration.
cargo run --manifest-path api/Cargo.toml &
pids+=($!)

(cd ui && npm run dev ${ui_args[@]+"${ui_args[@]}"}) &
pids+=($!)

# Exit when either process dies; the EXIT trap tears down the rest.
wait -n
