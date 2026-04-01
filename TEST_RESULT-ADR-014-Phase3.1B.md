# TEST_RESULT.md — ADR-014 Phase 3.1B

**Date:** 2026-04-01 21:24 UTC
**Tester:** Quinn
**Commit:** `85b04a1` — feat(ADR-014): Phase 3.1B Behavioural Anomaly Detection

## Test Run
```bash
cd ~/src/AWARE && node -e "require('./src/monitoring/anomaly-scorer').runTests()"
```

## Results: 14/14 PASS ✅

### F-2: stddev=0 guard (Critor fix)
| Test | Description | Result |
|------|-------------|--------|
| F-2 | stddev=0 with normal value → z=0 | ✅ PASS |
| F-2 | stddev=0 with deviant value → z=3 | ✅ PASS |
| F-2 | Normal baseline → computes correctly | ✅ PASS |

### F-3: Severity classification uses BOTH anomaly + trust (Critor fix)
| Test | Description | Result |
|------|-------------|--------|
| F-3 | anomaly=0.85 + trust=0.3 → CRITICAL | ✅ PASS |
| F-3 | anomaly=0.85 + trust=0.6 → HIGH | ✅ PASS |
| F-3 | anomaly=0.1 + trust=0.95 → INFO | ✅ PASS |
| F-3 | anomaly=0.4 + trust=0.9 → WARNING | ✅ PASS |
| F-3 | trust=0.5 alone → HIGH | ✅ PASS |

### F-1: Penalty INCREASES with anomaly (Critor fix)
| Test | Description | Result |
|------|-------------|--------|
| F-1 | anomalyScore < 0.3 → no penalty | ✅ PASS |
| F-1 | anomalyScore = 0.65 → penalty ≈ 0.5 | ✅ PASS |
| F-1 | anomalyScore = 1.0 → penalty = 1.0 | ✅ PASS |

### Trust Score Computation
| Test | Description | Result |
|------|-------------|--------|
| Trust | Normal anomaly → trusted | ✅ PASS |
| Trust | High anomaly → untrusted | ✅ PASS |
| Trust | Improving trend → boost | ✅ PASS |

## Files Verified
- `src/monitoring/anomaly-scorer.js`

## Features Tested
- `computeZScore()` — Z-score with stddev=0 guard (F-2)
- `computeAnomalyScore()` — Weighted Z-score aggregation
- `computeTrustScore()` — Derives trust from anomaly + trend
- `classifySeverity()` — Uses BOTH anomaly + trust (F-3)
- `applyAnomalyPenalty()` — Penalty INCREASES with anomaly (F-1)
- `generateAlert()` — Alert generation with severity-based actions

## Status
**READY FOR CRITIC REVIEW** — All 14/14 tests passing
