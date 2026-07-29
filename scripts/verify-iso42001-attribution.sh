#!/usr/bin/env bash
# scripts/verify-iso42001-attribution.sh
#
# Verify the attribution block in src/compliance/iso42001-catalog.js
# has not drifted from the ADR-055 §D2 template.
#
# Per ADR-055 §D2 ("the catalog header must carry the exact attribution
# string from §License posture. A CI check (scripts/verify-iso42001-attribution.sh)
# parses the header and fails the build if the attribution block drifts"),
# this script is the load-bearing CI guard for the ISO/IEC 42001 license
# posture. Losing the attribution block is a license violation, not a style
# drift.
#
# Usage:
#   bash scripts/verify-iso42001-attribution.sh         # exit 0 on match, 1 on drift
#
# The check verifies four invariants:
#   1. SPDX header is "Apache-2.0" (catalog is AWARE-authored code per ADR-055 §D2).
#   2. The "ISO/IEC 42001:2023" identifier appears in the attribution block.
#   3. The third-party source URL (ISMS.online annex-a-controls page) is cited.
#   4. The "NOT Creative Commons" disclaimer is present.
#   5. The "no certification claim" disclaimer is present.
#
# The check is conservative: if any of these invariants is missing, it fails.
# Operators may add additional prose around the attribution block, but the
# five invariants are mandatory.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG_PATH="${SCRIPT_DIR}/../src/compliance/iso42001-catalog.js"

if [[ ! -f "${CATALOG_PATH}" ]]; then
  echo "FAIL: catalog file not found at ${CATALOG_PATH}" >&2
  exit 1
fi

# Read the first 80 lines of the catalog — the attribution block is at the
# top of the file by convention. Collapse line breaks AND strip the `// `
# comment markers so cross-line phrases like "is NOT Creative\n// Commons"
# still match as "is NOT Creative Commons".
HEADER_BLOCK="$(head -n 80 "${CATALOG_PATH}" | sed 's|// ||g' | tr '\n' ' ' | tr -s ' ')"

FAIL_COUNT=0
fail() {
  echo "  ✗ $1" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

# 1. SPDX header must be Apache-2.0.
if grep -q '^// SPDX-License-Identifier: Apache-2.0$' "${CATALOG_PATH}"; then
  echo "  ✓ SPDX header is Apache-2.0"
else
  fail "SPDX header is NOT 'Apache-2.0' (catalog is AWARE-authored code per ADR-055 §D2)"
fi

# 2. ISO/IEC 42001:2023 identifier present.
if grep -qi 'ISO/IEC 42001:2023' <<<"${HEADER_BLOCK}"; then
  echo "  ✓ ISO/IEC 42001:2023 identifier present in attribution block"
else
  fail "ISO/IEC 42001:2023 identifier missing from attribution block"
fi

# 3. ISMS.online third-party source URL cited.
if grep -q 'isms.online/iso-42001/annex-a-controls' <<<"${HEADER_BLOCK}"; then
  echo "  ✓ ISMS.online third-party source URL cited"
else
  fail "ISMS.online URL missing — catalog has no third-party source citation (ADR-055 §D2)"
fi

# 4. "NOT Creative Commons" disclaimer present (case-insensitive).
if grep -qi 'NOT Creative Commons' <<<"${HEADER_BLOCK}"; then
  echo "  ✓ 'NOT Creative Commons' disclaimer present"
else
  fail "'NOT Creative Commons' disclaimer missing — ISO standards are not CC; missing disclaimer is a license violation"
fi

# 5. "no certification claim" disclaimer present (case-insensitive).
if grep -qi 'no .*certification.*claim\|not .*certif' <<<"${HEADER_BLOCK}"; then
  echo "  ✓ no-certification disclaimer present"
else
  fail "no-certification disclaimer missing — ADR-055 §'Scope statement' forbids certification claim"
fi

# 6. ISO normative text not reproduced. This is a soft check: we look for
#    common ISO-isms ('shall be', 'the organisation shall') in the catalog
#    body (lines past the header block). False positives are possible if a
#    description legitimately uses 'shall'; a manual review follows.
BODY="$(tail -n +81 "${CATALOG_PATH}")"
if grep -qi 'shall be documented\|the organisation shall\|the organization shall' <<<"${BODY}"; then
  fail "ISO-style 'shall' language detected in catalog body — review for normative-text drift"
else
  echo "  ✓ no ISO normative 'shall' language detected in catalog body"
fi

if [[ ${FAIL_COUNT} -eq 0 ]]; then
  echo "OK: iso42001-catalog.js attribution block matches ADR-055 §D2 template"
  exit 0
else
  echo "FAIL: ${FAIL_COUNT} attribution invariant(s) drifted from ADR-055 §D2" >&2
  exit 1
fi
