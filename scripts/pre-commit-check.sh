#!/bin/bash
# pre-commit-check.sh
# Pre-commit hook to prevent private information from being committed
# Install: ln -s ../../scripts/pre-commit-check.sh .git/hooks/pre-commit
# ONLY runs on publish/main (public GitHub branch)

set -euo pipefail

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$BRANCH" != "publish/main" ]]; then
  exit 0
fi

echo "🔍 Running pre-commit security check (publish/main)..."

PRIVATE_FILES=(
  "verdicts/"
  ".env.production"
  ".env.local"
  "RESULT-A1-"
  "RESULT-A2-"
  "RESULT-C1"
  "RESULT-2026"
  "FINAL_STATUS.json"
  "STATUS.json"
  "debug.js"
  "playwright-debug.js"
)

PRIVATE_PATTERNS=(
  "ghp_[a-zA-Z0-9]{36}"
  "gho_[a-zA-Z0-9]{36}"
  "AKIA[0-9A-Z]{16}"
  "BEGIN\s+(RSA|EC|DSA|OPENSSL)\s+PRIVATE\s+KEY"
  "<runtime>\.local"
)

BLOCKED=false

# Only check ADDED or MODIFIED files — skip deletions (D) and renames (R)
while IFS= read -r line; do
  status="${line:0:1}"
  filepath="${line:3}"

  # Skip deletions — removing private files is good
  if [[ "$status" == "D" ]] || [[ "$status" == "R" ]]; then
    continue
  fi

  # Block ADDED private files only (not modifications of existing files)
  for blocked in "${PRIVATE_FILES[@]}"; do
    if [[ "$filepath" == *"$blocked"* ]] && [[ "$status" == "A" ]]; then
      echo "❌ BLOCKED: Private file added: $filepath"
      BLOCKED=true
    fi
  done

  # Check file content for private patterns (all non-deletion changes)
  if [[ -f "$filepath" ]]; then
    content=$(head -200 "$filepath")
    for pattern in "${PRIVATE_PATTERNS[@]}"; do
      if echo "$content" | grep -qiE "$pattern" 2>/dev/null; then
        echo "❌ BLOCKED: Private pattern in $filepath"
        BLOCKED=true
        break
      fi
    done
  fi

  # Large files (>5MB)
  if [[ -f "$filepath" ]]; then
    size=$(wc -c < "$filepath" 2>/dev/null || echo 0)
    if [[ $size -gt 5242880 ]]; then
      echo "❌ BLOCKED: Large file: $filepath ($(($size/1024/1024))MB > 5MB limit)"
      BLOCKED=true
    fi
  fi
done < <(git diff --cached --name-status)

if [[ "$BLOCKED" == "true" ]]; then
  echo ""
  echo "⚠️  Commit blocked on publish/main. Fix the issues above."
  echo "   To bypass after review: git commit --no-verify -m 'message'"
  exit 1
fi

echo "✅ Pre-commit check passed"
exit 0
