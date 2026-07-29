# AGENTS.md — AWARE agent operating rules

This file is read by AI agents (architect, coder, etc.) at session start.
It encodes the few conventions the agents must follow that humans can
assume are obvious. CONTRIBUTING.md is the human-facing equivalent and
is the source of truth for full conventions; this file is the terse
agent-side subset.

## Hard rules

1. **Never commit a file that would fail `scripts/pre-commit-check.sh`.**
   The check is the gate. If it fails, fix the underlying problem; do
   not bypass with `--no-verify`. The check enforces:
   - ADR numbering (no duplicates, prefix required, H1 matches filename,
     no stale references to retired ADR numbers after renames). See
     CONTRIBUTING.md §"Creating a new ADR" for the rules.
   - Privacy filter (host paths in docs/audits, LAN IPs in STATUS.md,
     data/*.json shape). Pre-existing checks; do not weaken.
   - For renames: sed-replace the OLD ADR-NNN across `docs/adr/`, `src/`,
     and `test/` in a single pass. The check's stale-reference rule will
     block the commit if any reference is missed.

2. **Before creating a new ADR, run:**
   ```bash
   ls docs/adr/ | grep -oE "ADR-[0-9]+" | sort -V | tail -1
   ```
   Then use **next + 1** as your ADR-NNN. Never reuse a number.

3. **When writing an ADR:**
   - Filename: `ADR-NNN-aware-<short-slug>.md` (the `-aware-` is required)
   - H1: `# ADR-NNN — <Title>` (number must match filename)
   - First 3 lines of front matter: `**Status:**`, `**Author:**`,
     `**Reviewers:**` (at minimum)

4. **For un-numbered docs in `docs/adr/`** (positioning memos, etc.):
   add `**ADR-number: skipped**` in the first 3 lines of front matter
   to opt out of the prefix rule. The check enforces this.

5. **The pre-commit check is the audit trail.** It must stay under
   `scripts/pre-commit-check.sh` and remain runnable as a standalone
   shell script. Do not split it across multiple files; do not move
   the logic into a Node tool; do not gate it behind a package manager
   step that may not be installed.

   The check's stale-reference rule exempts exactly two files: the
   check script itself, and the historical fix record at
   `docs/adr/AWARE-FIX-2026-07-13.md`. Any other reference to a
   retired ADR number anywhere in the repo is a regression and
   will block the next commit.

## State you may need

- **`docs/adr/`** — all ADRs. Highest number on disk = next available
  number. The check enforces this at commit time, but you need to know
  it earlier when *drafting* an ADR (before commit).
- **`scripts/pre-commit-check.sh`** — the gate. Read this file to
  understand what the check enforces. Don't extend the check without
  a separate ADR for the change to the gate itself.
- **`CONTRIBUTING.md`** §"Creating a new ADR" — full authoring rules
  (filename pattern, cross-reference format, exemption list).

## What the pre-commit check does NOT catch

- **Logic errors** in ADRs (e.g. wrong design choice, missing
  failure-mode section). Reviewers (Coder, Critic, Sentinel) catch
  these at review time.
- **Stale cross-references to non-ADR content** (e.g. a renamed file
  in `src/` referenced by an old number that no longer exists). The
  check only enforces the ADR-numbering invariant.
- **The first commit of a new ADR** is not gated by the stale check
  (the stale check only fires on a *change* to the working tree).
  Authors must verify their own cross-refs are right at draft time.

## Failure-mode reporting

If the pre-commit check fails, the error message names the file and
the rule. Read the error, fix the file, re-stage, re-commit. Do not
"disable the rule" as a fix. If the rule itself is wrong, that's a
separate ADR for the check's design.
# dummy change

<!-- updated by architect 2026-07-13 -->
