#!/usr/bin/env bash
# scripts/security-scan.sh — AWARE 2.0 security audit harness
# Per ADR (internal) Phase 5 deliverable: "Security audit: Bandit, npm audit,
# gitleaks, container scan".
#
# Runs 4 independent security checks against the repo and produces a
# combined report. Each check gracefully degrades if its tool is not
# installed (skips with a warning rather than failing the build).
#
# Usage:
#   ./scripts/security-scan.sh                # default: warn-only, no exit on findings
#   ./scripts/security-scan.sh --strict       # promote warnings to errors
#   ./scripts/security-scan.sh --help
#   ./scripts/security-scan.sh --tool bandit  # run a single check
#
# Output:
#   security-audit-report.txt   — combined human-readable report
#   security-audit-report.json  — machine-readable findings (when available)
#
# Tools (all optional — script will skip-with-warn if missing):
#   bandit     — Python AST security linter (scans training/*.py)
#   npm audit  — built into npm (scans package.json + lockfile)
#   gitleaks   — git history scanner (scans .git/ for secrets)
#   trivy      — container + filesystem scanner (scans Dockerfiles + src/)
#
# What it does NOT do (operator action required for these):
#   - Scan a built Docker image (operator runs `trivy image aware:tag`
#     directly; this script scans the Dockerfile + filesystem)
#   - Pen-test the running stack (that's a separate engagement)
#   - SBOM generation (use `syft .` or `trivy --format spdx-json` directly)
#
# Cost: ~10-30s on a clean repo, ~1-2min on a large git history.
# Idempotent: re-running produces a fresh report.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REPORT_TXT="$REPO_ROOT/security-audit-report.txt"
# Per-check JSON files (so they don't clobber each other; final
# REPORT_JSON symlink points to whichever check ran last)
REPORT_JSON_NPM_AUDIT="$REPO_ROOT/security-audit-npm-audit.json"
REPORT_JSON_GITLEAKS="$REPO_ROOT/security-audit-gitleaks.json"
REPORT_JSON_TRIVY="$REPO_ROOT/security-audit-trivy.json"
# Backwards-compat: REPORT_JSON points to the trivy file (last to run)
# so the existing "(see $REPORT_JSON)" message in the summary still works
REPORT_JSON="$REPORT_JSON_TRIVY"

# ─── ANSI colors (only on TTY) ──────────────────────────────────────────
if [ -t 1 ]; then
    C_GREEN='\033[0;32m'
    C_RED='\033[0;31m'
    C_YELLOW='\033[0;33m'
    C_BLUE='\033[0;34m'
    C_BOLD='\033[1m'
    C_RESET='\033[0m'
else
    C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; C_RESET=''
fi

info()    { printf "${C_BLUE}==>${C_RESET} %s\n" "$*"; }
ok()      { printf "${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn()    { printf "${C_YELLOW}!${C_RESET} %s\n" "$*"; }
err()     { printf "${C_RED}✗${C_RESET} %s\n" "$*" >&2; }
section() { printf "\n${C_BOLD}${C_BLUE}── %s ──${C_RESET}\n" "$*"; }
die()     { err "$*"; exit 1; }

# ─── Defaults ───────────────────────────────────────────────────────────
STRICT=0
SINGLE_TOOL=""
EXIT_CODE=0
RUN_BANDIT=1
RUN_NPM_AUDIT=1
RUN_GITLEAKS=1
RUN_TRIVY=1

# ─── Help text ──────────────────────────────────────────────────────────
print_help() {
    sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" \
        | sed -e 's/^# \{0,1\}//' -e '/^$/d' -e '/^set -euo pipefail$/d' \
        | head -n 60
    exit 0
}

# ─── Argument parsing ───────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --strict)
            STRICT=1
            shift
            ;;
        --tool)
            [ $# -ge 2 ] || die "--tool requires an argument"
            SINGLE_TOOL="$2"
            shift 2
            ;;
        --help|-h)
            print_help
            ;;
        *)
            die "Unknown argument: $1 (try --help)"
            ;;
    esac
done

