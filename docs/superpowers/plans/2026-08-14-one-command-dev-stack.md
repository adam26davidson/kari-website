# One-Command Dev Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `./scripts/dev.sh` brings up the whole dev stack in one command — hermetic local MinIO (seeded) by default, `--aws` to target the real `test.karidavidson.com` bucket with SSO credentials.

**Architecture:** A root `docker-compose.yml` owns the MinIO container definition (with a healthcheck), replacing the hand-typed `docker run` in both docs and CI. `scripts/dev.sh` orchestrates: compose up → seed → API (`cargo run`) → UI (`vite`), with a trap that tears everything down on Ctrl-C. No API or UI code changes: the script runs the API **from the repo root** so `dotenv` never finds `api/.env` (dotenv only searches the process cwd and its ancestors), making the script's exported env vars the single source of configuration — which is what lets `--aws` omit `AWS_ENDPOINT_URL` and the MinIO dummy credentials entirely.

**Tech Stack:** bash, docker compose, MinIO, cargo, vite, existing `ui/e2e/seed.mjs`.

**Spec:** https://github.com/adam26davidson/kari-website/issues/194 (issue body = spec)

## Global Constraints

- 2-space indentation, 80-char line width (repo style; applies to YAML and bash too)
- Do NOT modify `api/src/**` or `ui/src/**` — coverage ratchet floors make code changes costly and none are needed
- MinIO conventions are fixed by `ui/e2e/config.mjs` + `api/.env` and must not drift: container `kari-e2e-s3`, port `9000`, bucket/user `kari-e2e`, password `kari-e2e-secret`
- Test bucket for `--aws` mode: `test.karidavidson.com`; region `us-east-1` for MinIO
- Commit only explicitly listed paths (`git add <paths>`, never `git add -A`)

---

### Task 1: docker-compose.yml + CI reuse

**Files:**
- Create: `docker-compose.yml` (repo root)
- Modify: `.github/workflows/ci.yml` — the `Start local S3 (MinIO)` step (~line 85)

**Interfaces:**
- Produces: `docker compose up -d --wait minio` starts a healthy MinIO on `localhost:9000` with the `kari-e2e` credentials; `docker compose down` removes it. Task 2's `dev.sh` calls exactly these two commands.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
# Local S3 stand-in for dev and e2e (see scripts/dev.sh and CLAUDE.md).
# Conventions (container name, port, credentials) are shared with
# ui/e2e/config.mjs and api/.env — keep them in sync.
services:
  minio:
    image: minio/minio
    container_name: kari-e2e-s3
    command: server /data
    ports:
      - "9000:9000"
    environment:
      MINIO_ROOT_USER: kari-e2e
      MINIO_ROOT_PASSWORD: kari-e2e-secret
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 2s
      timeout: 2s
      retries: 30
```

- [ ] **Step 2: Validate the compose file**

Run: `docker compose config -q`
Expected: exit 0, no output.

- [ ] **Step 3: Prove it actually starts and gets healthy**

Run: `docker compose up -d --wait minio && docker compose down`
Expected: `up` returns 0 with the container reported healthy, `down` removes it. (If a `kari-e2e-s3` container is already running from a previous manual `docker run`, stop it first: `docker stop kari-e2e-s3`.)

- [ ] **Step 4: Point CI at the compose file**

In `.github/workflows/ci.yml`, replace the body of the `Start local S3 (MinIO)` step (keep the step name and the comment block above it):

```yaml
      - name: Start local S3 (MinIO)
        run: docker compose up -d --wait minio
```

(The old body was the multi-line `docker run -d --rm --name kari-e2e-s3 …` block. Everything else in the workflow stays untouched — the API step's env vars, the seed step, etc.)

- [ ] **Step 5: Sanity-check workflow syntax**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .github/workflows/ci.yml
git commit -m "build: define local MinIO in docker-compose.yml and use it in CI"
```

---

### Task 2: scripts/dev.sh

**Files:**
- Create: `scripts/dev.sh` (mode 755)

**Interfaces:**
- Consumes: `docker compose up -d --wait minio` / `docker compose down` from Task 1; `ui/e2e/seed.mjs` (run as `node e2e/seed.mjs` with cwd `ui/`); `cargo run --manifest-path api/Cargo.toml`; `npm run dev` in `ui/`.
- Produces: `scripts/dev.sh [--aws]` — the command Task 3's docs describe.

