#!/usr/bin/env bash
# One-command dev stack (issues #194, #220).
#
#   scripts/dev.sh          hermetic local S3 (RustFS): compose up + seed +
#                           API + both UIs (public and admin)
#   scripts/dev.sh --aws    no local S3; API uses your SSO credentials against
#                           the test.karidavidson.com bucket
#
# Stacks are per-worktree and self-contained (issue #220): the S3
# container is namespaced by compose's directory-based project name, and
# ports are chosen per stack — defaults (S3 9000, API 3000) when free,
# otherwise a free port is picked automatically, so N stacks can run in
# parallel with no coordination and `docker compose down` in one worktree
# never touches another's stack. Override the choices with KARI_S3_PORT
# (0 = ephemeral) and KARI_API_PORT. The chosen URLs are printed at startup
# and exported to the UI/API, so every piece of one stack talks to that
# stack only.
#
# Ctrl-C tears everything down (API, both UI dev servers, and the S3
# container).
#
# UI dependencies are installed by scripts/setup-worktree.sh, which this
# script runs first; tests for that delegation live in
# scripts/setup-worktree-test.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

mode=local
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

# Dependencies come from the canonical setup script instead of a second
# copy of the install logic (issue #298): it installs from the lockfile with
# `npm ci` — no silent lockfile drift — and adds the Playwright browser the
# visual check needs. Its own skip check keeps a re-run down to about a
# second, so a warm stack starts as fast as it used to. --quiet keeps that
# warm path silent (issue #300) — a stack start should not be preceded by a
# setup banner about work that did not happen; a run that does install still
# says so.
scripts/setup-worktree.sh --quiet

pids=()
cleanup() {
  trap - INT TERM EXIT
  if [ "${#pids[@]}" -gt 0 ]; then
    kill "${pids[@]}" 2> /dev/null || true
    wait "${pids[@]}" 2> /dev/null || true
  fi
  if [ "$mode" = local ]; then
    docker compose down
  fi
}
trap cleanup INT TERM EXIT

# True when something on localhost already listens on the port. A connect
# test is close enough for picking dev ports; the small window between
# checking and binding is harmless here.
port_in_use() {
  # The subshell's fd closes itself when the subshell exits.
  (exec 3<> "/dev/tcp/127.0.0.1/$1") 2> /dev/null
}

# An OS-assigned free port (bind to 0, report what was picked).
free_port() {
  node -e 'const s=require("net").createServer();
    s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});'
}

# API port: explicit KARI_API_PORT wins; otherwise the conventional 3000
# when free (so single-stack workflows keep their usual URL), else a free
# port so a second stack comes up without coordination.
if [ -z "${KARI_API_PORT:-}" ]; then
  if port_in_use 3000; then
    KARI_API_PORT=$(free_port)
    echo "Port 3000 is taken; the API will use port $KARI_API_PORT"
  else
    KARI_API_PORT=3000
  fi
fi
export PORT="$KARI_API_PORT"
# Real env vars beat .env.* files in Vite, so this pins the UI (and, in
# local mode, the seeds via ui/e2e/config.mjs) to THIS stack's API.
export VITE_API_URL="http://localhost:$KARI_API_PORT"

if [ "$mode" = local ]; then
  command -v docker > /dev/null || {
    echo "docker is required for local S3 mode" >&2
    exit 1
  }
  # S3 host port: explicit KARI_S3_PORT wins (0 = ephemeral);
  # otherwise the conventional 9000 when free, else ephemeral. Either way
  # the real port is read back from docker after the container is up.
  if [ -z "${KARI_S3_PORT:-}" ]; then
    if port_in_use 9000; then
      echo "Port 9000 is taken; local S3 will use an ephemeral port"
      KARI_S3_PORT=0
    else
      KARI_S3_PORT=9000
    fi
  fi
  export KARI_S3_PORT
  docker compose up -d --wait s3
  s3_port=$(docker compose port s3 9000)
  s3_port=${s3_port##*:}
  export VITE_S3_URL="http://localhost:$s3_port/kari-e2e"
  # e2e/config.mjs prefers VITE_S3_URL from the environment, so the seed
  # lands in this stack's S3 whatever port it got.
  (cd ui && node e2e/seed.mjs)
  # Mirror api/.env (endpoint port aside); exported here because the API
  # runs from the repo root (see comment below) and never reads that file.
  export BUCKET_NAME=kari-e2e
  export AWS_ENDPOINT_URL="http://localhost:$s3_port"
  export AWS_REGION=us-east-1
  export AWS_ACCESS_KEY_ID=kari-e2e
  export AWS_SECRET_ACCESS_KEY=kari-e2e-secret
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
  # ui/.env.development points at local S3 (issue #246), so --aws mode
  # must say explicitly that the UI reads the real test bucket.
  export VITE_S3_URL=https://s3.us-east-2.amazonaws.com/test.karidavidson.com
fi

echo
echo "Dev stack for $PWD:"
echo "  API:    http://localhost:$KARI_API_PORT"
echo "  S3:     $VITE_S3_URL"
echo "  UI:     vite picks a free port and prints its URL below (5173 by"
echo "          default)"
echo "  Admin:  a second vite on 5174 by default, at /admin/ — you are"
echo "          signed in automatically (no Auth0 login, no credentials);"
echo "          run VITE_AUTH_MODE=auth0 scripts/dev.sh for a real one"
echo

# What the admin helper reads code from. In production this is a snapshot
# installed beside the binary; here it is this clone, so the helper sees
# exactly what you are editing. Harmless with no ANTHROPIC_API_KEY set —
# nothing reads it until there is a conversation.
export REPO_DIR="$PWD"

# The local auth bypass (#266): the API additionally accepts a static dev
# token as an admin, so the admin UI signs itself in with no Auth0 round
# trip. Both gates are needed and neither is in a deployed build — the
# feature is not default, and deploy.yml's `cross build --release` does not
# ask for it. Real Auth0 tokens keep working, so VITE_AUTH_MODE=auth0 still
# gives you the real login against this same stack.
export KARI_DEV_AUTH=1

# Run the API from the repo root on purpose: dotenv only finds api/.env when
# the cwd is api/, so the exports above are the API's entire configuration.
cargo run --manifest-path api/Cargo.toml --features dev-auth &
pids+=($!)

# No --mode flag: .env.development targets local S3 too (issue #246),
# and the VITE_* exports above override any .env file with this stack's
# actual URLs in both modes.
(cd ui && npm run dev) &
pids+=($!)

# The admin app is a separate vite build with its own dev server (#591), so
# the stack needs both to be a whole site: the public header's "Admin" entry
# is a plain link out of the SPA, and it lands on nothing without this
# (issue #593). Its pid joins `pids` like every other child — a dev server
# left running after Ctrl-C is a file watcher that outlives the session.
(cd ui && npm run dev:admin) &
pids+=($!)

# Exit when any of the three dies; the EXIT trap tears down the rest.
wait -n
