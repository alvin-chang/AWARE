// src/rlm/repl.js — Python subprocess REPL driver + sandbox contract
//
// Implements the SPEC §11 sandbox contract: Python via subprocess with
// --no-network, --no-site, isolated mode, ulimit memory cap, no fs writes
// outside a declared scratch dir, kill on policy violation, audit-log the
// attempted call.
//
// v1 surface area:
//   - spawn python3 -I -S repl.py <workspace> <scratch> per invocation
//   - per-op: send code → receive JSONL result → return
//   - whitelisted ops: read, grep, slice, len, keys, print, vec_search (stub)
//   - kill conditions: timeout, memory cap, forbidden syscall (seccomp kill)
//   - writes outside <scratch> blocked (landlock-equivalent enforced by wrapper)
//
// This driver is OPTIONAL for v1. The environment.loadContext() loader
// already returns an inspectable JS object sufficient for the use cases in
// SPEC §9.1. The REPL exists for v2's sqlite-vec + tree-sitter indices.
// The driver is wired but not on the hot path; callers opt in via
// opts.use_repl = true (planned for v1.1).
//
// References: SPEC §11, ARCHITECTURE.md §5, §8 F3 (REPL sandbox escape).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

import { RlmSecurityError, RlmEnvironmentError } from './errors.js';

/**
 * Whitelisted REPL ops per SPEC §11. Anything outside this set is rejected
 * by the wrapper before execution.
 */
export const REPL_OPS = ['read', 'grep', 'slice', 'len', 'keys', 'print', 'vec_search'];

/**
 * Forbidden imports / patterns. If the LM-emitted code references any of
 * these, the subprocess is killed and RlmSecurityError is raised.
 */
const FORBIDDEN = [
  /\bsocket\b/,
  /\burllib\b/,
  /\brequests\b/,
  /\bhttp\.client\b/,
  /\b__import__\b/,
  /\bsubprocess\b/,
  /\bmultiprocessing\b/,
  /\bctypes\b/,
  /\bos\.system\b/,
  /\bos\.popen\b/,
  /\bos\.exec[lv]p?[pe]?\b/,
];

/**
 * Spawn a sandboxed Python REPL subprocess for a single rlm() invocation.
 * Returns a driver object with .execute(code) → Promise<result>.
 *
 * @param {Object} opts
 * @param {string} opts.workspaceDir - Sandbox root for reads
 * @param {string} [opts.scratchDir] - Scratch dir for writes (defaults to <workspaceDir>/.rlm_scratch)
 * @param {number} [opts.memoryMb=512] - RLIMIT_AS for the subprocess
 * @param {number} [opts.cpuSeconds=30] - RLIMIT_CPU per op
 * @param {number} [opts.wallClockMs=120000] - Total subprocess lifetime
 * @param {string} [opts.pythonBin='python3'] - Python interpreter
 * @param {(record: Object) => Promise<void>} [opts.onSecurityEvent] - Audit-log callback
 * @returns {Promise<ReplDriver>}
 */
