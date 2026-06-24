#!/bin/bash
# pre-commit-check.sh
# Pre-commit hook for the privacy filter (post 2026-06-23 audit).
# Blocks patterns that should never reach the public repo:
#   1. Host-specific paths in docs/audits/*.md
#   2. LAN IPs and secrets paths in STATUS.md
#   3. src/data/*.json shape (only .json.template should be tracked)
#
# Install: ln -s ../../scripts/pre-commit-check.sh .git/hooks/pre-commit

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FAILED=0

# 1. docs/audits/*.md host-path check
if [[ -d docs/audits ]]; then
    echo "🔍 Checking docs/audits/*.md for host-path patterns..."
    # Allow common dev dirs: <canonical-credential-store>/, <canonical-credential-store>/, <canonical-credential-store>/, <canonical-credential-store>/, <canonical-credential-store>/, <canonical-credential-store>/, <canonical-credential-store>/
    # Flag only sensitive dirs: <canonical-credential-store>/, <canonical-credential-store>/, <canonical-credential-store>/, <canonical-credential-store>/, <canonical-credential-store>/ + ~/.<host-secret-dir>/
    if grep -rE '(/Users/[a-z]+/|\.aws/|\.ssh/|\.kube/|\.docker/|\.gnupg/|\.<host-secret-dir>/)' docs/audits/ 2>/dev/null; then
        echo "❌ Host-specific path pattern found in docs/audits/*.md"
        FAILED=1
    fi
fi

# 2. STATUS.md LAN IP + secrets path check
if [[ -f STATUS.md ]]; then
    echo "🔍 Checking STATUS.md for LAN IPs and secrets paths..."
    if grep -E '\b(192\.168\.[0-9]{1,3}\.[0-9]{1,3}|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\b' STATUS.md; then
        echo "❌ LAN IP found in STATUS.md"
        FAILED=1
    fi
    if grep -E '<redacted-credential-path>*\.env|api-keys\.env|credentials\.env' STATUS.md; then
        echo "❌ Secrets file path found in STATUS.md"
        FAILED=1
    fi
fi

# 3. src/data/*.json shape check
echo "🔍 Checking src/data/*.json shape..."
for f in src/data/users.json src/data/agents.json; do
    if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
        echo "❌ $f is tracked in git. Only .json.template should be committed."
        FAILED=1
    fi
    if [[ -f "${f}.template" ]]; then
        if grep -E '"passwordHash"|"credentials"' "${f}.template"; then
            echo "❌ ${f}.template contains passwordHash or credentials fields"
            FAILED=1
        fi
    fi
done

if [[ $FAILED -eq 0 ]]; then
    echo "✅ All privacy filter checks passed"
    exit 0
else
    echo ""
    echo "Privacy filter blocked this commit. See docs/security/history-rewrites.md for context."
    exit 1
fi
