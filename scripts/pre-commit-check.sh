#!/bin/bash
# pre-commit-check.sh
# Pre-commit hook for the privacy filter (post [date-redacted] audit).
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
    # Allow common dev dirs: redacted-credential-store/, redacted-credential-store/, redacted-credential-store/, redacted-credential-store/, redacted-credential-store/, redacted-credential-store/, redacted-credential-store/
    # Flag only sensitive dirs: redacted-credential-store/, redacted-credential-store/, redacted-credential-store/, redacted-credential-store/, redacted-credential-store/ + ~/.redacted-credential-dir/
    if grep -rE '(/Users/[a-z]+/|\.aws/|\.ssh/|\.kube/|\.docker/|\.gnupg/|\.redacted-credential-dir/)' docs/audits/ 2>/dev/null; then
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

# 4. ADR numbering check (docs/adr/ADR-NNN-*.md)
# Catches the 2026-07-13 incident where three ADRs all claimed ADR-044 in
# the same 5-minute drafting window. Enforces:
#   (a) Filename uniqueness — no two files in docs/adr/ share the same ADR-NNN
#   (b) Filename pattern — every ADR file must match ADR-NNN-<slug>.md
#       (the un-prefixed form "foo-coverage.md" was a 2026-07-13 failure mode)
#   (c) Stale-name check — staged content must not reference the old
#       un-prefixed filename (e.g. AISVS-coverage.md) after a rename
#   (d) Stale-number check — staged content in docs/adr/ and src/ must not
#       reference the old ADR-NNN (e.g. ADR-044) when the file was renamed
#   (e) H1 <-> filename consistency — the "# ADR-NNN" H1 in each ADR file
#       must match the ADR-NNN in its filename
#
# Catches the 2026-07-13 incident: three ADRs all claimed ADR-044, sed
# renames in src/ were left half-done, and the AISVS file self-referenced
# its own old un-prefixed name in three places.
#
# Reference: 2026-07-13 ADR-renumber incident, see AWARE-FIX-2026-07-13
# (and the re-fix that this script would have caught at the gate).
if [[ -d docs/adr ]]; then
    echo "🔍 Checking docs/adr/ for ADR number uniqueness and consistency..."

    # (a) + (b): filename uniqueness and pattern
    # Use the working tree (not git ls-files) because the ADRs in this repo
    # are written straight to disk by the architect and not yet committed
    # at the time the pre-commit check would fire. Include both tracked
    # files and untracked-but-present files.
    ADR_FILES=$( (git ls-files docs/adr/ 2>/dev/null || true) | grep -E "^docs/adr/.*\.md$" || true)
    # Also include any .md files in docs/adr/ that exist on disk but are
    # not yet tracked. This is the 2026-07-13 case: the 4 ADR files
    # (043/045/046/047) are untracked in git but present on disk.
    ADR_DISK=$( (find docs/adr -maxdepth 1 -type f -name "*.md" 2>/dev/null || true) | sort || true)
    ALL_ADR_FILES=$(printf "%s\n%s\n" "$ADR_FILES" "$ADR_DISK" | sort -u | grep -v '^$' || true)

    # (a): filename uniqueness — no two files may share the same ADR-NNN
    # Use awk to extract ADR-NNN per file, count occurrences, and report
    # those with count > 1. Single-pass, no subshell issues.
    DUP_NUMS=$(echo "$ALL_ADR_FILES" | awk '
        {
            n = match($0, /ADR-[0-9]+/)
            if (n > 0) {
                num = substr($0, RSTART, RLENGTH)
                counts[num]++
            }
        }
        END {
            for (num in counts) {
                if (counts[num] > 1) {
                    print num
                }
            }
        }
    ' | sort)
    if [[ -n "$DUP_NUMS" ]]; then
        echo "❌ Duplicate ADR numbers in docs/adr/ filenames:"
        echo "$DUP_NUMS" | sed 's/^/    /'
        echo "   Each ADR must have a unique ADR-NNN prefix."
        FAILED=1
    fi

    # (b): every ADR file must have the ADR-NNN- prefix, with explicit
    # exemptions for files the operator has marked as intentionally
    # un-numbered. The opt-out marker can be in the H1 or the first
    # 3 lines (front matter), whichever the author prefers.
    UNPREFIXED=$(echo "$ALL_ADR_FILES" | awk '
        /ADR-[0-9]+/ { next }  # has the prefix, skip
        /^$/ { next }            # empty line, skip
        { print }
    ' | while read f; do
        if [[ -n "$f" ]] && head -3 "$f" 2>/dev/null | grep -qE "ADR-number: skipped"; then
            :  # opted out
        else
            echo "$f"
        fi
    done || true)
    # Note: the inner while loop uses ":" and explicit echo so set -e
    # does not abort on the empty case (no unprefixed files).
    if [[ -n "$UNPREFIXED" ]]; then
        echo "❌ ADR file(s) missing the ADR-NNN- prefix:"
        echo "$UNPREFIXED" | sed 's/^/    /'
        echo "   Rename to ADR-NNN-<slug>.md (use the next free number), or add"
        echo "   '## ADR-number: skipped' to the H1 to opt out of the prefix rule."
        FAILED=1
    fi

    # (e): H1 <-> filename consistency
    # For each ADR file, the "# ADR-NNN" H1 must match the ADR-NNN in its filename
    for f in $ALL_ADR_FILES; do
        # Only check files that have the ADR-NNN- prefix
        if echo "$f" | grep -qE "ADR-[0-9]+"; then
            file_num=$(basename "$f" | grep -oE "ADR-[0-9]+" | head -1)
            h1_num=$(head -3 "$f" 2>/dev/null | grep -oE "ADR-[0-9]+" | head -1 || echo "")
            if [[ -z "$h1_num" ]]; then
                echo "❌ $f: H1 / front matter does not contain '# ADR-NNN'"
                FAILED=1
            elif [[ "$file_num" != "$h1_num" ]]; then
                echo "❌ $f: filename has $file_num but H1 says $h1_num"
                FAILED=1
            fi
        fi
    done

    # (c) + (d): staged content must not reference old names or numbers
    # Look at the staged diff (new + modified) for stale references
    STAGED_CONTENT=$(git diff --cached --diff-filter=AM 2>/dev/null || true)
    if [[ -n "$STAGED_CONTENT" ]]; then
        # (c) Stale un-prefixed filename in any tracked file
        if echo "$STAGED_CONTENT" | grep -qE "AISVS-coverage\.md|ADR-044-asi06-coverage\.md|ADR-044-aware-atlas"; then
            echo "❌ Stale ADR filename reference in staged content."
            echo "   Found one of: AISVS-coverage.md, ADR-044-asi06-coverage.md,"
            echo "   ADR-044-aware-atlas*. Update refs to the current filenames."
            FAILED=1
        fi
    fi

    # (d) Stale ADR-NNN in tracked content. We grep the WORKING TREE
    # (not git ls-files) so we catch uncommitted changes that left
    # stale ADR-044 text. The check looks at all files in the repo
    # minus a small exemption list (this check script itself, fix-history
    # docs that legitimately cite the historical number).
    #
    # The exemption is a file path glob, not a content match — keeps
    # the rule auditable.
    # Grep the working tree (find on disk, not git ls-files). We include:
    #   - the repo root (CONTRIBUTING.md, AGENTS.md, README.md, etc. —
    #     these frequently reference ADRs and need to be checked)
    #   - docs/ (especially docs/adr/)
    #   - src/ (the AWARE source)
    #   - test/ and tests/ (unit tests)
    #   - scripts/ (the check itself)
    # and exclude node_modules, .git, dist, coverage.
    # Use -maxdepth 1 for the root to avoid recursing into directories
    # we already enumerate explicitly below.
    # Default to empty string so set -u doesn't trip on a no-match.
    STALE_FILES=""
    while IFS= read -r f; do
        [[ -n "$f" ]] || continue
        STALE_FILES+="$f"$'\n'
    done < <(find . -maxdepth 1 -type f \
        -not -path "*/node_modules/*" \
        -not -path "*/.git/*" \
        -not -name "pre-commit-check.sh" \
        -not -name "AWARE-FIX-2026-07-13.md" \
        2>/dev/null; \
        find docs src test tests scripts \
        -type f \
        -not -path "*/node_modules/*" \
        -not -path "*/.git/*" \
        -not -path "*/dist/*" \
        -not -path "*/coverage/*" \
        -not -name "pre-commit-check.sh" \
        -not -name "AWARE-FIX-2026-07-13.md" \
        2>/dev/null)
    # Now grep the gathered list. If empty, grep returns nothing and
    # STALE_FILES stays empty. Use grep -l to print filenames only.
    if [[ -n "$STALE_FILES" ]]; then
        STALE_FILES=$(echo "$STALE_FILES" | xargs grep -lE "ADR-044" 2>/dev/null || true)
    fi
    # Trim trailing whitespace
    STALE_FILES="${STALE_FILES%$'\n'}"
    if [[ -n "$STALE_FILES" ]]; then
        echo "❌ Stale ADR-044 reference(s) found in working tree:"
        echo "$STALE_FILES" | head -20 | sed 's/^/    /'
        echo "   ADR-044 was the 2026-07-13 collision; renumber to the"
        echo "   current ADR-NNN for that spec (e.g. ADR-045 for ASI06,"
        echo "   ADR-046 for AISVS, ADR-047 for ATLAS)."
        FAILED=1
    fi
fi

if [[ $FAILED -eq 0 ]]; then
    echo "✅ All privacy filter checks passed"
    exit 0
else
    echo ""
    echo "Privacy filter blocked this commit. See docs/security/history-rewrites.md for context."
    exit 1
fi