**Key background for the implementer:**
- `api/src/main.rs` calls `dotenv::dotenv()`, which searches the process **cwd and its ancestors** for a `.env`. `api/.env` hardcodes the MinIO endpoint + dummy credentials. Running the API from the **repo root** (via `--manifest-path`) means no `.env` is found, so the script's exports are the only config. This is what makes `--aws` work without editing files: it simply doesn't export `AWS_ENDPOINT_URL` or the dummy keys, so the AWS SDK falls back to the ambient SSO credential chain.
- The UI has per-mode env files: `ui/.env.development` points `VITE_S3_URL` at the real test bucket; `ui/.env.test` points it at local MinIO (`http://localhost:9000/kari-e2e`). So MinIO mode must run vite with `--mode test`, and `--aws` mode uses the default development mode.

- [ ] **Step 1: Write `scripts/dev.sh`**

```bash
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

ui_args=()
if [ "$mode" = minio ]; then
  command -v docker > /dev/null || {
    echo "docker is required for local MinIO mode" >&2
    exit 1
  }
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
```

- [ ] **Step 2: Make it executable and syntax-check**

Run: `chmod +x scripts/dev.sh && bash -n scripts/dev.sh`
Expected: exit 0. Also run `shellcheck scripts/dev.sh` if shellcheck is installed; fix any findings (SC-style quoting issues are bugs, not noise).

- [ ] **Step 3: Smoke-test MinIO mode end to end**

Run (from repo root, with docker available):

```bash
./scripts/dev.sh > /tmp/dev-stack.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 90); do
  curl -sf http://localhost:3000/health > /dev/null && break
  sleep 2
done
curl -sf http://localhost:3000/health && echo API-OK
curl -sf http://localhost:5173/ > /dev/null && echo UI-OK
kill -INT $DEV_PID
sleep 5
docker ps --filter name=kari-e2e-s3 --format '{{.Names}}'
```

Expected: `API-OK` and `UI-OK` print; after the kill, `docker ps` prints nothing (compose down ran). If the API build takes a while on first run, the 90×2s loop covers it. Check `/tmp/dev-stack.log` on failure.

- [ ] **Step 4: Smoke-test --aws mode argument handling only**

Run: `./scripts/dev.sh --bogus; echo "exit=$?"`
Expected: `unknown option: --bogus …` and `exit=1`.
(Do NOT run a full `--aws` session from an agent — it needs live SSO credentials and talks to a real bucket; the mode's logic is arg parsing + env exports, which the code review covers.)

- [ ] **Step 5: Commit**

```bash
git add scripts/dev.sh
git commit -m "feat: add scripts/dev.sh one-command dev stack (MinIO default, --aws)"
```

---

### Task 3: Documentation (README.md + CLAUDE.md)

**Files:**
- Modify: `README.md` — replace the `## to run api` and `## to run ui` sections
- Modify: `CLAUDE.md` — Build Commands list and the e2e prerequisites text

**Interfaces:**
- Consumes: `scripts/dev.sh [--aws]` from Task 2, `docker compose up -d --wait minio` from Task 1.

- [ ] **Step 1: Update README.md**

Replace the `## to run api:` and `## to run ui` sections (everything from `## to run api:` up to but not including `## to sync prod s3 to test`) with:

```markdown
## Running the app locally

One command brings up the whole stack (MinIO, seeded fixture data, API on
:3000, UI dev server):

```
./scripts/dev.sh
```

By default the stack is hermetic — a throwaway MinIO container stands in for
S3, seeded with deterministic fixture content, and no AWS account is needed.
Ctrl-C tears everything down.

To develop against the real test bucket (`test.karidavidson.com`) instead:

```
aws sso login   # once per session
./scripts/dev.sh --aws
```

The pieces can still be run by hand if needed: `docker compose up -d --wait
minio`, `node e2e/seed.mjs` (in `ui/`), `cargo run` (in `api/`, whose `.env`
targets the local MinIO), and `npm run dev` (in `ui/`).
```

- [ ] **Step 2: Update CLAUDE.md**

In the `## Build Commands` list, add as the first bullet:

```markdown
- `./scripts/dev.sh` - Start the whole dev stack (MinIO + seed + API + UI);
  `--aws` targets the real test bucket via SSO instead of local MinIO
```

In the `## Test Commands` e2e bullet, replace the numbered prerequisite `1.`
(the `docker run … minio/minio server /data` block) with:

```markdown
  1. a throwaway MinIO standing in for S3:
     `docker compose up -d --wait minio` (defined in `docker-compose.yml`;
     `./scripts/dev.sh` starts this too, so a running dev stack already
     satisfies both prerequisites)
```

Keep prerequisite `2.` (the API on localhost:3000) as is.

- [ ] **Step 3: Verify docs don't reference the removed commands**

Run: `grep -rn "docker run" README.md CLAUDE.md`
Expected: no matches (CI keeps none either after Task 1; the only compose-free instructions left are inside `docker-compose.yml`'s own comment and `ui/e2e/config.mjs`'s `MINIO_START_COMMAND`, which are out of scope for this task).

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document scripts/dev.sh one-command dev workflow"
```
