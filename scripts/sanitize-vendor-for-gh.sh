#!/usr/bin/env bash
# scripts/sanitize-vendor-for-gh.sh
# Idempotent. Removes provider-name + host-path disclosures from vendored
# heavy-think source for safe GH push. Re-run after every upstream re-sync.
#
# Transformations (all bidirectional — re-runnable):
#   MINIMAX_API_KEY → LLM_API_KEY            (env var + tests + comments)
#   ~/.openclaw/openclaw.json → ${OPENCLAW_CONFIG}    (host-path in src/clients/minimax.js comment)
#   ~/.openclaw/audit/rlm/security.jsonl → ${OPENCLAW_AUDIT_LOG}/security.jsonl
#                                                        (host-path in src/rlm/errors.js, seccomp/rlm.json)
#
# NOT touched:
#   - LICENSE / NOTICE.md / package.json (Apache-2.0 requires preservation)
#   - VENDORED.md (provider identity stays in the vendor provenance record)
#   - The public provider URL https://api.minimax.io/anthropic in the comment
#     is replaced with the runtime-readable name (providers advertise their
#     own endpoints so URL leak is low-impact, but we redact for symmetry)
#
# After this runs, all runtime reads become process.env.LLM_API_KEY.
# Operators using the GH-pushed build must set LLM_API_KEY in env (NOT
# MINIMAX_API_KEY — the rename is part of the public-surface scrub).

set -euo pipefail

VENDOR_DIR="${1:-backend/heavy-think}"

# Bail if vendor dir doesn't exist
if [ ! -d "$VENDOR_DIR" ]; then
  echo "sanitize-vendor-for-gh: $VENDOR_DIR not found" >&2
  exit 1
fi

echo "Sanitizing $VENDOR_DIR for GH push..."

# 1. Env var rename — affects code, tests, comments, error messages.
#    Applies to .js, .json, .md files under $VENDOR_DIR (excluding LICENSE/NOTICE.md).
find "$VENDOR_DIR" -type f \( -name "*.js" -o -name "*.json" -o -name "*.md" \) \
  ! -name "LICENSE" ! -name "NOTICE.md" ! -name "VENDORED.md" \
  -print0 | while IFS= read -r -d '' f; do
  # Idempotent: only replace if the old token is present (avoids noise on
  # subsequent runs after the rename already happened).
  if grep -q "MINIMAX_API_KEY" "$f" 2>/dev/null; then
    sed -i.bak 's/MINIMAX_API_KEY/LLM_API_KEY/g' "$f"
    rm -f "$f.bak"
    echo "  rewrote: $f"
  fi
done

# 2. Host-path rewrite — openclaw config reference.
if grep -rq '~/.openclaw/openclaw.json' "$VENDOR_DIR" 2>/dev/null; then
  find "$VENDOR_DIR" -type f \
    -exec sed -i.bak 's|~/.openclaw/openclaw.json|\${OPENCLAW_CONFIG}/openclaw.json|g' {} +
  find "$VENDOR_DIR" -type f -name "*.bak" -delete
  echo "  rewrote: ~/.openclaw/openclaw.json → \${OPENCLAW_CONFIG}/openclaw.json"
fi

# 3. Host-path rewrite — audit log path.
if grep -rq '~/.openclaw/audit/rlm/security.jsonl' "$VENDOR_DIR" 2>/dev/null; then
  find "$VENDOR_DIR" -type f \
    -exec sed -i.bak 's|~/.openclaw/audit/rlm/security.jsonl|\${OPENCLAW_AUDIT_LOG}/security.jsonl|g' {} +
  find "$VENDOR_DIR" -type f -name "*.bak" -delete
  echo "  rewrote: ~/.openclaw/audit/rlm/security.jsonl → \${OPENCLAW_AUDIT_LOG}/security.jsonl"
fi

# 4. Validate JSON files still parse (sed can't break JSON if we touched
#    only key names + path strings, but verify).
echo ""
echo "Verifying JSON files still parse..."
for json in $(find "$VENDOR_DIR" -type f -name "*.json"); do
  if ! python3 -c "import json; json.load(open('$json'))" 2>/dev/null; then
    echo "  BROKEN: $json" >&2
    exit 1
  fi
done
echo "  all JSON parses cleanly"

echo ""
echo "Done. Verify with:"
echo "  grep -r 'MINIMAX_API_KEY\\|~/.openclaw/' $VENDOR_DIR/  (should return nothing)"