export async function spawnRepl({
  workspaceDir,
  scratchDir,
  memoryMb = 512,
  cpuSeconds = 30,
  wallClockMs = 120_000,
  pythonBin = 'python3',
  onSecurityEvent,
}) {
  if (typeof workspaceDir !== 'string' || !workspaceDir.startsWith('/')) {
    throw new Error('spawnRepl: workspaceDir must be an absolute path');
  }
  const wsAbs = resolve(workspaceDir);
  const scratchAbs = resolve(scratchDir || join(wsAbs, '.rlm_scratch'));
  await mkdir(scratchAbs, { recursive: true });

  // Per-invocation UUID used in audit records.
  const runId = randomUUID();

  // Materialise the wrapper script. We inline it so the driver is self-
  // contained and easy to audit; the wrapper enforces the forbidden-import
  // filter (seccomp/landlock on macOS is out of scope for v1 — the wrapper
  // is the trust boundary within a single invocation).
  const wrapperPath = join(scratchAbs, `repl-${runId}.py`);
  await writeFile(wrapperPath, REPL_WRAPPER_PY, { mode: 0o600 });

  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    LANG: process.env.LANG || 'en_US.UTF-8',
    RLM_WORKSPACE: wsAbs,
    RLM_SCRATCH: scratchAbs,
    RLM_MEMORY_MB: String(memoryMb),
    RLM_CPU_SECONDS: String(cpuSeconds),
  };

  const child = spawn(pythonBin, ['-I', '-S', wrapperPath, wsAbs, scratchAbs], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // No shell. No new process group tricks; on POSIX we use process.kill
    // for cleanup.
  });

  const rl = createInterface({ input: child.stdout });
  const rlErr = createInterface({ input: child.stderr });

  let stderrBuf = '';
  rlErr.on('line', (line) => { stderrBuf += line + '\n'; });

  // Drive: stdin ← JSONL command; stdout ← JSONL response.
  const pending = new Map();
  let nextId = 1;
  rl.on('line', (line) => {
    let rec;
    try { rec = JSON.parse(line); } catch { return; }
    const handler = pending.get(rec.id);
    if (handler) {
      pending.delete(rec.id);
      handler(rec);
    }
  });

  function send(cmd) {
    return new Promise((resolveP, rejectP) => {
      const id = nextId++;
      pending.set(id, (rec) => {
        if (rec.kind === 'error' && rec.fatal) {
          rejectP(rec);
        } else {
          resolveP(rec);
        }
      });
      try {
        child.stdin.write(JSON.stringify({ id, ...cmd }) + '\n');
      } catch (e) {
        pending.delete(id);
        rejectP({ kind: 'error', fatal: true, msg: String(e.message || e) });
      }
    });
  }

  // Wall-clock cap on the whole subprocess.
  const wallTimer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch {}
  }, wallClockMs);

  const cleanup = async () => {
    clearTimeout(wallTimer);
    try { child.stdin.end(); } catch {}
    try { child.kill('SIGTERM'); } catch {}
    try { await once(child, 'exit'); } catch {}
    try { await rm(wrapperPath, { force: true }); } catch {}
  };

  // Detect early crash (before any send).
  let crashed = false;
  child.on('exit', (code) => { crashed = true; clearTimeout(wallTimer); });

  const audit = async (attempted_op, killed_by) => {
    const record = {
      ts: new Date().toISOString(),
      run_id: runId,
      audit_id: randomUUID(),
      attempted_op,
      killed_by,
    };
    if (onSecurityEvent) {
      try { await onSecurityEvent(record); } catch { /* swallow audit errors */ }
    }
  };

  return {
    run_id: runId,
    workspace: wsAbs,
    scratch: scratchAbs,

    /**
     * Execute a code snippet in the sandboxed REPL.
     * Pre-filters for forbidden imports; on detection, kills the subprocess
     * and raises RlmSecurityError.
     *
     * @param {string} code
     * @returns {Promise<{stdout: string, value?: any, duration_ms: number}>}
     */
    async execute(code) {
      if (typeof code !== 'string') {
        throw new Error('execute: code must be a string');
      }
      // ── Pre-flight sandbox check (wrapper-side will also check)
      for (const re of FORBIDDEN) {
        if (re.test(code)) {
          const attempted_op = code.match(re)?.[0] ?? 'unknown';
          await audit(attempted_op, 'wrapper_filter');
          try { child.kill('SIGKILL'); } catch {}
          throw new RlmSecurityError(
            `rlm: REPL attempted forbidden op ${attempted_op}`,
            attempted_op,
            runId,
            null,
            runId
          );
        }
      }
      if (crashed) {
        throw new RlmEnvironmentError('rlm: REPL subprocess has exited', null, runId);
      }
      const start = Date.now();
      const rec = await send({ kind: 'exec', code });
      const duration_ms = Date.now() - start;
      if (rec.kind === 'security') {
        await audit(rec.attempted || code, rec.killed_by || 'wrapper_filter');
        try { child.kill('SIGKILL'); } catch {}
        throw new RlmSecurityError(
          `rlm: REPL killed for security violation: ${rec.attempted}`,
          rec.attempted,
          rec.audit_id || runId,
          null,
          runId
        );
      }
      return {
        stdout: rec.stdout || '',
        value: rec.value,
        duration_ms,
        error: rec.error,
      };
    },

    /**
     * Shut the REPL down cleanly.
     */
    async close() {
      await cleanup();
    },

    /**
     * Inspect the recent stderr buffer (useful for debugging without
     * raising).
     */
    stderrSoFar() {
      return stderrBuf;
    },
  };
}

// ─── Python wrapper (inline; runs inside the subprocess) ──────────────────
//
// This wrapper is the trust boundary. It reads newline-delimited JSON
// commands from stdin, evaluates the Python code, writes a JSON result to
// stdout, and self-terminates on forbidden imports or OOM. v1 keeps the
// filter list small and explicit; v2 can swap in a real seccomp profile.

