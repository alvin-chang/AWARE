// src/rlm/environment.js — Context-as-environment loader (v1)
//
// Loads the typed Context union into a JS object that the LM can inspect
// via simple REPL-style operations. v1 does NOT spawn a Python subprocess;
// we load into memory and expose sync ops. ARCHITECTURE.md §5: "v1 ingest
// = 'none' ... Context is loaded into the REPL (or, for `string`, the
// prompt directly)."
//
// The real sandboxed Python subprocess is deferred to a future minor
// version (the seccomp profile lives at ~/src/heavy-think/seccomp/rlm.json
// per SPEC §11 but is not consumed in v1).
//
// SPEC §3.2 (Context shape), ARCHITECTURE.md §5 (REPL contract).

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RlmConfigError } from './errors.js';

/**
 * @typedef {string | {
 *   path: string,
 *   type: 'directory' | 'pdf' | 'log' | 'sqlite',
 *   hint?: string
 * }} Context
 */

/**
 * Load a Context into an inspectable Environment object.
 *
 * @param {Context} context - The rlm() context param.
 * @param {string} [workspaceDir] - Sandbox root (required if context is typed).
 * @returns {Promise<{
 *   kind: 'inline' | 'directory' | 'log' | 'pdf' | 'sqlite' | 'buffer',
 *   text?: string,           // for inline contexts
 *   lines?: string[],        // for log: 0-indexed array of lines
 *   pages?: string[],        // for pdf: 0-indexed array of page text (v1 stub: extracted via pdftotext if available)
 *   tree?: FileNode[],       // for directory: recursive file list
 *   vec?: object,            // for sqlite: stub
 *   mime?: string,
 *   hint?: string,
 *   summary: string          // short description shown to decomposition LM
 * }>}
 * @throws {RlmConfigError} on bad context shape
 */
export async function loadContext(context, workspaceDir) {
  // Inline string — small enough to go straight into the leaf prompt.
  if (typeof context === 'string') {
    return {
      kind: 'inline',
      text: context,
      summary: `inline text (${context.length} chars)`,
    };
  }

  if (!context || typeof context !== 'object') {
    throw new RlmConfigError(
      'rlm: context must be a string or an object { path, type, hint? }'
    );
  }

  const { path: ctxPath, type, hint } = context;
  if (typeof ctxPath !== 'string' || !ctxPath.startsWith('/')) {
    throw new RlmConfigError(
      `rlm: context.path must be an absolute path, got ${JSON.stringify(ctxPath)}`
    );
  }
  if (!workspaceDir) {
    throw new RlmConfigError(
      'rlm: workspaceDir is required when context is a typed object'
    );
  }

  // Resolve and check the path stays inside the workspace.
  const abs = resolve(ctxPath);
  const wsAbs = resolve(workspaceDir);
  if (!abs.startsWith(wsAbs + '/') && abs !== wsAbs) {
    throw new RlmConfigError(
      `rlm: context.path (${abs}) must be inside workspaceDir (${wsAbs})`
    );
  }

  switch (type) {
    case 'directory':
      return await loadDirectory(abs, hint);
    case 'log':
      return await loadLog(abs, hint);
    case 'pdf':
      return await loadPdf(abs, hint);
    case 'sqlite':
      return loadSqlite(abs, hint);
    default:
      throw new RlmConfigError(
        `rlm: context.type must be one of 'directory' | 'pdf' | 'log' | 'sqlite', got ${JSON.stringify(type)}`
      );
  }
}

// ─── Loaders ────────────────────────────────────────────────────────────────

async function loadDirectory(abs, hint) {
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isDirectory()) {
    throw new RlmConfigError(`rlm: directory context path does not exist or is not a directory: ${abs}`);
  }
  const tree = await walkTree(abs, abs, /* max depth */ 4, /* max entries */ 200);
  const summary = `directory tree (${countFiles(tree)} files):\n${formatTree(tree)}`;
  return { kind: 'directory', tree, hint, summary };
}

async function loadLog(abs, hint) {
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile()) {
    throw new RlmConfigError(`rlm: log context path does not exist or is not a file: ${abs}`);
  }
  const text = await readFile(abs, 'utf8');
  const lines = text.split(/\r?\n/);
  return {
    kind: 'log',
    lines,
    hint,
    summary: `log file (${lines.length} lines, ${text.length} bytes)`,
  };
}

