#!/usr/bin/env node
/**
 * Regenerate src/compliance/aicm-v1-catalog.js from the public CSA AICM CSV mirror.
 *
 * Source: https://github.com/rocklambros/TRACT/blob/main/opencre_export/CSA_AI_Controls_Matrix.csv
 *   (OpenCRE-exported subset of CSA AICM v1)
 *
 * Re-run this script when:
 *   - CSA publishes a non-gated mirror of the full AICM v1 spreadsheet
 *   - The OpenCRE TRACT repo is updated with new AICM mappings
 *   - A CSA AICM v1.x point release (errata, control additions) lands
 *
 * Usage:
 *   node scripts/regenerate-aicm-catalog.js [path/to/CSA_AI_Controls_Matrix.csv]
 *
 * If no path is given, the script fetches the CSV from the GitHub raw URL
 * into a temp file, parses it, and writes src/compliance/aicm-v1-catalog.js.
 *
 * The script is intentionally idempotent — running it produces the same
 * output for the same input, so it is safe to re-run as part of CI.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_CSV_URL =
  'https://raw.githubusercontent.com/rocklambros/TRACT/main/opencre_export/CSA_AI_Controls_Matrix.csv';
const OUT_PATH = path.join(__dirname, '..', 'src', 'compliance', 'aicm-v1-catalog.js');
// Use the system temp dir (not /tmp/aicm-fetch, which leaks the operator's
// local fetch directory naming convention into the public script).
const TMP_CSV = path.join(require('os').tmpdir(), 'CSA_AI_Controls_Matrix.csv');

const AICM_DOMAIN_NAMES = {
  'A&A': 'Audit & Accountability',
  'AIS': 'Application & Interface Security',
  'BCR': 'Business Continuity Mgmt & Operational Resilience',
  'CCC': 'Change Control & Configuration Mgmt',
  'CEK': 'Cryptography, Encryption & Key Mgmt',
  'DCS': 'Datacenter Security',
  'DSP': 'Data Security & Privacy',
  'GRC': 'Governance, Risk Mgmt & Compliance',
  'HRS': 'Human Resources Security',
  'I&S': 'Interoperability & Sharing',
  'IAM': 'Identity & Access Mgmt',
  'IPY': 'Interoperability & Portability',
  'LOG': 'Logging & Monitoring',
  'MDS': 'Model Security (AI-specific, new in AICM v1)',
  'SEF': 'Security Incident E-Response & Mgmt',
  'STA': 'Supply Chain Mgmt, Transparency & Accountability',
  'TVM': 'Threat & Vulnerability Mgmt',
  'UEM': 'Universal Endpoint Mgmt',
};

function fetchCsv(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Minimal CSV parser — handles quoted fields with embedded commas/quotes/newlines
function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  let cur = '';
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
    } else {
      if (ch === ',') {
        fields.push(cur);
        cur = '';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      cur += ch;
      i++;
    }
  }
  fields.push(cur);
  return fields;
}

function escapeJsString(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function main() {
  const inputPath = process.argv[2];
  let csv;
  if (inputPath) {
    csv = fs.readFileSync(inputPath, 'utf8');
  } else {
    fs.mkdirSync(path.dirname(TMP_CSV), { recursive: true });
    console.log('Fetching ' + DEFAULT_CSV_URL);
    csv = await fetchCsv(DEFAULT_CSV_URL);
    fs.writeFileSync(TMP_CSV, csv);
    console.log('Cached to ' + TMP_CSV);
  }

  const lines = csv.split('\n');
  const byDomain = {};
  for (const line of lines) {
    if (!line.trim() || line.startsWith('CRE ')) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 4) continue;
    const [, name, ctrlId, desc] = fields;
    const m = /^([A-Z&]+)-(\d+)$/.exec(ctrlId);
    if (!m) continue;
    const dom = m[1];
    if (!byDomain[dom]) byDomain[dom] = [];
    byDomain[dom].push({ id: ctrlId, name, desc });
  }

  const sortedDoms = Object.keys(byDomain).sort();
  let totalControls = 0;
  const out = [];
  out.push('/**');
  out.push(' * CSA AI Controls Matrix (AICM) v1 — control catalog (GENERATED FILE)');
  out.push(' *');
  out.push(' * Do not edit by hand — regenerate via scripts/regenerate-aicm-catalog.js');
  out.push(' *');
  out.push(' * Source: ' + (inputPath || DEFAULT_CSV_URL));
  out.push(' *   (OpenCRE-exported subset of CSA AICM v1 control IDs and descriptions)');
  out.push(' *');
  out.push(' * AICM domain codes (18 total, per CSA AICM v1 spreadsheet):');
  for (const dom of sortedDoms) {
    out.push(' *   ' + dom + '  ' + (AICM_DOMAIN_NAMES[dom] || ''));
  }
  out.push(' */');
  out.push('');
  out.push("const AICM_V1_DOMAINS = {");
  for (const dom of sortedDoms) {
    const entries = byDomain[dom].sort((a, b) =>
      parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1])
    );
    totalControls += entries.length;
    out.push('  // ' + dom + '  ' + (AICM_DOMAIN_NAMES[dom] || ''));
    out.push("  '" + dom + "': {");
    for (const e of entries) {
      out.push(
        "    '" + e.id + "': { name: '" + escapeJsString(e.name) +
          "', description: '" + escapeJsString(e.desc) + "' },"
      );
    }
    out.push('  },');
  }
  out.push('};');
  out.push('');
  out.push('const AICM_V1_CONTROL_IDS = Object.entries(AICM_V1_DOMAINS).flatMap(');
  out.push('  ([dom, ctrls]) => Object.keys(ctrls)');
  out.push(');');
  out.push('');
  out.push('module.exports = { AICM_V1_DOMAINS, AICM_V1_CONTROL_IDS };');
  out.push('');

  fs.writeFileSync(OUT_PATH, out.join('\n'));
  console.log('Wrote ' + OUT_PATH);
  console.log('Domains: ' + sortedDoms.length + ', Controls: ' + totalControls);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
