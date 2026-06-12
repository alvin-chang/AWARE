#!/usr/bin/env python3
"""
test/unit/azr/test_executor.py — Unit tests for azr.executor.

These tests run the actual sandboxed subprocess (no mocking) against
the real Python interpreter. They are environment-sensitive:
  - On macOS or Linux with POSIX resource limits: full behavior
  - On Windows: resource limits are no-ops, but the rest works
  - On any POSIX system: timeout + memory + fork + forbidden-import
    blocks all behave as designed

NO MODAL ACCESS REQUIRED. The executor is a pure stdlib module.

The test pattern follows the v2 Node test convention (separate test
file per source file, tests grouped by behavior). Python doesn't have
node:test's TAP output, so we use unittest's standard runner and rely
on a thin shell wrapper to translate the exit code.

Run with:
    python3 -m unittest test.unit.azr.test_executor -v
Or:
    python3 -m pytest test/unit/azr/test_executor.py -v    (if pytest installed)
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Make `azr` importable from the repo root when this test is run
# directly (python3 test/unit/azr/test_executor.py).
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from azr.executor import (  # noqa: E402
    DEFAULT_MEMORY_MB,
    DEFAULT_SCRATCH_DIR,
    DEFAULT_TIMEOUT_SECONDS,
    FORBIDDEN_BUILTINS,
    FORBIDDEN_MODULES,
    ExecutionResult,
    SandboxExecutor,
    _infer_function_name,
    verify,
)


# -- Helpers --------------------------------------------------------------


def _make_executor(**kwargs) -> SandboxExecutor:
    """Build an executor with an isolated scratch dir so tests don't
    collide with the default /tmp/azr-sandbox."""
    scratch = Path(tempfile.mkdtemp(prefix="azr-test-"))
    kwargs.setdefault("scratch_dir", str(scratch))
    return SandboxExecutor(**kwargs)


# -- Test classes ---------------------------------------------------------


class TestHappyPath(unittest.TestCase):
    """Solution runs, tests pass."""

    def test_fibonacci_correct(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source=(
                "def fib(n):\n"
                "    if n < 2: return n\n"
                "    return fib(n-1) + fib(n-2)\n"
            ),
            test_source=(
                "assert fib(0) == 0\n"
                "assert fib(1) == 1\n"
                "assert fib(10) == 55\n"
            ),
        )
        self.assertTrue(result.passed)
        self.assertEqual(result.error_kind, "passed")
        self.assertEqual(result.tests_run, 3)
        self.assertEqual(result.tests_failed, 0)
        self.assertGreater(result.duration_ms, 0)
        self.assertTrue(result.sandbox_id)  # UUID assigned

    def test_solution_with_helper_function(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source=(
                "def _square(x):\n"
                "    return x * x\n"
                "def solve(n):\n"
                "    return _square(n) + 1\n"
            ),
            test_source="assert solve(3) == 10\n",
            function_under_test="solve",
        )
        self.assertTrue(result.passed, result.error_message)
        self.assertEqual(result.tests_run, 1)

    def test_inferred_function_name(self) -> None:
        ex = _make_executor()
        # No function_under_test passed — should infer "add" from solution
        result = ex.run(
            solution_source="def add(a, b):\n    return a + b\n",
            test_source="assert add(2, 3) == 5\n",
        )
        self.assertTrue(result.passed, result.error_message)


class TestTestFailure(unittest.TestCase):
    """Solution runs, but an assertion fails."""

    def test_broken_fib(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source="def fib(n):\n    return n * 2\n",
            test_source=(
                "assert fib(0) == 0\n"
                "assert fib(10) == 55\n"
            ),
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "test_failure")
        self.assertGreater(result.tests_failed, 0)
        self.assertEqual(result.tests_run, 2)
        self.assertTrue(result.failure_assertions, "expected line+text capture")

    def test_first_assertion_passes_second_fails(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source="def f(x):\n    return x\n",
            test_source=(
                "assert f(1) == 1\n"      # passes
                "assert f(2) == 999\n"    # fails — first failure wins
            ),
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "test_failure")


class TestTimeout(unittest.TestCase):
    """Wall-clock timeout kills the solution."""

    def test_infinite_loop_killed(self) -> None:
        ex = _make_executor(timeout_seconds=1, memory_mb=128)
        result = ex.run(
            solution_source="def loop(n):\n    while True: pass\n",
            test_source="assert loop(1) == 0\n",
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "timeout")
        # 1s timeout, with some subprocess startup slack
        self.assertGreater(result.duration_ms, 900)
        self.assertLess(result.duration_ms, 5000)

    @unittest.skipIf(sys.platform == "win32", "POSIX resource limits only")
    def test_cpu_intensive_killed_by_cpu_limit(self) -> None:
        """A solution that uses lots of CPU but is not infinite-loop
        should also be killed by the RLIMIT_CPU sandbox."""
        ex = _make_executor(timeout_seconds=2, memory_mb=128)
        # CPU-bound tight loop. With AZR_SANDBOX_CPU_SECONDS=10, this
        # could in theory complete in 10s. We use timeout_seconds=2 as
        # the wall-clock backstop to keep the test fast.
        result = ex.run(
            solution_source=(
                "def spin():\n"
                "    s = 0\n"
                "    for i in range(10**8):\n"
                "        s += i\n"
                "    return s\n"
            ),
            test_source="assert spin() >= 0\n",
        )
        # Either timeout (RLIMIT_CPU or wall-clock) or runtime_error
        # from a SIGXCPU-induced fault — both are acceptable.
        self.assertFalse(result.passed)
        self.assertIn(result.error_kind, ("timeout", "runtime_error"))


class TestSecurity(unittest.TestCase):
    """The hard sandbox actually blocks forbidden operations."""

    def test_forbidden_import_os(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source="import os\ndef f(x):\n    return os.listdir('/')\n",
            test_source="assert f(1)\n",
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "forbidden_import")
        self.assertIn("os", result.error_message)

    def test_forbidden_import_subprocess(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source=(
                "import subprocess\n"
                "def f(x):\n"
                "    return subprocess.run(['echo', 'pwned'])\n"
            ),
            test_source="assert f(1)\n",
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "forbidden_import")
        self.assertIn("subprocess", result.error_message)

    def test_forbidden_import_socket(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source=(
                "import socket\n"
                "def f(x):\n"
                "    s = socket.socket()\n"
                "    return s\n"
            ),
            test_source="assert f(1)\n",
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "forbidden_import")
        self.assertIn("socket", result.error_message)

    def test_open_in_solution_blocked(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source=(
                "def f(x):\n"
                "    with open('/etc/passwd') as fp: return fp.read()\n"
            ),
            test_source="assert f(1)\n",
        )
        self.assertFalse(result.passed)
        # `open` is a forbidden builtin — solution sees NameError
        self.assertEqual(result.error_kind, "runtime_error")
        self.assertIn("open", result.error_message)

    def test_open_in_test_blocked(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source="def f(x):\n    return x\n",
            test_source=(
                "import os\n"
                "os.system('echo pwned')\n"
                "assert f(1) == 1\n"
            ),
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "forbidden_import")
        self.assertIn("os", result.error_message)

    def test_exec_in_solution_blocked(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source=(
                "def f(x):\n"
                "    exec('import os; os.system(\"echo pwned\")')\n"
                "    return x\n"
            ),
            test_source="assert f(1) == 1\n",
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "runtime_error")
        self.assertIn("exec", result.error_message)


class TestSandboxIsolation(unittest.TestCase):
    """The runner process is isolated; runner-internal state is not
    leaked into the solution's namespace."""

    def test_runner_isolates_dunder_names(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source=(
                "def f(x):\n"
                "    # Try to reach the runner's saved open/exec\n"
                "    try:\n"
                "        _orig_open = open\n"
                "    except NameError:\n"
                "        return 'open stripped'\n"
                "    return 'open still accessible'\n"
            ),
            test_source="assert f(1) == 'open stripped'\n",
        )
        self.assertTrue(result.passed, result.error_message)

    def test_solution_cannot_escape_scratch_via_chdir(self) -> None:
        """A solution that tries `os.chdir('/tmp')` and then open()
        a file there should still fail, because both os and open are
        blocked."""
        ex = _make_executor()
        result = ex.run(
            solution_source=(
                "import os\n"
                "def f(x):\n"
                "    os.chdir('/tmp')\n"
                "    with open('foo') as fp: return fp.read()\n"
            ),
            test_source="assert f(1)\n",
        )
        self.assertFalse(result.passed)
        # The os import raises before chdir runs, so we get forbidden_import
        self.assertEqual(result.error_kind, "forbidden_import")

    def test_scratch_dir_cleaned_up(self) -> None:
        ex = _make_executor()
        scratch = Path(ex.scratch_dir)
        before = set(scratch.iterdir()) if scratch.exists() else set()
        result = ex.run(
            solution_source="def f(x):\n    return x + 1\n",
            test_source="assert f(2) == 3\n",
        )
        self.assertTrue(result.passed)
        after = set(scratch.iterdir()) if scratch.exists() else set()
        # The per-run UUID dir should have been removed
        new = after - before
        self.assertEqual(len(new), 0,
                         f"scratch dir not cleaned up, leftovers: {new}")