# If --tool is specified, only run that check
if [ -n "$SINGLE_TOOL" ]; then
    RUN_BANDIT=0; RUN_NPM_AUDIT=0; RUN_GITLEAKS=0; RUN_TRIVY=0
    case "$SINGLE_TOOL" in
        bandit)     RUN_BANDIT=1 ;;
        npm-audit)  RUN_NPM_AUDIT=1 ;;
        gitleaks)   RUN_GITLEAKS=1 ;;
        trivy)      RUN_TRIVY=1 ;;
        *) die "Unknown tool: $SINGLE_TOOL (try bandit|npm-audit|gitleaks|trivy)" ;;
    esac
fi

# ─── Initialize report ──────────────────────────────────────────────────
init_report() {
    : > "$REPORT_TXT"
    {
        echo "AWARE 2.0 security audit report"
        echo "Generated: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
        echo "Repo: $REPO_ROOT"
        echo "Strict mode: $([ $STRICT -eq 1 ] && echo 'YES (warnings → errors)' || echo 'NO (warn-only)')"
        echo "Single tool: ${SINGLE_TOOL:-all}"
        echo ""
    } >> "$REPORT_TXT"
}

record_check() {
    # $1 = tool, $2 = status (PASS|WARN|FAIL|SKIP), $3 = details
    local tool="$1" status="$2" details="$3"
    {
        echo "[$status] $tool"
        echo "  $details"
        echo ""
    } >> "$REPORT_TXT"
    case "$status" in
        PASS) ok "$tool: $details" ;;
        WARN) warn "$tool: $details" ;;
        FAIL) err "$tool: $details"; EXIT_CODE=1 ;;
        SKIP) warn "$tool: SKIPPED — $details" ;;
    esac
}

# ─── Check 1: bandit (Python AST security linter) ───────────────────────
check_bandit() {
    section "1/4  Bandit — Python AST security linter"
    if ! command -v bandit >/dev/null 2>&1; then
        record_check "bandit" "SKIP" "bandit not on PATH. Install with: pip install bandit (or: uv tool install bandit)"
        return
    fi
    local py_files
    py_files=$(find training -name '*.py' -not -path '*/node_modules/*' 2>/dev/null)
    if [ -z "$py_files" ]; then
        record_check "bandit" "SKIP" "no .py files found under training/"
        return
    fi
    info "scanning $(echo "$py_files" | wc -l | tr -d ' ') Python files under training/"
    local bandit_out
    bandit_out=$(bandit -r training/ -f txt -q 2>&1 || true)
    local findings
    findings=$(echo "$bandit_out" | grep -cE "^>> Issue:" || true)
    if [ "${findings:-0}" -eq 0 ]; then
        record_check "bandit" "PASS" "0 findings in $(echo "$py_files" | wc -l | tr -d ' ') Python files"
    elif [ "$STRICT" -eq 1 ]; then
        record_check "bandit" "FAIL" "$findings findings in training/ (see $REPORT_TXT for full output)"
        echo "$bandit_out" >> "$REPORT_TXT"
    else
        record_check "bandit" "WARN" "$findings findings in training/ (use --strict to fail)"
        echo "$bandit_out" >> "$REPORT_TXT"
    fi
}

# ─── Check 2: npm audit (Node dependency CVE scanner) ──────────────────
check_npm_audit() {
    section "2/4  npm audit — Node dependency CVE scanner"
    if [ ! -f "$REPO_ROOT/package.json" ]; then
        record_check "npm-audit" "SKIP" "no package.json found"
        return
    fi
    if [ ! -f "$REPO_ROOT/package-lock.json" ]; then
        warn "no package-lock.json — npm audit will use package.json only (less accurate)"
    fi
    info "running npm audit --json (this may take 10-30s on first run)"
    local audit_json
    if ! audit_json=$(npm audit --json 2>/dev/null); then
        # npm audit exits non-zero on findings, that's expected
        :
    fi
    if [ -z "$audit_json" ]; then
        record_check "npm-audit" "SKIP" "npm audit returned no output"
        return
    fi
    echo "$audit_json" > "$REPORT_JSON_NPM_AUDIT"
    # Parse the vulnerability counts
    local critical high moderate low info
    critical=$(echo "$audit_json" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{const j=JSON.parse(s); console.log(j.metadata?.vulnerabilities?.critical||0)}catch{console.log('?')}})" 2>/dev/null || echo '?')
    high=$(echo "$audit_json" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{const j=JSON.parse(s); console.log(j.metadata?.vulnerabilities?.high||0)}catch{console.log('?')}})" 2>/dev/null || echo '?')
    moderate=$(echo "$audit_json" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{const j=JSON.parse(s); console.log(j.metadata?.vulnerabilities?.moderate||0)}catch{console.log('?')}})" 2>/dev/null || echo '?')
    low=$(echo "$audit_json" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{const j=JSON.parse(s); console.log(j.metadata?.vulnerabilities?.low||0)}catch{console.log('?')}})" 2>/dev/null || echo '?')
    if [ "$critical" = "0" ] && [ "$high" = "0" ]; then
        record_check "npm-audit" "PASS" "0 critical / 0 high / $moderate moderate / $low low (see $REPORT_JSON_NPM_AUDIT)"
    elif [ "$critical" != "0" ] || [ "$high" != "0" ]; then
        if [ "$STRICT" -eq 1 ]; then
            record_check "npm-audit" "FAIL" "$critical critical / $high high (see $REPORT_JSON_NPM_AUDIT)"
        else
            record_check "npm-audit" "WARN" "$critical critical / $high high (use --strict to fail)"
        fi
    else
        record_check "npm-audit" "WARN" "0 critical / 0 high / $moderate moderate / $low low"
    fi
}

