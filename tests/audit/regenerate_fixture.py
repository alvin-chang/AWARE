#!/usr/bin/env python3
"""
Regenerate tests/audit/fixtures/vaara_v130.jsonl.

This fixture is a deterministic, recorded set of 50 mock Vaara
`AuditEventResponse` objects (one per gateway tool-call round trip),
hash-chained via `previous_hash → record_hash`. It exists so the
AWARE-side test (`test_vaara_integration.py`) can replay the chain
through the adapter without spinning up a real Vaara HTTP server.

The chain is computed locally with `hashlib.sha256` over a canonical
JSON serialization of the event body + previous hash — same algorithm
the in-test `MockVaaraHandler._handle_append` uses, so the fixture
and the live mock are byte-equivalent for chain verification.

Usage:
    python tests/audit/regenerate_fixture.py
    python tests/audit/regenerate_fixture.py --out /tmp/foo.jsonl --count 100

Why Python (and not a Node script): the test runner is pytest, and a
sibling Python script keeps the regeneration step in one toolchain.
The fixture file is plain NDJSON, so any language can consume it.

Fixture contract (per line):
    {
      "record_id":       "rec_0001",
      "record_hash":     "<64-hex>",
      "previous_hash":   "0"*64 for the first record, else <prev record_hash>,
      "timestamp":       "2026-07-15T10:00:00.000Z",
      "payload":         { ... the event body that was POSTed ... }
    }
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "vaara_v130.jsonl"


def _canonical_event(seq: int, parent_seq: int | None) -> dict:
    """Synthesize the event body that the gateway would POST.

    Mirrors the shape that AWARE's `decision-logger.logDecision` takes:
    decisionId/parentDecisionId/timestamp/actor/action/context/outcome.
    """
    return {
        "event_type": "action_requested",
        "action_id": f"act_{seq:04d}",
        "agent_id": "agent-007",
        "tool_name": "mcp.tool",
        "data": {
            "decisionId": f"dec_{seq:04d}",
            "parentDecisionId": (
                f"dec_{parent_seq:04d}" if parent_seq is not None else None
            ),
            "timestamp": "2026-07-15T10:00:00.000Z",
            "actor": {"agentId": "agent-007", "trustScore": 0.9},
            "action": {"type": "tool_call", "target": f"mcp://tool/{seq}"},
            "context": {},
            "outcome": {
                "success": True,
                "latencyMs": 12,
                "errorMessage": None,
            },
        },
    }


def _record_hash(payload: dict, prev_hash: str) -> str:
    """Server-side receipt hash: SHA-256(JCS-canonical payload) + prev."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(
        (canonical + prev_hash).encode("utf-8")
    ).hexdigest()


def build_chain(count: int) -> list[dict]:
    """Build `count` chained mock Vaara receipts."""
    out = []
    prev_hash = "0" * 64
    # 2026-07-15T10:00:00Z (Unix epoch seconds). Using a fixed
    # timestamp keeps the fixture byte-deterministic across regenerations.
    base_ts = 1784109600
    for i in range(count):
        body = _canonical_event(i, i - 1 if i > 0 else None)
        digest = _record_hash(body, prev_hash)
        record = {
            "record_id": f"rec_{i + 1:04d}",
            "record_hash": digest,
            "previous_hash": prev_hash,
            "timestamp": _format_ts(base_ts + i),
            "payload": body,
        }
        out.append(record)
        prev_hash = digest
    return out


def _format_ts(epoch_seconds: int) -> str:
    """Format a Unix timestamp as RFC 3339 / ISO 8601 in UTC.

    We hand-format instead of using `time.strftime` to avoid the local-TZ
    surprise on macOS where `time.gmtime` is correct but strftime's %Z
    prints the local zone. ISO format with explicit 'Z' is unambiguous.
    """
    from datetime import datetime, timezone
    return (
        datetime.fromtimestamp(epoch_seconds, tz=timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%S.000Z")
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=str(FIXTURE_PATH),
        help="output path (default: tests/audit/fixtures/vaara_v130.jsonl)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=50,
        help="number of records to generate (default: 50, matches AC)",
    )
    args = parser.parse_args(argv)

    chain = build_chain(args.count)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        for rec in chain:
            fh.write(json.dumps(rec, sort_keys=True))
            fh.write("\n")
    print(f"wrote {len(chain)} records to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))