class TestErrorReporting(unittest.TestCase):
    """Diagnostics are useful, not just True/False."""

    def test_syntax_error_caught(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source="def f(:\n    return 1\n",  # invalid Python
            test_source="assert f(1) == 1\n",
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "syntax_error")
        self.assertTrue(result.error_message)

    def test_function_not_found(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source="def some_function(x):\n    return x\n",
            test_source="assert f(1) == 1\n",
            function_under_test="f",  # does not exist in solution
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "runtime_error")
        self.assertIn("not found in solution", result.error_message)

    def test_runtime_error_in_solution(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source="def f(x):\n    return 1 / 0\n",
            test_source="assert f(1) == 1\n",
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.error_kind, "runtime_error")
        self.assertIn("ZeroDivisionError", result.error_message)

    def test_stdout_truncated_to_1k(self) -> None:
        ex = _make_executor()
        big = "x" * 5000
        result = ex.run(
            solution_source=f"def f():\n    print({big!r})\n    return 1\n",
            test_source="assert f() == 1\n",
        )
        # stdout is captured by the sandbox runner; the solution's print
        # may or may not survive (the runner's exec doesn't pipe to stdout
        # in this version), but if any stdout comes back, it's capped.
        self.assertLessEqual(len(result.stdout_truncated), 1024)

    def test_to_dict_round_trip(self) -> None:
        ex = _make_executor()
        result = ex.run(
            solution_source="def f(x):\n    return x\n",
            test_source="assert f(1) == 1\n",
        )
        d = result.to_dict()
        self.assertIsInstance(d, dict)
        self.assertIn("passed", d)
        self.assertIn("error_kind", d)
        self.assertIn("duration_ms", d)
        self.assertIn("sandbox_id", d)