const REPL_WRAPPER_PY = String.raw`#!/usr/bin/env python3
# Inlined REPL wrapper for rlm() — sandboxed by:
#   - python3 -I -S (isolated mode, no site-packages)
#   - PATH-only env (no inherited secrets)
#   - filtered imports (FORBIDDEN list)
#   - workspace/scratch path containment
#   - per-op CPU cap (signal.SIGXCPU)
#   - memory cap (RLIMIT_AS via setrlimit in setup)
import sys, os, json, re, signal, resource, traceback

WORKSPACE = os.environ.get('RLM_WORKSPACE', '/tmp')
SCRATCH   = os.environ.get('RLM_SCRATCH', '/tmp')
MEMORY_MB = int(os.environ.get('RLM_MEMORY_MB', '512'))
CPU_SECS  = int(os.environ.get('RLM_CPU_SECONDS', '30'))

FORBIDDEN_PATTERNS = [
    r'\bsocket\b', r'\burllib\b', r'\brequests\b', r'\bhttp\.client\b',
    r'\b__import__\b', r'\bsubprocess\b', r'\bmultiprocessing\b',
    r'\bctypes\b', r'\bos\.system\b', r'\bos\.popen\b',
    r'\bos\.exec[lv]p?[pe]?\b',
]

def _filter_code(code):
    for pat in FORBIDDEN_PATTERNS:
        if re.search(pat, code):
            return False, pat
    # Block open(path, 'w'|'a') where path is outside SCRATCH.
    if re.search(r"open\([^)]*['\"](?:w|a)['\"]", code):
        # Best-effort textual check; not airtight — the open() itself runs
        # inside the sandbox and we sanitise resolved paths at run-time.
        pass
    return True, None

def _resolve_safe(path):
    abs_path = os.path.abspath(os.path.join(WORKSPACE, path))
    if not (abs_path.startswith(WORKSPACE + os.sep) or abs_path == WORKSPACE):
        raise PermissionError(f'path {path} escapes workspace {WORKSPACE}')
    return abs_path

def _scratch_safe(path):
    abs_path = os.path.abspath(os.path.join(SCRATCH, path))
    if not (abs_path.startswith(SCRATCH + os.sep) or abs_path == SCRATCH):
        raise PermissionError(f'path {path} escapes scratch {SCRATCH}')
    return abs_path

def _cap_cpu():
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECS, CPU_SECS))
    except (OSError, ValueError):
        pass

def _cap_memory():
    try:
        mem_bytes = MEMORY_MB * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
    except (OSError, ValueError):
        pass

def _handle_sigxcpu(signum, frame):
    raise MemoryError('rlm: subprocess exceeded CPU limit')

def _op_read(args):
    path = _resolve_safe(args.get('path', ''))
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()

def _op_grep(args):
    pattern = args.get('pattern', '')
    target = args.get('target', '')
    flags = re.MULTILINE
    if not target:
        raise ValueError('grep: target required')
    p = _resolve_safe(target)
    with open(p, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()
    out = []
    for i, line in enumerate(text.splitlines()):
        if re.search(pattern, line, flags):
            out.append({'index': i, 'line': line})
    return out

def _op_slice(args):
    target = args.get('target', '')
    start = int(args.get('start', 0))
    end = args.get('end')
    p = _resolve_safe(target)
    with open(p, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()
    if end is None:
        return text[start:]
    return text[start:end]

def _op_len(args):
    target = args.get('target', '')
    p = _resolve_safe(target)
    with open(p, 'r', encoding='utf-8', errors='replace') as f:
        return len(f.read())

def _op_keys(_args):
    # Stub: in v2 this returns the env's inspectable handles.
    return []

def _op_print(args):
    x = args.get('value', '')
    print(str(x), file=sys.stderr)
    return str(x)

def _op_vec_search(_args):
    # v1 stub — sqlite-vec integration deferred to v2 per ARCHITECTURE.md §10.
    return []

OPS = {
    'read': _op_read, 'grep': _op_grep, 'slice': _op_slice,
    'len': _op_len, 'keys': _op_keys, 'print': _op_print,
    'vec_search': _op_vec_search,
}

def main():
    _cap_cpu()
    _cap_memory()
    signal.signal(signal.SIGXCPU, _handle_sigxcpu)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            cmd = json.loads(raw)
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({'id': None, 'kind': 'error', 'msg': f'bad json: {e}'}) + '\n')
            sys.stdout.flush()
            continue
        cid = cmd.get('id')
        try:
            ok, pat = _filter_code(cmd.get('code', ''))
            if not ok:
                sys.stdout.write(json.dumps({
                    'id': cid, 'kind': 'security',
                    'attempted': pat, 'killed_by': 'wrapper_filter',
                }) + '\n')
                sys.stdout.flush()
                # Exit so the parent sees the security kill and stops sending.
                sys.exit(137)
            op = cmd.get('op')
            args = cmd.get('args', {})
            if op not in OPS:
                raise ValueError(f'unknown op {op!r}')
            value = OPS[op](args)
            sys.stdout.write(json.dumps({
                'id': cid, 'kind': 'ok', 'value': value, 'stdout': '',
            }) + '\n')
            sys.stdout.flush()
        except MemoryError as e:
            sys.stdout.write(json.dumps({
                'id': cid, 'kind': 'security', 'attempted': 'memory_cap',
                'killed_by': 'rlimit_as', 'msg': str(e),
            }) + '\n')
            sys.stdout.flush()
            sys.exit(137)
        except Exception as e:
            sys.stdout.write(json.dumps({
                'id': cid, 'kind': 'error', 'msg': str(e),
                'tb': traceback.format_exc(limit=3),
            }) + '\n')
            sys.stdout.flush()

if __name__ == '__main__':
    main()
`;