async function loadPdf(abs, hint) {
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile()) {
    throw new RlmConfigError(`rlm: pdf context path does not exist or is not a file: ${abs}`);
  }
  // v1: try pdftotext if installed; otherwise return a placeholder.
  // Future: integrate a JS PDF parser.
  let pages = [];
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const pexec = promisify(execFile);
    const { stdout } = await pexec('pdftotext', ['-layout', abs, '-'], { timeout: 5000 });
    pages = stdout.split(/\f/).map(s => s.trim()).filter(Boolean);
  } catch {
    pages = [`[PDF placeholder: ${abs} — install poppler-utils for text extraction]`];
  }
  return {
    kind: 'pdf',
    pages,
    hint,
    summary: `PDF (${pages.length} pages)`,
  };
}

function loadSqlite(abs, hint) {
  // v1 stub: return a stub object. Real sqlite-vec integration is v2.
  return {
    kind: 'sqlite',
    vec: { _stub: true, path: abs },
    hint,
    summary: `SQLite database (vec_search stub; integration deferred to v2): ${abs}`,
  };
}

// ─── REPL-style ops (in-process, v1) ─────────────────────────────────────────

/**
 * Whitelisted REPL ops per ARCHITECTURE.md §5 / SPEC §11.
 * Returned shape: { ok: true, value } | { ok: false, error }.
 */
export const REPL_OPS = {
  read(env, p) {
    const resolved = resolve(env._workspace || '/', p);
    if (!resolved.startsWith((env._workspace || '/') + '/')) {
      return { ok: false, error: 'path_outside_workspace' };
    }
    return readFile(resolved, 'utf8')
      .then(text => ({ ok: true, value: text }))
      .catch(e => ({ ok: false, error: String(e.message || e) }));
  },

  grep(env, pattern, target) {
    const re = safeRegex(pattern);
    if (!re) return { ok: false, error: 'invalid_regex' };
    const hay = pickTarget(env, target);
    if (!hay) return { ok: false, error: 'target_not_found' };
    const matches = [];
    if (Array.isArray(hay)) {
      hay.forEach((line, i) => { if (re.test(line)) matches.push({ index: i, line }); });
    } else {
      const lines = String(hay).split(/\r?\n/);
      lines.forEach((line, i) => { if (re.test(line)) matches.push({ index: i, line }); });
    }
    return { ok: true, value: matches };
  },

  slice(env, target, start, end) {
    const hay = pickTarget(env, target);
    if (!hay) return { ok: false, error: 'target_not_found' };
    if (Array.isArray(hay)) return { ok: true, value: hay.slice(start, end) };
    return { ok: true, value: String(hay).slice(start, end) };
  },

  len(env, target) {
    const hay = pickTarget(env, target);
    if (!hay) return { ok: false, error: 'target_not_found' };
    if (Array.isArray(hay)) return { ok: true, value: hay.length };
    return { ok: true, value: String(hay).length };
  },

  keys(env) {
    return { ok: true, value: Object.keys(env).filter(k => !k.startsWith('_')) };
  },

  print(env, x) {
    return { ok: true, value: String(x) };
  },
};

function safeRegex(pattern) {
  try { return new RegExp(pattern, 'm'); } catch { return null; }
}

function pickTarget(env, target) {
  if (target === undefined || target === 'ctx') {
    return env.lines || env.pages || env.text || env.tree;
  }
  return env[target];
}

// ─── Tree walking helpers ───────────────────────────────────────────────────

/**
 * @typedef {Object} FileNode
 * @property {string} name
 * @property {'file'|'dir'} type
 * @property {FileNode[]} [children]
 */

async function walkTree(root, abs, maxDepth, maxEntries, depth = 0) {
  if (depth > maxDepth) return [];
  const entries = await readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (out.length >= maxEntries) break;
    const childAbs = `${abs}/${e.name}`;
    if (e.isDirectory()) {
      out.push({
        name: e.name,
        type: 'dir',
        children: await walkTree(root, childAbs, maxDepth, maxEntries, depth + 1),
      });
    } else if (e.isFile()) {
      out.push({ name: e.name, type: 'file' });
    }
  }
  return out;
}

function countFiles(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.type === 'file') n++;
    else if (node.children) n += countFiles(node.children);
  }
  return n;
}

function formatTree(nodes, prefix = '') {
  return nodes.map(n => {
    if (n.type === 'file') return `${prefix}${n.name}`;
    return `${prefix}${n.name}/\n${formatTree(n.children || [], prefix + '  ')}`;
  }).join('\n');
}
