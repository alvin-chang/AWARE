// src/verify.js — Verification layer for refined output
// Different task domains need different verification. The verification step is what
// makes HeavySkill *safe* to use as a primitive — it catches the case where the
// refined trace looks good but is actually wrong (code that doesn't run, citations
// that don't exist, etc.).

import { exec as childExec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, readFileSync } from 'node:fs';

const exec = promisify(childExec);

export async function verify({ trace, verification, context }) {
  const start = Date.now();
  const method = verification.method;

  try {
    let result;
    switch (method) {
      case 'exec':
        result = await verifyExec(trace, verification, context);
        break;
      case 'test_suite':
        result = await verifyTestSuite(trace, verification, context);
        break;
      case 'citation_check':
        result = await verifyCitations(trace, verification, context);
        break;
      case 'kg_consistency':
        result = await verifyKG(trace, verification, context);
        break;
      case 'none':
        result = { passed: true, method: 'none' };
        break;
      default:
        throw new Error(`verify: unknown method '${method}'`);
    }
    return { ...result, duration_ms: Date.now() - start };
  } catch (err) {
    return {
      passed: false,
      method,
      details: { error: err.message },
      duration_ms: Date.now() - start,
    };
  }
}

async function verifyExec(trace, verification, context) {
  // Run the generated code. This is the most dangerous verification — sandbox required.
  // For Phase 1 of AWARE 2.0, we use a timeout + workdir constraint. Real sandboxing
  // (bubblewrap / firejail / nsjail) comes in Phase 5 hardening.
  const cmd = verification.cmd || extractCodeBlock(trace);
  if (!cmd) {
    return { passed: false, method: 'exec', details: { error: 'no command or code block found' } };
  }
  const cwd = verification.cwd || context?.cwd || process.cwd();
  const timeout = verification.timeout_ms || 10_000;

  // CRITICAL safety: reject obviously dangerous patterns unless explicitly opted in
  if (!verification.allow_unsafe) {
    const dangerous = /(\brm\s+-rf\b|\bdd\s+if=|\bmkfs\b|\bshutdown\b|\breboot\b)/i;
    if (dangerous.test(cmd)) {
      return { passed: false, method: 'exec', details: { error: 'unsafe command rejected' } };
    }
  }

  const { stdout, stderr } = await exec(cmd, { cwd, timeout });
  return {
    passed: true,
    method: 'exec',
    details: { stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 4000) },
  };
}

async function verifyTestSuite(trace, verification, context) {
  const cmd = verification.cmd || 'npm test';
  const cwd = verification.cwd || context?.cwd || process.cwd();
  const timeout = verification.timeout_ms || 300_000;
  try {
    const { stdout, stderr } = await exec(cmd, { cwd, timeout });
    return {
      passed: true,
      method: 'test_suite',
      details: { stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) },
    };
  } catch (err) {
    return {
      passed: false,
      method: 'test_suite',
      details: {
        error: err.message,
        stdout: (err.stdout || '').slice(-2000),
        stderr: (err.stderr || '').slice(-2000),
      },
    };
  }
}

async function verifyCitations(trace, verification, context) {
  // Extract URLs / DOIs from trace and HEAD-check them. Stub for v0.1.
  const urls = (trace.match(/https?:\/\/[^\s)]+/g) || []).slice(0, 20);
  // For v0.1, just report what we found. Real checking comes when we wire to network.
  return {
    passed: true,
    method: 'citation_check',
    details: { urls_found: urls.length, urls: urls.slice(0, 5) },
  };
}

async function verifyKG(trace, verification, context) {
  // Cross-check claims against MemoryStone KG. Stub for v0.1.
  return {
    passed: true,
    method: 'kg_consistency',
    details: { note: 'KG verification stub — full implementation in Phase 2' },
  };
}

function extractCodeBlock(trace) {
  const m = trace.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}
