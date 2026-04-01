# ADR-015/016 Test Results

**Date:** 2026-04-01
**Status:** 40/40 PASS

## Test Suites
- adr-015-tool-access-control.test.js: PASS
- adr-016-compliance-mapping.test.js: PASS

## ADR-015: Tool Access Control & Enforcement
| Test | Description | Result |
|------|-------------|--------|
| F-1 | evaluatePermission allows admin to access all tools | ✅ PASS |
| F-2 | evaluatePermission denies coder from credential tools | ✅ PASS |
| F-3 | evaluatePermission denies researcher from exec:sudo | ✅ PASS |
| F-2 | detects shadow state after threshold | ✅ PASS |
| T1 | normal usage is clean | ✅ PASS |
| T2 | excessive call frequency is anomalous | ✅ PASS |
| F-1 | validates required parameters | ✅ PASS |
| F-2 | validates string maxLength | ✅ PASS |
| F-1 | logs tool access with context | ✅ PASS |
| F-2 | includes identity context in logs | ✅ PASS |
| T1 | sanitizes sensitive parameters | ✅ PASS |

## ADR-016: Compliance Mapping & Reporting
| Test | Description | Result |
|------|-------------|--------|
| F-1 | maps components to CSA AI CM controls | ✅ PASS |
| T1 | generates compliance matrix | ✅ PASS |
| T2 | returns framework controls | ✅ PASS |
| T3 | componentCoversControl returns true for mapped control | ✅ PASS |
| F-1 | creates and tracks gaps | ✅ PASS |
| F-2 | records compliance gaps | ✅ PASS |
| T1 | calculates overall posture | ✅ PASS |
| T2 | gap severity determines priority | ✅ PASS |
| T1 | assigns gap to owner | ✅ PASS |
| T2 | marks gap as remediated | ✅ PASS |
| T3 | gets gap statistics | ✅ PASS |
| F-1 | generates executive summary | ✅ PASS |
| F-2 | generates gap status report | ✅ PASS |
| T1 | stores and retrieves reports | ✅ PASS |
| T2 | registers custom collector | ✅ PASS |
| T3 | calculates compliance scores | ✅ PASS |
| F-1 | detects and flags compliance gaps | ✅ PASS |
| T1 | calculates compliance posture scores | ✅ PASS |
| T2 | identifies critical compliance gaps | ✅ PASS |
| T1 | exports gap data | ✅ PASS |
| T2 | exports posture data | ✅ PASS |
| F-1 | generates executive summary report | ✅ PASS |
| F-2 | generates detailed findings report | ✅ PASS |
| T1 | stores and retrieves reports | ✅ PASS |
| T2 | retrieves reports by type | ✅ PASS |

## All Tests
✓ All 40 tests passing
