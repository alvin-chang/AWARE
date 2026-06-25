# Security Policy

AWARE takes security seriously. This document describes how to report a
vulnerability, what you can expect from us, and the security guarantees
the project makes to operators and end users.

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.3.x   | :white_check_mark: |
| 2.2.x   | :white_check_mark: |
| < 2.2   | :x:                |

The maintainers commit to shipping security fixes for the current and
immediately previous minor release line. Older versions do not receive
patches.

## Reporting a Vulnerability

**Please do not file public issues for security bugs.**

Report privately to the maintainers via GitHub's
[private vulnerability reporting][gh-private] (Settings → Security →
Advisories → "Report a vulnerability to maintainers") — this routes to a
small set of maintainers and creates a draft security advisory that the
public cannot see until we publish a fix.

If GitHub private reporting is unavailable, email the maintainers at the
address listed on the GitHub repository's public profile.

[gh-private]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability

## What to Include

To help us triage quickly, please include:

1. **Component and version** — `aware` release tag (e.g. `v2.3.0`) and
   the file or module affected (e.g. `src/coordinator/http-server.js`).
2. **Reproduction** — minimal steps, sample request, or proof-of-concept
   code. Container/image tag if reproducible via Docker.
3. **Impact** — what an attacker can achieve (auth bypass, data
   disclosure, RCE, DoS, etc.) and the assumed attacker model.
4. **Environment** — `node --version`, OS, deployment shape (single
   host / docker-compose / Kubernetes).

## What to Expect

| Step | SLA |
|------|-----|
| Acknowledgement | within 3 business days |
| Triage and severity classification | within 7 business days |
| Fix for HIGH/CRITICAL | within 30 days |
| Fix for MEDIUM/LOW | next minor release |
| Public advisory | after a fix is available and operators have had ≥14 days to update (HIGH/CRITICAL: ≥7 days) |

We will keep you informed as work progresses. With your permission, we
will credit you in the advisory.

## Threat Model (In Scope)

AWARE is designed for self-hosted deployments where the operator owns
the host. The threat model includes:

- Untrusted network traffic to public-facing endpoints (coordinator API,
  agent registration, election RPC).
- Compromised agents attempting to influence consensus, escalate
  privileges, exfiltrate credential material, or impersonate other
  agents.
- Container-escape attempts from the coordinator service or agent
  runtime.
- Insider threats with read access to the host filesystem.

The threat model does **not** include:

- Compromise of the underlying host kernel or container runtime.
- Compromise of a privileged operator account.
- Side-channel attacks on the host (e.g. power-analysis, EM).

## Security Guarantees

The following guarantees apply to supported releases when deployed with
the default configuration and reasonable operational hygiene (rotated
secrets, current image, network segmentation):

- **Authentication.** The `/coordinate` and `/budget/status` endpoints
  require a Bearer token of ≥32 bytes in `NODE_ENV=production`. The
  `AWARE_COORDINATOR_TOKEN` environment variable is the single source of
  truth; a missing or short token causes the service to refuse to start.
  See `src/config/index.cjs` and `src/coordinator/http-server.js`.
- **Credential storage.** Passwords are stored as PBKDF2-SHA512 hashes
  with ≥100,000 iterations and a 32-byte random salt. Agent credentials
  are additionally peppered with a value derived from the deployment's
  secret key. See `src/api/models/User.js` and `src/api/models/Agent.js`.
- **Constant-time compare.** All token and password comparisons use
  `crypto.timingSafeEqual` to prevent timing-based disclosure.
- **No default secrets.** The service refuses to start in production if
  `SECRET_KEY` or `AWARE_COORDINATOR_TOKEN` is unset. The development
  opt-out is documented in `.env.example`.
- **No `Math.random` for security primitives.** All ID generation,
  election tie-breaking, and timeout jitter use `crypto.randomBytes` /
  `crypto.randomUUID` / `crypto.randomInt`. See the SC-HIGH-005 fix
  notes in commit history.
- **Kubernetes.** The default `k8s-deployment.yaml` ships with
  `ClusterIP` services (not `LoadBalancer`) and a default-deny
  NetworkPolicy that allows only the frontend → backend path.

## Auditing and Attestation

AWARE is built to be auditable. Each release artifact (source tarball,
container image) can be reproduced from the tagged git commit using the
recipes in `docs/build-reproducibility.md`. Internal compliance and
attestation flows are out of scope for this public document.

## Out-of-Scope Reports

The following are not security vulnerabilities and should be filed as
regular issues:

- Bug reports for documentation typos, broken links, or stale examples.
- Feature requests for new security primitives (please open a
  discussion first).
- Reports about outdated dependencies that the maintainers are already
  tracking on the public issue tracker.

## Versions and Signing

Release tags are signed with the maintainer's GPG key. The fingerprint
is published at `https://github.com/GoodCISO/aware/releases` alongside
each release.

---

_Last reviewed: 2026-06-25._
