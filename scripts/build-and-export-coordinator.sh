#!/usr/bin/env bash
# build-and-export-coordinator.sh
# Build the AWARE coordinator image on a host that has DNS access to the
# internal git server, then export it as a tarball so it can be `docker load`-ed
# into a colima/dev host that doesn't have that DNS access.
#
# Run this on the BUILD HOST (must be able to reach AWARE_RL_PIPELINE_REPO).
# Then `docker load` the tarball on the dev host.

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Required: the git URL that Dockerfile.coordinator clones from. The
# "internal git" is the operator's local mirror of the rl-pipeline repo
# at the v0.2.2 tag — set AWARE_RL_PIPELINE_REPO to whichever URL your
# build host can reach (e.g. an internal Gitea, GitHub, or other mirror).
: "${AWARE_RL_PIPELINE_REPO:?AWARE_RL_PIPELINE_REPO must be set to a git URL the build host can reach}"

# Optional: pin to a specific rl-pipeline tag. Default matches compose file.
AWARE_RL_PIPELINE_TAG="${AWARE_RL_PIPELINE_TAG:-v0.2.2}"

# Optional: output tarball path. Default: ./aware-coordinator-<timestamp>.tar
OUTPUT_TAR="${OUTPUT_TAR:-./aware-coordinator-$(date +%Y%m%d-%H%M%S).tar}"

# Image tag (must match what the dev host expects when running the container).
IMAGE_TAG="${IMAGE_TAG:-aware-coordinator:0.4.5-phase4-rl-pipeline-from-internal-git}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-aware-2}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.coordinator.yml}"

# ─── Preflight ──────────────────────────────────────────────────────────────
echo "=== AWARE coordinator build-and-export ==="
echo "REPO_ROOT:        $REPO_ROOT"
echo "AWARE_RL_PIPELINE_REPO: $AWARE_RL_PIPELINE_REPO"
echo "AWARE_RL_PIPELINE_TAG:  $AWARE_RL_PIPELINE_TAG"
echo "IMAGE_TAG:        $IMAGE_TAG"
echo "OUTPUT_TAR:       $OUTPUT_TAR"
echo "COMPOSE_PROJECT:  $COMPOSE_PROJECT"
echo ""

# Sanity-check the source-tree edits are present (the durable fix from t_c9246f65).
echo "=== Verifying source-tree edits are in place ==="
grep -q "^COPY src/audit ./src/audit$" Dockerfile.coordinator || {
  echo "ERROR: Dockerfile.coordinator is missing the 'COPY src/audit' line." >&2
  echo "Apply the edits from kanban t_c9246f65 first." >&2
  exit 1
}
grep -q "mkdir -p /data/audit" Dockerfile.coordinator || {
  echo "ERROR: Dockerfile.coordinator is missing the '/data/audit' mkdir." >&2
  echo "Apply the edits from kanban t_c9246f65 first." >&2
  exit 1
}
test -f src/audit/package.json || {
  echo "ERROR: src/audit/package.json is missing." >&2
  echo "Apply the edits from kanban t_c9246f65 first." >&2
  exit 1
}
test "$(cat src/audit/package.json)" = '{"type":"commonjs"}' || {
  echo "ERROR: src/audit/package.json content is wrong." >&2
  echo "Expected: {\"type\":\"commonjs\"}" >&2
  echo "Got: $(cat src/audit/package.json)" >&2
  exit 1
}
echo "  ✓ COPY src/audit in Dockerfile.coordinator"
echo "  ✓ /data/audit mkdir in Dockerfile.coordinator"
echo "  ✓ src/audit/package.json with commonjs type"
echo ""

# Verify DNS resolution to the internal git server.
echo "=== Verifying DNS access to internal git ==="
git_host="$(echo "$AWARE_RL_PIPELINE_REPO" | sed -E 's|^https?://([^/]+)/.*|\1|; s|^git@([^:]+):.*|\1|')"
if ping -c1 -W2 "$git_host" >/dev/null 2>&1; then
  echo "  ✓ $git_host is reachable"
else
  echo "ERROR: $git_host is not reachable from this host." >&2
  echo "This script must run on a host that can resolve the internal git." >&2
  exit 1
fi
echo ""

# ─── Build ──────────────────────────────────────────────────────────────────
echo "=== Building image (no cache) ==="
DOCKER_BUILDKIT=1 docker compose \
  -f "$COMPOSE_FILE" \
  -p "$COMPOSE_PROJECT" \
  build --no-cache aware-coordinator

# Tag the compose-built image with our stable IMAGE_TAG so docker save uses it.
# Compose tags images as <project>-<service> by default (aware-2-aware-coordinator).
COMPOSE_BUILT_TAG="${COMPOSE_PROJECT}-aware-coordinator"
echo ""
echo "=== Tagging $COMPOSE_BUILT_TAG → $IMAGE_TAG ==="
docker tag "$COMPOSE_BUILT_TAG" "$IMAGE_TAG"

# ─── Verify the baked-in audit chain (mirrors the live hot-patch) ────────────
echo ""
echo "=== Inspecting built image ==="
docker run --rm "$IMAGE_TAG" sh -c '
  echo "Files in /app/src/audit/:"
  ls -la /app/src/audit/ 2>&1
  echo ""
  echo "Package.json contents:"
  cat /app/src/audit/package.json 2>&1
  echo ""
  echo "Decision-logger source present:"
  head -5 /app/src/audit/decision-logger.js 2>&1
  echo ""
  echo "Data dir ownership baked in:"
  ls -ld /data/audit 2>&1
'

# ─── Export ─────────────────────────────────────────────────────────────────
echo ""
echo "=== Exporting image to $OUTPUT_TAR ==="
docker save "$IMAGE_TAG" -o "$OUTPUT_TAR"

echo ""
echo "=== Build summary ==="
echo "  Image:  $IMAGE_TAG ($(docker inspect --format='{{.Size}}' "$IMAGE_TAG" | numfmt --to=iec --suffix=B))"
echo "  Tarball: $OUTPUT_TAR ($(du -h "$OUTPUT_TAR" | cut -f1))"
echo ""
echo "=== Next steps on the dev host (the colima instance) ==="
echo "  1. Copy $OUTPUT_TAR to the dev host:"
echo "     scp $OUTPUT_TAR user@devhost:~/"
echo ""
echo "  2. On the dev host, load the image into colima's docker:"
echo "     docker load -i ~/$OUTPUT_TAR"
echo ""
echo "  3. Force-recreate the running container to use the new image:"
echo "     docker compose -f docker-compose.coordinator.yml -p $COMPOSE_PROJECT up -d --force-recreate aware-2-coordinator"
echo ""
echo "  4. Run the verification steps from kanban t_c9246f65:"
echo "     - docker exec aware-2-coordinator ls -la /app/src/audit/    # should show decision-logger.js + package.json"
echo "     - docker exec aware-2-coordinator ls -la /data/audit/       # should be aware:aware"
echo "     - docker logs aware-2-coordinator --since 30s | grep -c 'decision-logger unavailable'  # should be 0"
echo "     - send a /coordinate probe and confirm no warnings"
echo ""
echo "Done."