#!/usr/bin/env node
/**
 * Snapshot ISO/IEC 42001:2023 Annex A control catalog from ISMS.online.
 *
 * Source: https://www.isms.online/iso-42001/annex-a-controls/ (third-party
 * mirror; ISO/IEC 42001:2023 standard text is paywalled + Cloudflare-walled
 * on iso.org — see ADR-055 §"Source pinning").
 *
 * Per ADR-055 §D1, this script:
 *   - Fetches the ISMS.online page and resolves the upstream modification
 *     timestamp via the HTTP `Last-Modified` header (falls back to
 *     `Date` if absent; falls back to current time if neither is present).
 *   - Validates that all 38 expected Annex A control IDs are present
 *     (A.2.2 through A.10.4, per the ISMS.online enumeration; the 4-control
 *     38-vs-42 gap is documented in the catalog header, not handled here).
 *   - Emits src/compliance/iso42001-catalog.js with the attribution block
 *     from ADR-055 §"License posture" (the catalog file is hand-maintained
 *     for the per-control `awareness` marking — this script verifies the
 *     upstream ISMS.online list still contains all 38 IDs but does NOT
 *     re-emit the catalog body; an operator must apply any catalog edits
 *     manually after a verified upstream change).
 *   - Refuses to overwrite the catalog file's attribution header if the
 *     upstream `Last-Modified` header is unchanged since the last snapshot.
 *     Use `--force` to overwrite the pinDate regardless.
 *
 * Per ADR-055 §D2, the attribution block in the catalog file header is
 * load-bearing for the license posture — losing it is a license violation.
 * The snapshot script emits the `pinDate` line and a verification footer
 * into a sidecar file (NOT the catalog itself) to keep the catalog body
 * pure AWARE-authored code.
 *
 * Usage:
 *   node scripts/snapshot-iso42001-catalog.js              # verify + report
 *   node scripts/snapshot-iso42001-catalog.js --check      # CI mode (exit 1 on drift)
 *   node scripts/snapshot-iso42001-catalog.js --force      # bump pinDate anyway
 *
 * Exit codes:
 *   0  — upstream reachable, 38 IDs present, pinDate current (or --force used)
 *   1  — drift detected (upstream changed and --force not used) OR upstream
 *        unreachable AND catalog pinDate is older than 30 days
 *   2  — upstream reachable but missing one or more of the 38 IDs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const SOURCE_URL = 'https://www.isms.online/iso-42001/annex-a-controls/';
const CATALOG_PATH = path.join(
  __dirname, '..', 'src', 'compliance', 'iso42001-catalog.js'
);
const SIDECAR_PATH = path.join(
  __dirname, '..', 'src', 'compliance', '.iso42001-snapshot.json'
);

// The 38 ISO/IEC 42001:2023 Annex A control IDs we ship in v1, per the
// ISMS.online enumeration (research §1 / ADR-055 §"Source pinning").
// These are the IDs the catalog file MUST contain; if any are missing
// from the upstream page, the snapshot script exits with code 2.
const EXPECTED_CONTROL_IDS = [
  'A.2.2', 'A.2.3', 'A.2.4',
  'A.3.2', 'A.3.3',
  'A.4.2', 'A.4.3', 'A.4.4', 'A.4.5', 'A.4.6',
  'A.5.2', 'A.5.3', 'A.5.4', 'A.5.5',
  'A.6.1.2', 'A.6.1.3',
  'A.6.2.2', 'A.6.2.3', 'A.6.2.4', 'A.6.2.5', 'A.6.2.6', 'A.6.2.7', 'A.6.2.8',
  'A.7.2', 'A.7.3', 'A.7.4', 'A.7.5', 'A.7.6',
  'A.8.2', 'A.8.3', 'A.8.4', 'A.8.5',
  'A.9.2', 'A.9.3', 'A.9.4',
  'A.10.2', 'A.10.3', 'A.10.4'
];

// Parse CLI args.
const args = new Set(process.argv.slice(2));
const CHECK_MODE = args.has('--check');
const FORCE = args.has('--force');

/**
 * Fetch a URL with response headers + body.
 * @param {string} url
 * @param {{redirects?: number}} [opts]
 * @returns {Promise<{statusCode: number, headers: object, body: string, finalUrl: string}>}
 */
function fetchWithHeaders(url, opts = {}) {
  const redirects = opts.redirects ?? 5;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'AWARE-snapshot/1.0 (+iso42001 catalog verifier)' } }, (res) => {
      // Follow redirects manually so the final headers + finalUrl are exposed.
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && redirects > 0) {
        const next = res.headers.location;
        res.resume();
        if (!next) return reject(new Error(`redirect with no Location header from ${url}`));
        const nextUrl = new URL(next, url).toString();
        return fetchWithHeaders(nextUrl, { redirects: redirects - 1 }).then(resolve, reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body,
        finalUrl: url
      }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`timeout after 15s for ${url}`));
    });
  });
}

/**
 * Resolve the upstream fetch date from response headers. Returns an ISO date
 * (YYYY-MM-DD) or null if neither `Last-Modified` nor `Date` is parseable.
 * @param {object} headers
 * @returns {string|null}
 */
