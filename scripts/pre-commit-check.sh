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
#
# Catches the 2026-07-13 incident: three ADRs all claimed the same number
# in a 5-minute drafting window. The check enforces:
#   (a) Filename uniqueness — no two files in docs/adr/ share the same ADR-NNN
#   (b) Filename pattern — every ADR file must match ADR-NNN-<slug>.md
#       (un-prefixed form "foo-coverage.md" is a known failure mode)
#   (c) Stale-name check — staged content must not reference the old
#       un-prefixed filename after a rename
#   (d) Stale-number check — no file in the working tree (except the
#       check script itself and the historical fix doc) may reference
#       any retired ADR number
#   (e) H1 <-> filename consistency — the "# ADR-NNN" H1 must match
#       the ADR-NNN in its filename
#
# The retired numbers list is data, not hard-coded. New retirements get
# appended to RETIRED_ADR_NUMBERS below. The historical fix record at
# docs/adr/AWARE-FIX-2026-07-13.md documents the original incident and
# is the only place where a retired number may legitimately appear in
# the working tree (it's exempted by the file path glob).
#
# Reference: 2026-07-13 ADR-renumber incident, see
# docs/adr/AWARE-FIX-2026-07-13.md for the full history.
if [[ -d docs/adr ]]; then
    echo "🔍 Checking docs/adr/ for ADR number uniqueness and consistency..."

    # ── Retired ADR numbers ───────────────────────────────────────────
    # Add new retirements here, one per line. The format is "NNN" (the
    # numeric part only; the "ADR-" prefix is added by the rule).
    #
    # Currently retired:
    #   044 — 2026-07-13 three-way collision (ASI06/AISVS/ATLAS);
    #          see docs/adr/AWARE-FIX-2026-07-13.md
    RETIRED_ADR_NUMBERS=(
        "044"
    )

    # The check script itself is the only file in scripts/ that may
    # contain a reference to a retired number (because the rule's grep
    # pattern is the retired number). The fix-history doc is the
    # canonical place where retired numbers are documented.
    RETIRED_EXEMPT_FILES=(
        "scripts/pre-commit-check.sh"
        "docs/adr/AWARE-FIX-2026-07-13.md"
    )
    # Build the grep alternation for the retired numbers
    RETIRED_GREP_ALT=""
    for n in "${RETIRED_ADR_NUMBERS[@]}"; do
        if [[ -n "$RETIRED_GREP_ALT" ]]; then
            RETIRED_GREP_ALT+="|"
        fi
        RETIRED_GREP_ALT+="ADR-${n}"
    done
    # Build the basename alternation for the find -not -name args
    RETIRED_EXEMPT_BASENAMES=()
    for f in "${RETIRED_EXEMPT_FILES[@]}"; do
        RETIRED_EXEMPT_BASENAMES+=(-not -name "$(basename "$f")")
    done
    # Build the find -name filters for the staged-content exempt
    # (matched against the diff --git a/ path)
    RETIRED_STAGED_EXEMPT_RE=""
    for f in "${RETIRED_EXEMPT_FILES[@]}"; do
        if [[ -n "$RETIRED_STAGED_EXEMPT_RE" ]]; then
            RETIRED_STAGED_EXEMPT_RE+="|"
        fi
        RETIRED_STAGED_EXEMPT_RE+="a/$(basename "$f")"
    done

    # (a) + (b): filename uniqueness and pattern
    # Use the working tree (not git ls-files) because the ADRs in this repo
    # are written straight to disk by the architect and not yet committed
    # at the time the pre-commit check would fire. Include both tracked
    # files and untracked-but-present files.
    ADR_FILES=$( (git ls-files docs/adr/ 2>/dev/null || true) | grep -E "^docs/adr/.*\.md$" || true)
    # Also include any .md files in docs/adr/ that exist on disk but are
    # not yet tracked. The 2026-07-13 case: 4 ADR files were untracked
    # in git but present on disk when the original collision happened.
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

    # (c) Stale-name check: staged content must not reference the
    # un-prefixed filenames that resulted from the original collision.
    # Built from the retired numbers list (any file named
    # "ADR-NNN-<slug>.md" that was renamed, plus the AISVS un-prefixed
    # form that was the original failure mode).
    #
    # The regex is tight: ADR-NNN- followed by a lowercase word then
    # .md. This avoids matching prose like "ADR-044-aware-atlas" that
    # appears in a comment or commit message (the comment doesn't end
    # in .md, so it's not a filename reference).
    STALE_NAME_PATTERNS=(
        "AISVS-coverage\.md"
    )
    for n in "${RETIRED_ADR_NUMBERS[@]}"; do
        STALE_NAME_PATTERNS+=("ADR-${n}-[a-z][a-z0-9-]*\.md")
    done
    STALE_NAME_GREP=$(printf "%s|" "${STALE_NAME_PATTERNS[@]}")
    STALE_NAME_GREP="${STALE_NAME_GREP%|}"

    # (c) + (d) need to look at staged content too, to catch the
    # half-done sed case. We exclude exempted files from the scan.
    # We only look at ADDED lines (+) of the diff, not removed (-)
    # lines: the (c) rule is about new code that still references old
    # filenames; old code being deleted is fine and would otherwise
    # produce false positives when this script itself is being refactored.
    STAGED_CONTENT=$(git diff --cached --diff-filter=AM 2>/dev/null || true)
    if [[ -n "$STAGED_CONTENT" ]]; then
        # Strip exempted files out of the staged diff
        STAGED_CONTENT_FILTERED=$(echo "$STAGED_CONTENT" | awk -v exempt="$RETIRED_STAGED_EXEMPT_RE" '
            /^diff --git/ {
                skip = ($0 ~ ("a/(" exempt ") b/")) ? 1 : 0
            }
            !skip
        ')
        # Only added lines (start with "+" but not "+++" which is the
        # diff header)
        STAGED_ADDED=$(echo "$STAGED_CONTENT_FILTERED" | grep -E "^\+[^+]" || true)
        # (c) Stale filename in staged content
        if echo "$STAGED_ADDED" | grep -qE "$STALE_NAME_GREP"; then
            echo "❌ Stale ADR filename reference in staged content."
            echo "   Found one of the retired un-prefixed filenames."
            echo "   Update refs to the current filenames."
            FAILED=1
        fi
    fi

    # (d) Stale-number check: any file in the working tree (except
    # exempted files) may NOT contain a reference to a retired number.
    # Default to empty so set -u doesn't trip.
    STALE_FILES=""
    while IFS= read -r f; do
        [[ -n "$f" ]] || continue
        STALE_FILES+="$f"$'\n'
    done < <(find . -maxdepth 1 -type f \
        -not -path "*/node_modules/*" \
        -not -path "*/.git/*" \
        "${RETIRED_EXEMPT_BASENAMES[@]}" \
        2>/dev/null; \
        find docs src test tests scripts \
        -type f \
        -not -path "*/node_modules/*" \
        -not -path "*/.git/*" \
        -not -path "*/dist/*" \
        -not -path "*/coverage/*" \
        "${RETIRED_EXEMPT_BASENAMES[@]}" \
        2>/dev/null)
    if [[ -n "$STALE_FILES" ]]; then
        STALE_FILES=$(echo "$STALE_FILES" | xargs grep -lE "$RETIRED_GREP_ALT" 2>/dev/null || true)
    fi
    STALE_FILES="${STALE_FILES%$'\n'}"
    if [[ -n "$STALE_FILES" ]]; then
        echo "❌ Stale retired-ADR reference(s) found in working tree:"
        echo "$STALE_FILES" | head -20 | sed 's/^/    /'
        echo "   The following ADR numbers are retired (no new file may claim them):"
        for n in "${RETIRED_ADR_NUMBERS[@]}"; do
            echo "     - ADR-${n}"
        done
        echo "   See docs/adr/AWARE-FIX-2026-07-13.md for the history."
        echo "   Update the file to use a current ADR-NNN."
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
