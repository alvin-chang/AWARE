#!/usr/bin/env python3
"""
Independent verifier for AWARE decision-chain.jsonl.

Re-implements the canonicalization rules of src/audit/decision-logger.js
(canonicalSerialize + computeRecordHash) using only Python stdlib
(json, hashlib, pathlib, sys), so an auditor can verify a chain
without trusting the AWARE binary.

Per ADR (internal) F-2: canonical JSON = sorted keys, no spaces, hash
field excluded; SHA256(canonical + prevHash).

Exit codes:
    0 = PASS
    1 = FAIL (hash mismatch, chain break, or malformed JSON)
    2 = invocation error (bad args, file missing)

Usage:
    python3 scripts/verify_chain.py path/to/decision-chain.jsonl
    python3 scripts/verify_chain.py --json path/to/decision-chain.jsonl
"""

import hashlib
import json
import pathlib
import sys

GENESIS_HASH = "0" * 64


def canonical_payload(record):
    """Return the canonical JSON bytes for hashing.

    Mirrors canonicalSerialize() in src/audit/decision-logger.js:71-93.

    Two non-obvious rules inherited from the JS implementation:
      1. The 'hash' field is excluded from the hash computation (it IS
         the hash; including it would be a fixed-point).
      2. JSON.stringify() in JS preserves the insertion order of nested
         object keys; it does NOT recursively sort them. So we sort
         keys only at the top level (matching canonicalSerialize's
         fieldOrder construction) and preserve nested insertion order
         from the parsed record.

    Round-trip invariant: the verifier reads a record from the JSONL
    file (which was written by decision-logger.js in canonical form),
    drops the 'hash' key, and re-emits it; the resulting bytes must
    match what decision-logger.js would have produced. Since nested
    keys were written in source-code order and Python's json.dumps
    with sort_keys=True would re-sort them, we need a custom encoder.
    """
    sans_hash = {k: v for k, v in record.items() if k != "hash"}

    class _TopSort(json.JSONEncoder):
        # Sort keys only at the top level; preserve insertion order
        # at every nesting level (matching JS JSON.stringify semantics).
        def encode(self, o):
            if self._top_done:
                return super().encode(o)
            self._top_done = True
            if isinstance(o, dict):
                pairs = ",".join(
                    json.dumps(k) + ":" + self.encode(v)
                    for k, v in sorted(o.items())
                )
                return "{" + pairs + "}"
            return super().encode(o)

    enc = _TopSort(separators=(",", ":"), sort_keys=False)
    enc._top_done = False
    return enc.encode(sans_hash)


def compute_hash(record, prev_hash):
    """SHA-256 over (canonical_json || prev_hash). Mirrors
    computeRecordHash() in decision-logger.js:102-106.
    """
    payload = canonical_payload(record) + prev_hash
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verify(path, *, json_output=False, verify_only=None):
    """Walk a JSONL chain; return (status, records_checked, info).

    On the first failure, prints a diagnostic to stderr and returns
    ('FAIL', records_checked, reason).
    """
    expected_prev = GENESIS_HASH
    count = 0
    try:
        text = pathlib.Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"FAIL: file not found: {path}", file=sys.stderr)
        return ("FAIL", 0, "file-not-found")

    for lineno, raw in enumerate(text.splitlines(), start=1):
        if verify_only is not None and count >= verify_only:
            break
        if not raw.strip():
            continue
        try:
            record = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(f"FAIL line {lineno}: malformed JSON ({exc.msg})",
                  file=sys.stderr)
            return ("FAIL", count, "malformed-json")

        if "prevHash" not in record or "hash" not in record:
            print(f"FAIL line {lineno}: missing prevHash/hash field",
                  file=sys.stderr)
            return ("FAIL", count, "missing-fields")

        if record["prevHash"] != expected_prev:
            print(
                f"FAIL line {lineno}: prevHash mismatch (chain break): "
                f"expected {expected_prev}, got {record['prevHash']}",
                file=sys.stderr,
            )
            return ("FAIL", count, "chain-break")

        expected = compute_hash(record, record["prevHash"])
        if expected != record["hash"]:
            print(
                f"FAIL line {lineno}: hash mismatch: "
                f"expected {expected}, got {record['hash']}",
                file=sys.stderr,
            )
            return ("FAIL", count, "hash-mismatch")

        expected_prev = record["hash"]
        count += 1

    if json_output:
        print(json.dumps({"status": "PASS", "records": count}))
    else:
        print(f"PASS verified {count} records")
    return ("PASS", count, None)


def main(argv):
    json_output = False
    verify_only = None
    args = []
    for a in argv[1:]:
        if a == "--json":
            json_output = True
        elif a.startswith("--verify-only="):
            verify_only = int(a.split("=", 1)[1])
        elif a == "--help" or a == "-h":
            print(__doc__)
            return 0
        else:
            args.append(a)
    if len(args) != 1:
        print("usage: verify_chain.py [--json] [--verify-only=N] <jsonl>",
              file=sys.stderr)
        return 2
    status, _count, _reason = verify(args[0], json_output=json_output,
                                     verify_only=verify_only)
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))