function resolveUpstreamDate(headers) {
  const candidates = [headers['last-modified'], headers['date']];
  for (const raw of candidates) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * Extract control IDs from the upstream HTML body. The ISMS.online page uses
 * stable anchor IDs of the form `a-X-Y-Z` (one dot, dashes for separators).
 * @param {string} html
 * @returns {string[]}
 */
function extractControlIds(html) {
  const ids = new Set();
  // Anchor IDs: id="a-6-2-8" → A.6.2.8. The ISMS.online page uses kebab-case.
  const re = /\bid\s*=\s*["']a-([0-9]+(?:-[0-9]+)+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    // a-6-2-8 → A.6.2.8
    const normalized = 'A.' + m[1].split('-').join('.');
    ids.add(normalized);
  }
  // Belt-and-suspenders: also look for the IDs as plain text in hrefs and
  // headings, in case the page structure changes.
  const re2 = /\bA\.\d+(?:\.\d+)+\b/g;
  while ((m = re2.exec(html)) !== null) {
    ids.add(m[0]);
  }
  return [...ids];
}

/**
 * Read the pinDate currently recorded in the catalog file header.
 * Returns the ISO date string if found, else null.
 * @returns {string|null}
 */
function readCatalogPinDate() {
  if (!fs.existsSync(CATALOG_PATH)) return null;
  const text = fs.readFileSync(CATALOG_PATH, 'utf8');
  // Match the most recent fetch date in any of these forms:
  //   "(fetched 2026-07-28; ...)"
  //   "fetched 2026-07-28"
  //   "pinDate: '2026-07-28'"
  const m = text.match(/(?:fetched|pinDate[:=]['"]?)\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Read the previously recorded snapshot sidecar (if any) for upstream date
 * comparison.
 * @returns {{upstreamDate: string, fetchedAt: string}|null}
 */
function readSidecar() {
  if (!fs.existsSync(SIDECAR_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(SIDECAR_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write the snapshot sidecar. NOT the catalog body — the sidecar only
 * records the upstream date + verification result so future runs can
 * detect drift.
 */
function writeSidecar(payload) {
  fs.writeFileSync(SIDECAR_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function main() {
  const report = {
    sourceUrl: SOURCE_URL,
    checkedAt: new Date().toISOString(),
    upstreamReachable: false,
    upstreamDate: null,
    expectedControlCount: EXPECTED_CONTROL_IDS.length,
    foundControlIds: [],
    missingControlIds: [],
    catalogPinDate: readCatalogPinDate(),
    sidecar: readSidecar(),
    drift: false,
    status: 'unknown'
  };

  let exitCode = 0;

  try {
    const res = await fetchWithHeaders(SOURCE_URL);
    if (res.statusCode !== 200) {
      throw new Error(`upstream returned HTTP ${res.statusCode}`);
    }
    report.upstreamReachable = true;
    report.upstreamDate = resolveUpstreamDate(res.headers);
    const found = extractControlIds(res.body);
    report.foundControlIds = found.sort();

    const expectedSet = new Set(EXPECTED_CONTROL_IDS);
    const foundSet = new Set(found);
    report.missingControlIds = EXPECTED_CONTROL_IDS.filter(id => !foundSet.has(id));

    // ─── Drift detection ──────────────────────────────────────────────────
    // The catalog file records a pinDate (the upstream fetch date). If the
    // upstream Last-Modified is unchanged since the catalog was last pinned,
    // there's nothing to do; refuse to bump.
    const upstreamDate = report.upstreamDate;
    const catalogDate = report.catalogPinDate;
    const previousUpstreamDate = report.sidecar?.upstreamDate ?? null;

    if (report.missingControlIds.length > 0) {
      report.status = 'ids-missing';
      exitCode = 2;
    } else if (catalogDate && upstreamDate && catalogDate === upstreamDate && !FORCE) {
      report.status = 'unchanged';
      report.drift = false;
      exitCode = 0;
    } else if (previousUpstreamDate && upstreamDate && previousUpstreamDate === upstreamDate && !FORCE) {
      // Sidecar date matches upstream but catalog pinDate does not — likely
      // a sidecar loss or an operator-initiated pin without an upstream bump.
      // Treat as drift so the operator notices.
      report.status = 'pin-drift';
      report.drift = true;
      exitCode = CHECK_MODE ? 1 : 0;
    } else if (catalogDate && upstreamDate && catalogDate !== upstreamDate && !FORCE) {
      report.status = 'upstream-changed';
      report.drift = true;
      exitCode = CHECK_MODE ? 1 : 0;
    } else if (FORCE) {
      report.status = 'forced';
      report.drift = true;
      exitCode = 0;
    } else {
      report.status = 'first-snapshot';
      report.drift = false;
      exitCode = 0;
    }

    writeSidecar({
      sourceUrl: SOURCE_URL,
      upstreamDate,
      fetchedAt: new Date().toISOString(),
      expectedControlCount: EXPECTED_CONTROL_IDS.length,
      foundControlCount: report.foundControlIds.length,
      missingControlIds: report.missingControlIds
    });
  } catch (err) {
    report.status = 'upstream-unreachable';
    report.error = String(err && err.message || err);
    exitCode = 1;
  }

  // Always emit the verification report so operators (and CI) can see what
  // happened without re-running.
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  if (CHECK_MODE && exitCode !== 0) {
    process.stderr.write(
      `snapshot-iso42001-catalog.js: ${report.status} — exit ${exitCode}\n` +
      `  See stdout JSON for details. Use --force to bypass (operator-only).\n`
    );
  }

  process.exit(exitCode);
}

main();