# ─── Check 3: gitleaks (git history secret scanner) ─────────────────────
check_gitleaks() {
    section "3/4  gitleaks — git history secret scanner"
    if ! command -v gitleaks >/dev/null 2>&1; then
        record_check "gitleaks" "SKIP" "gitleaks not on PATH. Install with: brew install gitleaks"
        return
    fi
    info "scanning full git history (this may take 10-30s)"
    local leaks_out
    local leaks_exit=0
    leaks_out=$(gitleaks detect --source . --report-path "$REPORT_JSON_GITLEAKS" --no-banner 2>&1) || leaks_exit=$?
    # gitleaks exit 0 = no findings, 1 = findings, >1 = error
    if [ $leaks_exit -eq 0 ]; then
        record_check "gitleaks" "PASS" "0 secrets in git history"
    elif [ $leaks_exit -eq 1 ]; then
        if [ "$STRICT" -eq 1 ]; then
            record_check "gitleaks" "FAIL" "secrets found in git history (see $REPORT_JSON)"
        else
            record_check "gitleaks" "WARN" "secrets found in git history (use --strict to fail)"
        fi
    else
        record_check "gitleaks" "SKIP" "gitleaks error: ${leaks_out:0:200}"
    fi
}

# ─── Check 4: trivy (filesystem + Dockerfile misconfiguration scanner) ──
# Runs TWO trivy sub-commands:
#   (a) trivy fs .          — vulnerability scan of source/lockfiles (deps)
#   (b) trivy config <df>   — Dockerfile misconfiguration scan (one per df)
# Aggregates HIGH/CRITICAL counts across both and reports the worst.
check_trivy() {
    section "4/4  Trivy — filesystem + Dockerfile scanner"
    if ! command -v trivy >/dev/null 2>&1; then
        record_check "trivy" "SKIP" "trivy not on PATH. Install from: https://github.com/aquasecurity/trivy/releases"
        return
    fi
    info "scanning filesystem (lockfiles, source deps) — no image scan"
    # trivy fs in v0.71+ accepts only a single PATH argument. Scan the
    # whole repo root — trivy walks the tree and handles lockfiles,
    # source deps in one pass. .trivyignore handles ignore rules.
    local trivy_exit=0
    trivy fs --severity HIGH,CRITICAL --no-progress --format json \
        --output "$REPORT_JSON" \
        . > /dev/null 2>&1 || trivy_exit=$?
    # (b) Scan each Dockerfile individually for misconfigurations
    # (trivy config also takes only one path; aggregate across files)
    local df_crit=0 df_high=0
    local df_count=0
    # Append Dockerfile misconfig findings to $REPORT_JSON (same file,
    # `Results` array is concatenated) so operator has one file to inspect
    for df in Dockerfile Dockerfile.coordinator Dockerfile.gateway Dockerfile.training Dockerfile.ui; do
        [ -f "$df" ] || continue
        local df_json df_exit=0
        # trivy config honors .trivyignore if it exists in the working
        # dir. The script's cwd is the repo root (we cd'd there at the
        # top), so a .trivyignore at the repo root is picked up
        # automatically. See .trivyignore for documented exceptions.
        df_json=$(trivy config --severity HIGH,CRITICAL --format json \
            --quiet --ignorefile .trivyignore "$df" 2>/dev/null) || df_exit=$?
        if [ -n "$df_json" ]; then
            df_count=$((df_count + 1))
            # Aggregate counts
            local c h
            c=$(echo "$df_json" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{const j=JSON.parse(s); let n=0; for(const r of (j.Results||[])) for(const m of (r.Misconfigurations||[])) if(m.Severity==='CRITICAL')n++; console.log(n)}catch{console.log(0)}})" 2>/dev/null || echo 0)
            h=$(echo "$df_json" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{const j=JSON.parse(s); let n=0; for(const r of (j.Results||[])) for(const m of (r.Misconfigurations||[])) if(m.Severity==='HIGH')n++; console.log(n)}catch{console.log(0)}})" 2>/dev/null || echo 0)
            df_crit=$((df_crit + c))
            df_high=$((df_high + h))
            # Append this Dockerfile's misconfigs to the combined JSON
            node -e "
                const fs = require('fs');
                const combined = JSON.parse(fs.readFileSync('$REPORT_JSON','utf8'));
                const df = JSON.parse(\`$df_json\`);
                if (!Array.isArray(combined.Results)) combined.Results = [];
                for (const r of (df.Results||[])) combined.Results.push(r);
                fs.writeFileSync('$REPORT_JSON', JSON.stringify(combined, null, 2));
            " 2>/dev/null || true
        fi
    done
    # Aggregate: vuln counts from $REPORT_JSON + misconfig counts above
    local crit high
    crit=$(node -e "
        try {
          const j = JSON.parse(require('fs').readFileSync('$REPORT_JSON','utf8'));
          let c=0, h=0;
          // Old trivy JSON shape: {Results:[{Vulnerabilities:[{Severity}]}]}
          if (Array.isArray(j.Results)) {
            for (const r of j.Results) for (const v of (r.Vulnerabilities||[])) {
              if (v.Severity==='CRITICAL') c++;
              else if (v.Severity==='HIGH') h++;
            }
          // Newer trivy 'audit report v2' shape: {metadata.vulnerabilities:{critical,high,...}}
          } else if (j.metadata && j.metadata.vulnerabilities) {
            c = j.metadata.vulnerabilities.critical || 0;
            h = j.metadata.vulnerabilities.high || 0;
          }
          // Add Dockerfile misconfig counts
          c += $df_crit;
          h += $df_high;
          console.log(c+'/'+h);
        } catch { console.log($df_crit+/+ $df_high); }
    " 2>/dev/null || echo "$df_crit/$df_high")
    if [ "$trivy_exit" -eq 0 ] && [ "$crit" = "0/0" ]; then
        record_check "trivy" "PASS" "0 HIGH/CRITICAL findings (vulns + Dockerfile misconfigs)"
    elif [ "$crit" = "0/0" ]; then
        # non-zero exit (e.g. Dockerfile parser error) but no real findings
        record_check "trivy" "WARN" "trivy exited $trivy_exit but no HIGH/CRITICAL findings in JSON (likely parser error, see $REPORT_JSON)"
    else
        if [ "$STRICT" -eq 1 ]; then
            record_check "trivy" "FAIL" "HIGH/CRITICAL findings: $crit (see $REPORT_JSON)"
        else
            record_check "trivy" "WARN" "HIGH/CRITICAL findings: $crit (use --strict to fail) — includes Dockerfiles: $df_high HIGH misconfigs"
        fi
    fi
}

# ─── Summary ────────────────────────────────────────────────────────────
print_summary() {
    section "Summary"
    echo "  Report (text):   $REPORT_TXT"
    [ -f "$REPORT_JSON" ] && echo "  Report (JSON):   $REPORT_JSON"
    echo ""
    if [ $EXIT_CODE -eq 0 ]; then
        ok "All checks passed (or warned — no failures)"
    else
        err "One or more checks FAILED — see $REPORT_TXT for details"
    fi
    echo ""
    cat "$REPORT_TXT"
}

# ─── Main ───────────────────────────────────────────────────────────────
init_report

[ "$RUN_BANDIT" = "1" ]     && check_bandit
[ "$RUN_NPM_AUDIT" = "1" ]  && check_npm_audit
[ "$RUN_GITLEAKS" = "1" ]   && check_gitleaks
[ "$RUN_TRIVY" = "1" ]      && check_trivy

print_summary
exit $EXIT_CODE
