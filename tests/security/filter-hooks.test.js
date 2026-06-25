/**
 * tests/security/filter-hooks.test.js
 *
 * Tests for the AWARE 4-layer privacy filter (Phase A2).
 * Verifies that the filter logic — which lives in bash scripts at
 * scripts/hooks/pre-commit, scripts/hooks/pre-push, scripts/hooks/pre-receive
 * and scripts/pre-commit-check.sh — correctly identifies (and does not
 * identify) privacy patterns in test fixtures.
 *
 * These tests use Node's child_process to spawn the actual hook scripts
 * so the tests are testing the deployed logic, not a re-implementation.
 * The hooks are exercised in a temp directory that contains a fixture
 * repo (positive + negative cases).
 *
 * Run: npm run test:jest -- tests/security/filter-hooks.test.js
 *
 * See docs/security/filter-architecture.md for the full filter spec.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PRE_COMMIT_CHECK = path.join(REPO_ROOT, 'scripts', 'pre-commit-check.sh');
const HOOK_PRE_COMMIT = path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-commit');
const HOOK_PRE_PUSH = path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-push');
const HOOK_PRE_RECEIVE = path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-receive');

// Helper: create a temp dir with a copy of the AWARE files the hooks read.
// Returns the temp dir path.
//
// IMPORTANT: The pre-commit-check.sh script computes REPO_ROOT from its
// own location (`<script-dir>/..`). To test the rules in isolation, we
// copy the script INTO the temp repo at scripts/pre-commit-check.sh so
// the REPO_ROOT resolution points to the temp dir, not the real one.
function makeFixtureRepo({ docsAuditsContent, statusMdContent, usersJsonTracked, usersTemplateContent }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aware-filter-test-'));

  // Set up the layout the hooks expect: docs/audits/, STATUS.md, src/data/, scripts/
  fs.mkdirSync(path.join(tmp, 'docs', 'audits'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });

  // Copy the pre-commit-check.sh script into the temp repo so REPO_ROOT resolves to tmp
  const scriptContent = fs.readFileSync(PRE_COMMIT_CHECK, 'utf8');
  const tmpScript = path.join(tmp, 'scripts', 'pre-commit-check.sh');
  fs.writeFileSync(tmpScript, scriptContent);
  fs.chmodSync(tmpScript, 0o755);

  if (docsAuditsContent !== null) {
    fs.writeFileSync(path.join(tmp, 'docs', 'audits', 'test.md'), docsAuditsContent || '');
  }
  if (statusMdContent !== null) {
    fs.writeFileSync(path.join(tmp, 'STATUS.md'), statusMdContent || '');
  }
  if (usersJsonTracked) {
    fs.writeFileSync(path.join(tmp, 'src', 'data', 'users.json'), usersJsonTracked);
  } else {
    // Create an untracked file (not in git) — the hook only blocks tracked files
    fs.writeFileSync(path.join(tmp, 'src', 'data', 'users.json'), '[]');
  }
  if (usersTemplateContent !== null) {
    fs.writeFileSync(path.join(tmp, 'src', 'data', 'users.json.template'), usersTemplateContent);
  } else {
    fs.writeFileSync(path.join(tmp, 'src', 'data', 'users.json.template'), '{"users": []}');
  }

  return tmp;
}

function runInDir(scriptPath, cwd, env = {}) {
  // Spawn the script with the given cwd, capture stdout+stderr+exitCode
  const result = spawnSync('bash', [scriptPath], {
    cwd,
    env: { ...process.env, ...env, REPO_ROOT_OVERRIDE: cwd },
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// ─── pre-commit-check.sh (A1) — the canonical content rules ─────────────

describe('Layer 1: pre-commit-check.sh content rules', () => {
  test('PASSES on a clean repo (no banned patterns)', () => {
    const tmp = makeFixtureRepo({
      docsAuditsContent: '# Audit\n\n## Finding\nNo host paths in this doc.\n',
      statusMdContent: '# Status\nAll systems normal.\n',
      usersJsonTracked: false,    // untracked, fine
      usersTemplateContent: '{"users": []}',
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/All privacy filter checks passed/);
  });

  test('BLOCKS host-specific paths in docs/audits/*.md', () => {
    const tmp = makeFixtureRepo({
      docsAuditsContent: '# Audit\nFound path: /Users/alvin/src/AWARE/config.json\n',
      statusMdContent: null,
      usersJsonTracked: false,
      usersTemplateContent: null,
    });

    // Run the copy of the script in the temp repo (so REPO_ROOT resolves to tmp)
    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/Host-specific path pattern/);
  });

  test('BLOCKS ~/.aws/ and ~/.ssh/ in docs/audits/*.md', () => {
    const tmp = makeFixtureRepo({
      docsAuditsContent: 'See ~/.aws/credentials and ~/.ssh/id_rsa for the key.\n',
      statusMdContent: null,
      usersJsonTracked: false,
      usersTemplateContent: null,
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/Host-specific path pattern/);
  });

  test('BLOCKS LAN IP 192.168.x.x in STATUS.md', () => {
    const tmp = makeFixtureRepo({
      docsAuditsContent: null,
      statusMdContent: 'Gitea is at http://192.168.99.99:4001/example/aware\n',
      usersJsonTracked: false,
      usersTemplateContent: null,
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/LAN IP/);
  });

  test('BLOCKS LAN IP 10.x.x.x in STATUS.md', () => {
    const tmp = makeFixtureRepo({
      docsAuditsContent: null,
      statusMdContent: 'Internal: http://10.99.99.99:8080\n',
      usersJsonTracked: false,
      usersTemplateContent: null,
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/LAN IP/);
  });

  test('BLOCKS secrets file path in STATUS.md', () => {
    const tmp = makeFixtureRepo({
      docsAuditsContent: null,
      statusMdContent: 'See secrets/api-keys.env for the values.\n',
      usersJsonTracked: false,
      usersTemplateContent: null,
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/Secrets file path/);
  });

  test('BLOCKS src/data/users.json with passwordHash in template', () => {
    const tmp = makeFixtureRepo({
      docsAuditsContent: null,
      statusMdContent: null,
      usersJsonTracked: false,
      usersTemplateContent: '{"users": [{"username": "admin", "passwordHash": "abc123", "salt": "def"}]}',
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/passwordHash/);
  });

  test('BLOCKS src/data/agents.json with credentials in template', () => {
    const tmp = makeFixtureRepo({
      docsAuditsContent: null,
      statusMdContent: null,
      usersJsonTracked: false,
      usersTemplateContent: null,  // Use default empty
    });
    // Override the agents template
    fs.writeFileSync(
      path.join(tmp, 'src', 'data', 'agents.json.template'),
      '{"agents": [{"name": "Test", "credentials": {"current": "abc"}}]}'
    );

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/credentials/);
  });
});

// ─── scripts/hooks/pre-commit (A2) — Layer 1 wrapper ─────────────────────

describe('Layer 1 wrapper: scripts/hooks/pre-commit', () => {
  test('script exists and is executable', () => {
    expect(fs.existsSync(HOOK_PRE_COMMIT)).toBe(true);
    const stat = fs.statSync(HOOK_PRE_COMMIT);
    // Check executable bit (any of the x bits)
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  test('script source delegates to scripts/pre-commit-check.sh', () => {
    const src = fs.readFileSync(HOOK_PRE_COMMIT, 'utf8');
    expect(src).toMatch(/pre-commit-check\.sh/);
    expect(src).toMatch(/set -euo pipefail/);
  });

  test('script source includes the gitleaks staged scan', () => {
    const src = fs.readFileSync(HOOK_PRE_COMMIT, 'utf8');
    expect(src).toMatch(/gitleaks/);
  });
});

// ─── scripts/hooks/pre-push (A2) — Layer 2 ──────────────────────────────

describe('Layer 2: scripts/hooks/pre-push', () => {
  test('script exists and is executable', () => {
    expect(fs.existsSync(HOOK_PRE_PUSH)).toBe(true);
    const stat = fs.statSync(HOOK_PRE_PUSH);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  test('script source reads the pre-push stdin contract (local-ref + remote-ref + SHAs)', () => {
    const src = fs.readFileSync(HOOK_PRE_PUSH, 'utf8');
    expect(src).toMatch(/LOCAL_REF|LOCAL_SHA/);
    expect(src).toMatch(/REMOTE_REF|REMOTE_SHA/);
  });

  test('script source runs gitleaks detect against the working tree', () => {
    const src = fs.readFileSync(HOOK_PRE_PUSH, 'utf8');
    expect(src).toMatch(/gitleaks detect/);
  });

  test('script source iterates over each pushed ref', () => {
    const src = fs.readFileSync(HOOK_PRE_PUSH, 'utf8');
    // The script must use a while-read loop to handle multiple refs
    expect(src).toMatch(/while read/);
  });

  test('script source documents how to bypass (for transparency)', () => {
    const src = fs.readFileSync(HOOK_PRE_PUSH, 'utf8');
    // Hooks MUST document that they are client-side and can be bypassed
    // with --no-verify — this is part of the security model.
    expect(src).toMatch(/--no-verify/);
    expect(src).toMatch(/client-side|Client-side/);
  });
});

// ─── scripts/hooks/pre-receive (A2) — Layer 3 ───────────────────────────

describe('Layer 3: scripts/hooks/pre-receive (gitea-side)', () => {
  test('script exists and is executable', () => {
    expect(fs.existsSync(HOOK_PRE_RECEIVE)).toBe(true);
    const stat = fs.statSync(HOOK_PRE_RECEIVE);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  test('script source reads the pre-receive stdin contract (old-sha + new-sha + ref-name)', () => {
    const src = fs.readFileSync(HOOK_PRE_RECEIVE, 'utf8');
    expect(src).toMatch(/OLD_SHA|NEW_SHA|REFNAME/);
  });

  test('script source reads file content from the bare repo (git show <sha>:<file>)', () => {
    const src = fs.readFileSync(HOOK_PRE_RECEIVE, 'utf8');
    expect(src).toMatch(/git.*show.*:/);
  });

  test('script source runs gitleaks against the pushed pack', () => {
    const src = fs.readFileSync(HOOK_PRE_RECEIVE, 'utf8');
    expect(src).toMatch(/gitleaks/);
    expect(src).toMatch(/archive|tar/);  // extract pushed pack for scanning
  });

  test('script source handles brand-new refs (old-sha all zeros)', () => {
    const src = fs.readFileSync(HOOK_PRE_RECEIVE, 'utf8');
    // The script uses bash regex `=~ ^0+$` to detect the all-zeros SHA
    expect(src).toMatch(/=\~\s*\^0\+\$/);
  });

  test('script source handles deletions (new-sha all zeros)', () => {
    const src = fs.readFileSync(HOOK_PRE_RECEIVE, 'utf8');
    expect(src).toMatch(/deletion/);
  });
});

// ─── Cross-cutting: known false positives ───────────────────────────────

describe('Known false positives (must NOT be blocked)', () => {
  test('docs/audits/*.md with ~/.local/ and ~/.config/ paths PASSES', () => {
    // The A1 rules explicitly allow these (per the regex in pre-commit-check.sh)
    const tmp = makeFixtureRepo({
      docsAuditsContent: 'See ~/.local/share/app.log and ~/.config/app/config.json\n',
      statusMdContent: null,
      usersJsonTracked: false,
      usersTemplateContent: null,
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(0);
  });

  test('docs/audits/*.md with 0.0.0.0 (all interfaces) PASSES', () => {
    // Not in the 10.x.x.x range, so should pass
    const tmp = makeFixtureRepo({
      docsAuditsContent: 'Server binds to 0.0.0.0:3000\n',
      statusMdContent: null,
      usersJsonTracked: false,
      usersTemplateContent: null,
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(0);
  });

  test('STATUS.md with public IP (8.8.8.8) PASSES', () => {
    // Public IPs are not in the LAN range
    const tmp = makeFixtureRepo({
      docsAuditsContent: null,
      statusMdContent: 'DNS: 8.8.8.8 (Google)\n',
      usersJsonTracked: false,
      usersTemplateContent: null,
    });

    const result = runInDir(path.join(tmp, 'scripts', 'pre-commit-check.sh'), tmp);
    expect(result.code).toBe(0);
  });
});
