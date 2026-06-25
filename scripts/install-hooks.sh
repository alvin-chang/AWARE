#!/bin/bash
# scripts/install-hooks.sh — Idempotent installer for AWARE privacy filter
# client-side hooks (Layer 1 pre-commit + Layer 2 pre-push).
#
# Layer 3 (gitea pre-receive) is a server-side hook — it lives on the
# gitea host, not in the working copy. See docs/security/gitea-pre-receive-install.md
# for installation instructions (the release agent owns that install).
#
# Usage:
#   ./scripts/install-hooks.sh           # install on the current clone
#   ./scripts/install-hooks.sh --uninstall  # remove client-side hooks
#
# Idempotent: safe to re-run. Replaces existing symlinks pointing to
# scripts/hooks/* and copies fresh. Does NOT touch Layer 3.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SRC_DIR="$REPO_ROOT/scripts/hooks"

UNINSTALL=0
for arg in "$@"; do
    case "$arg" in
        --uninstall) UNINSTALL=1 ;;
        --help|-h)
            sed -n '2,/^set -euo pipefail$/p' "$0"
            exit 0
            ;;
        *) echo "Unknown arg: $arg" >&2; exit 1 ;;
    esac
done

if [[ ! -d "$HOOKS_DIR" ]]; then
    echo "✗ .git/hooks/ not found — is this a git working copy?" >&2
    exit 1
fi

if [[ ! -d "$SRC_DIR" ]]; then
    echo "✗ scripts/hooks/ not found in $REPO_ROOT" >&2
    exit 1
fi

# ── Detect git's core.hooksPath ──────────────────────────────────────────
# If set, git uses THAT directory instead of .git/hooks/. This is common
# in OpenClaw-managed environments (core.hooksPath = <HOME>/.githooks).
# In that case, installing hooks in .git/hooks/ has no effect.
HOOKS_PATH="$(git config --get core.hooksPath 2>/dev/null || true)"
if [[ -n "$HOOKS_PATH" ]]; then
    echo "ℹ️  git core.hooksPath is set to: $HOOKS_PATH"
    echo "   git will use that directory INSTEAD of .git/hooks/."
    echo "   To make AWARE privacy hooks fire, install them into:"
    echo "     $HOOKS_PATH/pre-commit"
    echo "     $HOOKS_PATH/pre-push"
    echo "   (This script installs to .git/hooks/ — verify with 'git commit' that"
    echo "    the hook actually runs. If it doesn't, copy scripts/hooks/* to"
    echo "    $HOOKS_PATH/ instead, or chain them into the existing global hook.)"
    echo ""
fi

# ── Uninstall path ───────────────────────────────────────────────────────
if [[ $UNINSTALL -eq 1 ]]; then
    for hook in pre-commit pre-push; do
        target="$HOOKS_DIR/$hook"
        if [[ -e "$target" ]]; then
            # If it's a symlink to one of our scripts, remove it
            if [[ -L "$target" ]] && readlink "$target" | grep -q "scripts/hooks/$hook"; then
                rm -f "$target"
                echo "  Removed $target (was a managed symlink)"
            elif [[ -f "$target" ]] && grep -q "scripts/hooks/$hook" "$target" 2>/dev/null; then
                # If it's a copy of our hook (not a symlink), back it up and remove
                mv "$target" "${target}.bak.$(date +%s)"
                echo "  Moved $target to ${target}.bak.$(date +%s) (was a managed copy)"
            else
                echo "  Skipped $target (not a managed hook — leaving alone)"
            fi
        else
            echo "  $target did not exist"
        fi
    done
    echo ""
    echo "✓ Client-side hooks removed. Layer 3 (gitea pre-receive) untouched."
    exit 0
fi

# ── Install path ─────────────────────────────────────────────────────────
echo "Installing AWARE privacy filter hooks (Layer 1 + 2) into $HOOKS_DIR"

INSTALLED=0
SKIPPED=0

for hook in pre-commit pre-push; do
    target="$HOOKS_DIR/$hook"
    src="$SRC_DIR/$hook"

    if [[ ! -f "$src" ]]; then
        echo "  ✗ Source $src missing" >&2
        exit 1
    fi
    chmod +x "$src"

    # If target already exists and is a managed symlink/file, replace
    if [[ -e "$target" ]]; then
        if [[ -L "$target" ]] && readlink "$target" | grep -q "scripts/hooks/$hook"; then
            rm -f "$target"
        elif [[ -f "$target" ]] && grep -q "AWARE 4-layer privacy filter" "$target" 2>/dev/null; then
            rm -f "$target"
        else
            # Existing hook that isn't ours — back it up before clobbering
            mv "$target" "${target}.pre-aware.$(date +%s)"
            echo "  Backed up existing $target → ${target}.pre-aware.$(date +%s)"
            SKIPPED=0  # we handled it, not a skip
        fi
    fi

    # Use a relative symlink so the install works across machines / clone paths
    REL_SRC="$(realpath --relative-to="$HOOKS_DIR" "$src" 2>/dev/null || python3 -c "import os.path; print(os.path.relpath('$src', '$HOOKS_DIR'))")"
    ln -s "$REL_SRC" "$target"
    echo "  ✓ Installed $target → $REL_SRC"
    INSTALLED=$((INSTALLED + 1))
done

echo ""
echo "✓ Installed $INSTALLED client-side hook(s)."
echo ""
echo "Layer 3 (gitea pre-receive) is a server-side hook."
echo "Install instructions: docs/security/gitea-pre-receive-install.md"
echo "Owner: the release agent (the release agent installs after this branch lands)."
echo ""
echo "Test the install:"
echo "  git commit --allow-empty -m 'test: verify pre-commit hook fires'"
echo "  git push --dry-run         # tests the pre-push hook without actually pushing"
echo "  git reset --soft HEAD~1    # undo the test commit"