class TestInferFunctionName(unittest.TestCase):
    """The AST-based inference used when function_under_test is not given."""

    def test_first_def_wins(self) -> None:
        src = "def helper(x):\n    return x\ndef solve(n):\n    return n * 2\n"
        self.assertEqual(_infer_function_name(src), "helper")

    def test_no_def_returns_magic(self) -> None:
        self.assertEqual(_infer_function_name("x = 5\n"), "__unknown_function__")

    def test_syntax_error_returns_magic(self) -> None:
        self.assertEqual(_infer_function_name("def :\n  pass\n"), "__unknown_function__")


class TestConstants(unittest.TestCase):
    """The default constants are documented and importable."""

    def test_default_scratch_dir_is_under_tmp(self) -> None:
        self.assertTrue(DEFAULT_SCRATCH_DIR.startswith("/tmp/"))

    def test_default_timeout_is_5_seconds(self) -> None:
        self.assertEqual(DEFAULT_TIMEOUT_SECONDS, 5)

    def test_default_memory_is_128mb(self) -> None:
        self.assertEqual(DEFAULT_MEMORY_MB, 128)

    def test_forbidden_modules_includes_obvious_dangerous(self) -> None:
        self.assertIn("os", FORBIDDEN_MODULES)
        self.assertIn("subprocess", FORBIDDEN_MODULES)
        self.assertIn("socket", FORBIDDEN_MODULES)
        self.assertIn("urllib", FORBIDDEN_MODULES)
        self.assertIn("ctypes", FORBIDDEN_MODULES)

    def test_forbidden_builtins_includes_obvious_dangerous(self) -> None:
        self.assertIn("open", FORBIDDEN_BUILTINS)
        self.assertIn("exec", FORBIDDEN_BUILTINS)
        self.assertIn("eval", FORBIDDEN_BUILTINS)
        self.assertIn("__import__", FORBIDDEN_BUILTINS)

    def test_open_in_forbidden_builtins_even_though_read_useful(self) -> None:
        """Open in write mode is dangerous. Open in read mode is
        convenient but provides an exfiltration channel (the solution
        could read AWARE_POSTGRES_PASSWORD from a config file the
        runner has access to). We block all of open, even read mode.
        If a task needs file input, the test harness passes the data
        as a parameter to the solution."""
        self.assertIn("open", FORBIDDEN_BUILTINS)


class TestConvenienceFunction(unittest.TestCase):
    """The module-level `verify` works as a one-shot API."""

    def test_verify_passes(self) -> None:
        result = verify(
            solution_source="def f(x):\n    return x * 2\n",
            test_source="assert f(5) == 10\n",
        )
        self.assertTrue(result.passed)


class TestResourceLimits(unittest.TestCase):
    """POSIX resource limits actually fire (skipped on Windows/macOS).

    macOS accepts RLIMIT_AS setters but does not actually enforce them
    on most kernels (Darwin's resource handling is famously partial).
    The executor's _set_resource_limits already catches the exception
    silently on macOS. We document that gap here: a runaway allocation
    on a macOS dev box can OOM the host process, not the sandbox.
    In production (Modal Linux containers, CI Linux runners) the limits
    work as designed.
    """

    @unittest.skipIf(
        sys.platform != "linux",
        "RLIMIT_AS is a no-op on macOS and unsupported on Windows"
    )
    def test_memory_limit_kills_runaway_allocator(self) -> None:
        ex = _make_executor(memory_mb=64, timeout_seconds=5)
        # Allocate 256 MB — should hit RLIMIT_AS
        result = ex.run(
            solution_source=(
                "def f(x):\n"
                "    return 'x' * (256 * 1024 * 1024)\n"
            ),
            test_source="assert len(f(1)) > 0\n",
        )
        self.assertFalse(result.passed)
        # Memory exceeded can manifest as runtime_error (OOM) or timeout
        self.assertIn(result.error_kind, ("runtime_error", "timeout"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
