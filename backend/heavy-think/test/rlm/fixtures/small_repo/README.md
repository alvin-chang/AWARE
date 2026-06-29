# small_repo

Fixture repo for rlm() U1 contract tests. ~10 files, intentionally small.

Layout:
- src/auth.py — auth helpers
- src/api.py — request handlers
- src/models.py — User/Session dataclasses
- src/utils.py — generic helpers (note: parse_int and to_dict are duplicated
  patterns — ideal refactor candidate)
- src/db.py — JSON-backed storage
- src/main.py — entry point
- src/__init__.py
- tests/test_auth.py
- tests/test_utils.py
- tests/__init__.py

Notes for the LM:
- `src/utils.py` has patterns duplicated across other modules (to_dict,
  parse_int). Detectable via `grep` across `src/`.
- `src/db.py` and `src/models.py` have no corresponding test file.
- `src/main.py` is short — likely fine, no concerns.