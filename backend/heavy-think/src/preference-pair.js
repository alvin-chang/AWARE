// src/preference-pair.js — JSONL preference pair writer with content-hash dedup
// The output of every heavy_think call is a (chosen, rejected) preference pair
// that drops into a DPO training pipeline with zero annotation overhead.
//
// Storage: append-only JSONL files, one record per line. Files rotate by date.
// Dedup: SHA-256 of (problem + rejected + chosen) → skip if already in current file.

import { appendFile, readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const HASH_PREFIX_LEN = 16;  // 16 hex chars = 64 bits, ~1.8e19 distinct values

export async function writePreferencePair({ path, record, contentHash }) {
  if (!path) throw new Error('writePreferencePair: path is required');
  if (!record) throw new Error('writePreferencePair: record is required');

  ensureDir(path);

  // Embed the content hash in the record so future readers can dedup without recomputing
  const enriched = { ...record, _content_hash: contentHash };
  const line = JSON.stringify(enriched) + '\n';
  await appendFile(path, line, 'utf8');
}

export async function shouldSkipDuplicate({ path, contentHash }) {
  if (!existsSync(path)) return false;

  // For small files, scan in memory. For large files (>10MB), we should index hashes.
  // For v0.1 we keep it simple — the dedup is opportunistic, not load-bearing.
  const stats = await stat(path);
  if (stats.size === 0) return false;
  if (stats.size > 10 * 1024 * 1024) {
    // For large files, do a content search. The hash appears in the line.
    const text = readFileSync(path, 'utf8');
    const needle = `"_content_hash":"${contentHash}"`;
    return text.includes(needle);
  }

  const text = readFileSync(path, 'utf8');
  const needle = `"_content_hash":"${contentHash}"`;
  return text.includes(needle);
}

export function hashContent(problem, rejected, chosen) {
  return createHash('sha256')
    .update(problem)
    .update('\u0000')
    .update(rejected)
    .update('\u0000')
    .update(chosen)
    .digest('hex')
    .slice(0, HASH_PREFIX_LEN);
}

function ensureDir(path) {
  const dir = dirname(path);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
