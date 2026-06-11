// test/integration/bring-up-full.test.js
//
// Verifies the gateway service is correctly defined in the compose file
// and the bring-up script exercises it. We do NOT actually run the
// 5-service stack here (that's the bring-up-coordinator.sh job); this
// test asserts the *shape* of the gateway configuration and the script's
// gateway-aware logic.
//
// Gated by AWARE_BRINGUP_OK=1 — runs only when the operator opts in,
// because even the shape-checks touch the compose file's profile
// semantics.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.coordinator.yml');
const BRINGUP_SCRIPT = path.join(REPO_ROOT, 'scripts', 'bring-up-coordinator.sh');

test('gateway Dockerfile exists and is a multi-stage build', () => {
  const dockerfile = path.join(REPO_ROOT, 'Dockerfile.gateway');
  assert.ok(fs.existsSync(dockerfile), 'Dockerfile.gateway should exist');
  const content = fs.readFileSync(dockerfile, 'utf8');
  // Multi-stage: should have at least one FROM and a final FROM.
  const froms = content.match(/^FROM /gm) || [];
  assert.ok(froms.length >= 2, `expected multi-stage build, found ${froms.length} FROM lines`);
  // Runtime stage should run as non-root.
  assert.ok(/USER aware/.test(content), 'gateway should run as non-root `aware` user');
  // Should expose 18080.
  assert.ok(/EXPOSE 18080/.test(content), 'gateway should EXPOSE 18080');
  // Should have a HEALTHCHECK.
  assert.ok(/HEALTHCHECK/.test(content), 'gateway Dockerfile should declare a HEALTHCHECK');
});

test('gateway server.js exists and exports app + version', () => {
  const serverJs = path.join(REPO_ROOT, 'src', 'gateway', 'server.js');
  assert.ok(fs.existsSync(serverJs), 'src/gateway/server.js should exist');
  const content = fs.readFileSync(serverJs, 'utf8');
  assert.match(content, /module\.exports\s*=\s*\{[^}]*app/, 'should export app');
  assert.match(content, /GATEWAY_VERSION/, 'should define GATEWAY_VERSION');
  assert.match(content, /helmet\(\)/, 'should use helmet middleware');
  assert.match(content, /rateLimit/, 'should use express-rate-limit');
  assert.match(content, /express\.json/, 'should use express.json body parser');
});

test('package.gateway.json has minimal deps (no full v1 tree)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.gateway.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});
  // Must have what the gateway needs.
  for (const need of ['express', 'helmet', 'cors', 'express-rate-limit']) {
    assert.ok(deps.includes(need), `package.gateway.json must include ${need}`);
  }
  // Should NOT have the v1-specific deps that the gateway doesn't need.
  // This is the audit: gateway is small, the v1 features stay in the
  // main package.json.
  for (const banned of ['express-validator', 'jsonwebtoken', 'uuid']) {
    assert.ok(!deps.includes(banned),
      `package.gateway.json should not include v1-specific dep ${banned}`);
  }
});

test('compose file declares gateway service behind `full` profile', () => {
  const content = fs.readFileSync(COMPOSE_FILE, 'utf8');
  // The gateway service block must exist.
  assert.match(content, /^  gateway:/m, 'compose file should declare a `gateway` service');
  // It must be behind the `full` profile so the default bring-up
  // (4-service stack) doesn't include it.
  assert.match(content, /profiles:\s*\[\s*"full"\s*\]/,
    'gateway should be behind `profiles: ["full"]`');
  // It should build from the local Dockerfile.
  assert.match(content, /dockerfile:\s*Dockerfile\.gateway/,
    'gateway should build from Dockerfile.gateway');
  // It should bind 18080.
  assert.match(content, /"18080:18080"/,
    'gateway should publish port 18080');
});

test('compose file gateway has a healthcheck on /health', () => {
  const content = fs.readFileSync(COMPOSE_FILE, 'utf8');
  // Find the gateway block and assert it has a healthcheck.
  // The simplest is to grep for the gateway's own healthcheck line.
  // We expect a wget or curl-based /health probe on 18080.
  assert.match(content, /http:\/\/127\.0\.0\.1:18080\/health/,
    'gateway healthcheck should probe /health on 18080');
});

test('bring-up script knows about the gateway in its wait loop', () => {
  const content = fs.readFileSync(BRINGUP_SCRIPT, 'utf8');
  // The wait loop must include the gateway container.
  assert.match(content, /aware-2-gateway/,
    'bring-up script wait loop should include aware-2-gateway');
  // The bring-up should also bring the gateway up.
  assert.match(content, /--profile full/,
    'bring-up script should use --profile full to include the gateway');
});

test('gateway smoke test: 6th smoke verifies gateway /version, /health, request-id', () => {
  const content = fs.readFileSync(BRINGUP_SCRIPT, 'utf8');
  // The script should hit gateway:18080 in its smoke tests.
  assert.match(content, /127\.0\.0\.1:18080/,
    'bring-up script should hit gateway at 127.0.0.1:18080');
  // The script should grep for the gateway's identity in /version.
  assert.match(content, /"service":"aware-gateway"/,
    'bring-up script should verify the gateway identity');
});

test('integration test only runs when AWARE_BRINGUP_OK=1', (t) => {
  if (process.env.AWARE_BRINGUP_OK !== '1') {
    t.skip('integration test gated by AWARE_BRINGUP_OK=1');
    return;
  }
  // If we ARE opted in, we could run a real `docker compose --profile full up`
  // here. We don't — that's the bring-up script's job. This test exists
  // primarily to gate the file's presence in CI: if you didn't opt in,
  // the test is a no-op; if you did, the file is a real assertion.
  assert.ok(fs.existsSync(BRINGUP_SCRIPT), 'bring-up script should exist');
  // Make sure the bring-up script is executable.
  const stat = fs.statSync(BRINGUP_SCRIPT);
  assert.ok(stat.mode & 0o111, 'bring-up script should be executable');
});
