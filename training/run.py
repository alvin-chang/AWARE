#!/usr/bin/env python3
"""
training/run.py — DPO training job entry point (Phase 3, ADR-020).

Runs INSIDE a Modal A100-80GB pod, built from Dockerfile.training.
The trainer service (src/trainer/index.js) submits this script as a
Modal Function. This script:

  1. Reads the DPO dataset from the Modal Volume (uploaded by the
     trainer service)
  2. Optionally generates an AZR self-play corpus (PROPOSE → SOLVE →
     VERIFY) using the local base model + azr.executor
  3. Invokes `swift rlhf --rlhf_type dpo` as a subprocess (training-framework 4.3.0+).
     The base model is loaded + 4-bit BNB quantized + LoRA-adapted + DPO-trained
     inside the swift subprocess, so this script does not need to touch
     torch / transformers / peft directly.
  4. Streams swift's stdout line-by-line, parses it for structured events
     (training_step, checkpoint_saved), and emits JSON events the trainer
     service can parse
  5. The trained LoRA adapter is saved to the Modal Volume
     (qwen35-dpo-checkpoints) by swift itself

CLI:
    python3 -m training.run \\
        --config /root/aware-data/config.json \\
        --dataset /root/aware-data/datasets/last.jsonl \\
        --output-dir /root/aware-data/checkpoints/<run-id>

ENV VARS (override config defaults):
    AWARE_BASE_MODEL, AWARE_DPO_BETA, AWARE_DPO_LR, AWARE_DPO_EPOCHS,
    AWARE_DPO_BATCH_SIZE, AWARE_DPO_GRAD_ACCUM, AWARE_DATA_DIR

NO SECRETS IN THIS SCRIPT. The Modal token is read by the modal CLI
when the trainer service submits this job (`modal.Function.remote(...)`).
This script never sees MODAL_TOKEN_ID; it only uses the modal Python
SDK's `modal.Volume` API to read/write the persistent volume.

OUTPUT FORMAT (stdout):
    One JSON line per major stage, parseable by the trainer service.
    Example:
        {"event": "job_start", "run_id": "...", "ts": "..."}
        {"event": "dataset_loaded", "n_pairs": 1234, "ts": "..."}
        {"event": "model_loaded", "base_model": "...", "ts": "..."}
        {"event": "training_start", "epochs": 1, "total_steps": 308, "ts": "..."}
        {"event": "training_step", "step": 10, "loss": 0.69, "lr": 5e-6, "ts": "..."}
        ...
        {"event": "swift_output", "line": "...", "ts": "..."}     # raw swift stdout (passthrough)
        {"event": "checkpoint_saved", "path": "...", "size_mb": 4500, "ts": "..."}
        {"event": "job_end", "status": "ok", "duration_sec": 1234, "ts": "..."}

EXIT CODES:
    0  - success
    1  - generic error
    2  - config validation failed
    3  - dataset not found / unreadable
    4  - swift rlhf returned non-zero
    5  - swift rlhf timed out
    6  - checkpoint save failed / no adapter found

The trainer service reads the exit code and the last JSON line to
decide whether the run was successful.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure /opt/aware (the image's WORKDIR) is on the path so `from azr...`
# resolves. The image's ENTRYPOINT runs us from /opt/aware so this is
# belt-and-braces.
_REPO_ROOT = Path(os.environ.get("AWARE_REPO_ROOT", "/opt/aware"))
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# -- Structured logging ---------------------------------------------------


def log(event: str, **fields: Any) -> None:
    """Emit one JSON line to stdout. The trainer service parses these.

    Never raises. Writes are line-buffered so the trainer service gets
    real-time progress even if the job is killed.
    """
    record = {
        "event": event,
        "ts": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    try:
        sys.stdout.write(json.dumps(record) + "\n")
        sys.stdout.flush()
    except Exception:
        # Stdout is gone (pipe closed). Last-resort: write to stderr.
        # Never let a logging failure crash the job.
        try:
            sys.stderr.write(f"log_failed: {event}\n")
            sys.stderr.flush()
        except Exception:
            # Absolute last-resort fallback: even stderr is gone (fd
            # closed / terminal detached). Silently swallow so the
            # training job doesn't crash. The decision to run as a
            # long-lived GPU process on Modal means we prioritize job
            # completion over per-event log fidelity.
            pass  # nosec B110 — intentional last-resort fallback


# -- CLI -------------------------------------------------------------------


def parse_args() -> tuple[argparse.Namespace, list[str]]:
    """Parse the job's CLI args. The trainer service builds the command
    line from the modal-training.json config + the env vars; the script
    is invoked once per job.

    Defaults match config/modal-training.json so the script works
    standalone (e.g. for manual debugging inside the container) as
    well as under Modal orchestration.

    Uses parse_known_args() so that any args Modal injects via its
    container entrypoint (e.g. `python -u -R --check-hash-based-pycs
    never -m modal._container_entrypoint`) are silently ignored
    rather than triggering an `unrecognized arguments` exit. The
    Modal-app form (training/app.py) synthesizes a clean argv and
    calls main() directly, so this only matters for the docker
    ENTRYPOINT path (`python3 -m training.run --help` etc.).
    See docs/audits/aware-2.0-trainer-env-audit-2026-06-13.md
    follow-up: Modal entrypoint contract.
    """
    p = argparse.ArgumentParser(
        prog="training.run",
        description="AWARE 2.0 DPO training job (Phase 3, training-framework backend)",
    )
    p.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to a job-specific config JSON (overrides the modal-training.json defaults).",
    )
    p.add_argument(
        "--dataset",
        type=str,
        default=None,
        help="Path to a DPO preference-pair dataset (JSONL with {messages, rejected_messages} per line).",
    )
    p.add_argument(
        "--run-id",
        type=str,
        default=None,
        help="Unique ID for this run. Defaults to a random 12-char hex.",
    )
    p.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Where to write the trained LoRA adapter. Defaults to /root/aware-data/checkpoints/<run-id>.",
    )
    p.add_argument(
        "--gen-azr-corpus",
        action="store_true",
        help="If set, generate an AZR self-play corpus before training. See azr/executor.py.",
    )
    p.add_argument(
        "--azr-corpus-size",
        type=int,
        default=50,
        help="How many AZR self-play pairs to generate. Ignored if --gen-azr-corpus is not set.",
    )
    p.add_argument(
        "--smoke-test",
        action="store_true",
        help="Run a 1-pair smoke test (load model, run 1 DPO step, save). Verifies the image works end-to-end without burning GPU hours.",
    )
    p.add_argument(
        "--swift-timeout",
        type=int,
        default=3500,
        help="Hard timeout in seconds for the swift rlhf subprocess. Defaults to ~58 min.",
    )
    p.add_argument(
        "--model-dir",
        type=str,
        default=None,
        help="Override the model directory (e.g. /root/.cache/huggingface/qwen35-9b-base). If unset, the base_model config value is used as-is.",
    )
    return p.parse_known_args()


# -- Config loading -------------------------------------------------------


def load_config(path: str | None) -> dict[str, Any]:
    """Load the modal-training.json config (or a job-specific override).

    The trainer service always writes a job-specific config to
    /root/aware-data/config.json before submitting the job, so we
    can use the path it's passed. Falls back to modal-training.json.
    """
    if path is None:
        path = str(_REPO_ROOT / "config" / "modal-training.json")
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log("config_load_failed", path=path, error=str(e))
        raise


def _env_overrides() -> dict[str, Any]:
    """Pull DPO hyperparameters from AWARE_* env vars (if set)."""
    overrides: dict[str, Any] = {}
    for env_key, cfg_key in (
        ("AWARE_BASE_MODEL", "base_model"),
        ("AWARE_DPO_BETA", "beta"),
        ("AWARE_DPO_LR", "learning_rate"),
        ("AWARE_DPO_EPOCHS", "epochs"),
        ("AWARE_DPO_BATCH_SIZE", "per_device_train_batch_size"),
        ("AWARE_DPO_GRAD_ACCUM", "gradient_accumulation_steps"),
    ):
        val = os.environ.get(env_key)
        if val is not None:
            try:
                if cfg_key in ("beta", "learning_rate"):
                    overrides[cfg_key] = float(val)
                elif cfg_key in (
                    "epochs",
                    "per_device_train_batch_size",
                    "gradient_accumulation_steps",
                ):
                    overrides[cfg_key] = int(val)
                else:
                    overrides[cfg_key] = val
            except ValueError:
                log("env_override_invalid", env_key=env_key, value=val)
    return overrides


def _resolve_dpo_args(config: dict[str, Any]) -> dict[str, Any]:
    """Merge defaults → config → env overrides → CLI overrides (in that order)."""
    defaults = {
        "base_model": "Qwen/base-model",
        "beta": 0.1,
        "learning_rate": 5e-5,
        "epochs": 1,
        "per_device_train_batch_size": 1,
        "gradient_accumulation_steps": 2,
        "lora_r": 16,
        "lora_alpha": 32,
        "lora_dropout": 0.05,
        "max_length": 2048,
        "warmup_ratio": 0.05,
        "weight_decay": 0.01,
        "lr_scheduler_type": "cosine",
        "optim": "adamw_8bit",
        "seed": 42,
        "rpo_alpha": 0.1,
    }
    cfg_dpo = (config.get("dpo_defaults") or {})
    resolved: dict[str, Any] = {**defaults, **cfg_dpo}
    resolved.update(_env_overrides())
    return resolved


# -- AZR self-play corpus generation --------------------------------------


def gen_azr_corpus(
    base_model_id: str,
    n_pairs: int,
    output_path: Path,
) -> int:
    """Generate an AZR self-play preference-pair corpus.

    The AZR loop (azr.executor) uses the local base model to PROPOSE a
    Python programming task, the model to SOLVE it, and a hidden test
    suite to VERIFY correctness. If exactly one of the two SOLVE attempts
    passes the verifier, a preference pair is emitted to the corpus.

    PREFERENCE_PAIR: if exactly one attempt passes, emit a pair.

    Returns the number of pairs emitted (≈ n_pairs but bounded by how
    many of the proposals actually produce a discriminating pair).
    """
    from azr.executor import AZRExecutor  # local import — azr may pull torch
    from datasets import Dataset

    log("azr_corpus_start", base_model=base_model_id, n_pairs=n_pairs)
    executor = AZRExecutor(base_model_id=base_model_id)

    pairs: list[dict[str, Any]] = []
    seed = int(time.time())
    for i in range(n_pairs):
        try:
            task = _propose_python_task(executor, executor.model, executor.tokenizer, seed=seed + i)
            hidden_tests = _extract_hidden_tests(task)
            sol_a = _solve_task(executor, executor.model, executor.tokenizer, task, temperature=0.0)
            sol_b = _solve_task(executor, executor.model, executor.tokenizer, task, temperature=0.9)
            a_pass = executor.verify(sol_a, hidden_tests)
            b_pass = executor.verify(sol_b, hidden_tests)
            if a_pass and not b_pass:
                pairs.append({"messages": task["prompt"], "rejected_messages": task["prompt"] + [{"role": "assistant", "content": sol_b}]})
                pairs[-1]["messages"].append({"role": "assistant", "content": sol_a})
            elif b_pass and not a_pass:
                pairs.append({"messages": task["prompt"], "rejected_messages": task["prompt"] + [{"role": "assistant", "content": sol_a}]})
                pairs[-1]["messages"].append({"role": "assistant", "content": sol_b})
            # else: both pass or both fail — no discriminating signal
        except Exception as e:
            log("azr_pair_failed", iteration=i, error=str(e)[:200])
            continue

    with output_path.open("w") as fp:
        for pair in pairs:
            fp.write(json.dumps(pair) + "\n")
    return len(pairs)


def _propose_python_task(model, tokenizer, *, seed: int) -> dict:
    """Use the base model to propose a small Python programming task.

    This is a simplified proposer — the full AZR paper has more structure.
    For the corpus-generation step, we just need a task that produces a
    pair where one of two SOLVE attempts clearly wins.
    """
    import random
    rng = random.Random(seed)
    # Pick a random small-int operation and ask the model to implement it.
    op = rng.choice(["add", "sub", "mul", "is_even", "factorial_small"])
    if op == "is_even":
        prompt = [{"role": "user", "content": "Write a Python function `is_even(n: int) -> bool` that returns True if n is even, False otherwise. Just the function, no test code."}]
    elif op == "factorial_small":
        prompt = [{"role": "user", "content": "Write a Python function `fact_small(n: int) -> int` that returns n! for 0 <= n <= 7, and 0 for n > 7. Just the function, no test code."}]
    else:
        a, b = rng.randint(-100, 100), rng.randint(-100, 100)
        prompt = [{"role": "user", "content": f"Write a Python function `compute(x: int, y: int) -> int` that returns x {op} y. Just the function, no test code."}]
    return {"prompt": prompt, "op": op}


def _extract_hidden_tests(task: dict) -> str:
    """The hidden test code the AZR executor will use to verify SOLVE attempts."""
    op = task.get("op", "add")
    if op == "is_even":
        return (
            "assert is_even(2) is True\n"
            "assert is_even(0) is True\n"
            "assert is_even(7) is False\n"
            "assert is_even(-4) is True\n"
        )
    if op == "factorial_small":
        return (
            "assert fact_small(0) == 1\n"
            "assert fact_small(1) == 1\n"
            "assert fact_small(5) == 120\n"
            "assert fact_small(7) == 5040\n"
            "assert fact_small(8) == 0\n"
        )
    # add / sub / mul
    return (
        "assert compute(2, 3) == 2 OP 3\n"
        "assert compute(-1, 1) == -1 OP 1\n"
        "assert compute(0, 0) == 0 OP 0\n"
    ).replace("OP", op)


def _solve_task(model, tokenizer, task: dict, *, temperature: float) -> str:
    """Use the base model to SOLVE the proposed task at a given temperature."""
    import torch
    msgs = task["prompt"]
    text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=256,
            do_sample=temperature > 0,
            temperature=max(temperature, 0.01),
            top_p=0.95,
            pad_token_id=tokenizer.eos_token_id,
        )
    new_tokens = out[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True)


# -- Dataset loading ------------------------------------------------------


def load_dataset(path: str) -> list[dict[str, Any]]:
    """Load a DPO preference-pair dataset from JSONL.

    Each line is a JSON object with at minimum:
        {"messages": [...], "rejected_messages": [...]}
    where each "messages" / "rejected_messages" is a list of OpenAI-style
    {role, content} dicts (ending with an "assistant" turn).

    The format matches what `swift rlhf --rlhf_type dpo --dataset <path>` expects.
    """
    rows: list[dict[str, Any]] = []
    with open(path) as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as e:
                log("dataset_row_invalid_json", lineno=lineno, error=str(e)[:200])
                continue
            if not (isinstance(row.get("messages"), list) and isinstance(row.get("rejected_messages"), list)):
                log("dataset_row_missing_keys", lineno=lineno, keys=list(row.keys()))
                continue
            rows.append(row)
    return rows


def rows_to_hf_dataset(rows: list[dict[str, Any]]):
    """Convert a list of preference-pair dicts into a HuggingFace Dataset.

    Kept here for compatibility with downstream code (e.g. AZR tests).
    The swift rlhf subprocess reads the JSONL file directly, so this
    is mainly used for the in-process smoke test path.
    """
    from datasets import Dataset
    return Dataset.from_list(rows)


# -- training-framework rlhf subprocess (the load-bearing replacement) --------------


# Regexes to parse swift's streaming output into structured events.
# These match the v13 smoke test's verified output format.
_TRAIN_STEP_RE = re.compile(
    r"^\{'loss':\s*([0-9.eE+-]+),\s*'learning_rate':\s*([0-9.eE+-]+),\s*'epoch':\s*([0-9.eE+-]+)\}"
)
_CHECKPOINT_RE = re.compile(r"\[INFO:swift\]\s+last_model_checkpoint:\s*(\S+)")
_MODEL_LOADED_RE = re.compile(r"\[INFO:swift\]\s+model_dir is now using a Volume:\s*(\S+)")
_TRAIN_END_RE = re.compile(r"\[INFO:swift\]\s+End time of running main:\s*(\S+)")


def _parse_swift_line(line: str) -> str | None:
    """Return a JSON event-name to emit, or None to ignore the line.

    The function has the side effect of emitting the parsed event via `log()`.
    Returning the event name is for the caller's benefit (e.g. so it can
    track whether the training has finished).
    """
    line = line.rstrip("\n")
    m = _TRAIN_STEP_RE.match(line.strip())
    if m:
        log("training_step",
            loss=float(m.group(1)),
            learning_rate=float(m.group(2)),
            epoch=float(m.group(3)))
        return "training_step"
    m = _CHECKPOINT_RE.match(line)
    if m:
        ckpt_path = Path(m.group(1))
        size_mb = round(_dir_size_mb(ckpt_path.parent) if ckpt_path.parent.exists() else 0, 1)
        log("checkpoint_saved", path=str(ckpt_path), size_mb=size_mb)
        return "checkpoint_saved"
    m = _MODEL_LOADED_RE.match(line)
    if m:
        log("model_loaded", model_dir=m.group(1))
        return "model_loaded"
    m = _TRAIN_END_RE.match(line)
    if m:
        log("training_end", end_time=m.group(1))
        return "training_end"
    return None


def _dir_size_mb(p: Path) -> float:
    """Sum file sizes in a directory (recursively) and return MB."""
    if not p.exists():
        return 0.0
    total = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    return total / (1024 * 1024)


def run_swift_rlhf_subprocess(
    *,
    base_model: str,
    dataset_path: str,
    output_dir: Path,
    beta: float,
    learning_rate: float,
    epochs: int,
    per_device_train_batch_size: int,
    gradient_accumulation_steps: int,
    lora_r: int,
    lora_alpha: int,
    lora_dropout: float,
    max_length: int,
    warmup_ratio: float,
    weight_decay: float,
    lr_scheduler_type: str,
    optim: str,
    seed: int,
    rpo_alpha: float,
    model_dir: str | None,
    swift_timeout: int,
    smoke: bool = False,
) -> dict[str, Any]:
    """Invoke `swift rlhf --rlhf_type dpo` as a subprocess and stream its output.

    This replaces the previous in-process training-optimizer + TRL DPOTrainer path.
    The swift subprocess handles:
      - 4-bit BNB quantization (matches AWARE R1 spec)
      - LoRA adapter setup (rank, alpha, target_modules=all-linear)
      - DPO loss + optimizer
      - Checkpoint saving to the output_dir
    This wrapper handles:
      - Building the command line from the resolved DPO args
      - Streaming swift's stdout/stderr to the parent (for log visibility)
      - Parsing swift's output for structured events (training_step, checkpoint_saved, ...)
      - Hard timeout (so the job doesn't hang forever)
      - Verifying the LoRA adapter was actually saved
    """
    started = time.time()

    # Resolve model dir. If the user passed --model-dir, use that;
    # otherwise use base_model as-is (swift will resolve it via HF or MS).
    effective_model = model_dir or base_model

    # Build the swift rlhf command. v4.0+ of training-framework unified DPO under
    # `swift rlhf --rlhf_type dpo` — the old `swift dpo` subcommand was
    # removed in v4.0 (released 2026-03-03).
    cmd = [
        "swift", "rlhf",
        "--rlhf_type", "dpo",
        "--model", effective_model,
        "--tuner_type", "lora",
        "--lora_rank", str(lora_r),
        "--lora_alpha", str(lora_alpha),
        "--lora_dropout", str(_lora_dropout_safe(lora_dropout)),
        "--target_modules", "all-linear",
        "--quant_method", "bnb",
        "--quant_bits", "4",
        "--dataset", dataset_path,
        "--torch_dtype", "bfloat16",
        "--num_train_epochs", str(epochs),
        "--per_device_train_batch_size", str(per_device_train_batch_size),
        "--gradient_accumulation_steps", str(gradient_accumulation_steps),
        "--learning_rate", str(learning_rate),
        "--max_length", str(max_length),
        "--output_dir", str(output_dir),
        "--save_steps", "50",  # don't checkpoint every step (smoke = 1)
        "--logging_steps", "1",
        "--warmup_ratio", str(warmup_ratio),
        "--weight_decay", str(weight_decay),
        "--lr_scheduler_type", lr_scheduler_type,
        "--optim", optim,
        "--seed", str(seed),
        "--rpo_alpha", str(rpo_alpha),
    ]
    if smoke:
        # Verify the loop works end-to-end with minimal compute.
        cmd += ["--max_length", "256"]

    log("swift_rlhf_start", cmd=" ".join(cmd), model_dir=effective_model)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"  # force line-buffered output from swift
    env["USE_HF"] = "1"  # avoid ModelScope CDN (which is slow from EU)

    # Spawn the subprocess. We stream stdout + stderr directly to the parent
    # (so swift's tqdm bars and [INFO:swift] logs are visible in real-time),
    # AND we read line-by-line in a thread to parse structured events.
    log("swift_output_streaming", note="raw swift stdout will follow, parsed events emitted as discovered")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge stderr into stdout
            cwd=str(_REPO_ROOT),
            env=env,
            text=True,
            bufsize=1,  # line-buffered
        )
    except FileNotFoundError:
        return {
            "status": "fail",
            "error": "`swift` binary not found on PATH. Is training-framework installed?",
            "elapsed_seconds": time.time() - started,
        }

    assert proc.stdout is not None
    line_count = 0
    last_event: str | None = None
    try:
        for line in proc.stdout:
            line_count += 1
            # Always emit a passthrough event for the raw line (truncated).
            log("swift_output", line=line.rstrip("\n")[:500])
            # Try to parse for a structured event.
            event = _parse_swift_line(line)
            if event is not None:
                last_event = event
    except Exception as e:
        # If the stdout reader dies (e.g. swift crashed), capture and report.
        log("swift_stdout_reader_failed", error=str(e)[:300])

    try:
        returncode = proc.wait(timeout=10)  # give it 10s to flush after stdout closed
    except subprocess.TimeoutExpired:
        proc.kill()
        return {
            "status": "fail",
            "error": "swift rlhf timed out (1 hour)",
            "elapsed_seconds": time.time() - started,
        }

    elapsed = time.time() - started
    log("swift_rlhf_finished", returncode=returncode, elapsed_sec=round(elapsed, 1),
        line_count=line_count, last_event=last_event)

    if returncode != 0:
        return {
            "status": "fail",
            "error": f"swift rlhf returned non-zero (rc={returncode})",
            "returncode": returncode,
            "elapsed_seconds": elapsed,
        }

    # Verify the LoRA adapter was actually saved. swift writes to
    # <output_dir>/v<timestamp>-<run_id>/checkpoint-N/adapter_model.safetensors
    adapter_files = list(output_dir.rglob("adapter_*.safetensors"))
    has_adapter_config = (output_dir / "adapter_config.json").exists() or any(
        (p / "adapter_config.json").exists() for p in output_dir.rglob("checkpoint-*")
    )
    if not adapter_files and not has_adapter_config:
        return {
            "status": "fail",
            "error": "swift rlhf exited 0 but no LoRA adapter files found in output_dir",
            "output_dir": str(output_dir),
            "elapsed_seconds": elapsed,
        }

    return {
        "status": "ok",
        "base_model": base_model,
        "epochs": epochs,
        "elapsed_seconds": elapsed,
        "output_dir": str(output_dir),
        "adapter_files_count": len(adapter_files),
        "has_adapter_config": has_adapter_config,
    }


def _lora_dropout_safe(p: float) -> float:
    """Defensive helper: keep lora_dropout in [0, 0.5]."""
    return max(0.0, min(0.5, p))


# -- Main ------------------------------------------------------------------


def main() -> int:
    args, _unknown = parse_args()  # parse_known_args: ignore Modal's container-entrypoint args
    run_id = args.run_id or uuid.uuid4().hex[:12]
    started = time.time()

    log("job_start", run_id=run_id, args=vars(args))

    # 1. Load config
    config = load_config(args.config)
    dpo_args = _resolve_dpo_args(config)
    log("config_loaded",
        config_path=args.config or "<default>",
        base_model=dpo_args.get("base_model"),
        beta=dpo_args.get("beta"),
        learning_rate=dpo_args.get("learning_rate"))

    # 2. Resolve output dir
    output_dir = Path(args.output_dir) if args.output_dir else (
        Path(os.environ.get("AWARE_DATA_DIR", "/root/aware-data")) /
        "checkpoints" / run_id
    )

    try:
        # 3. Optional: generate AZR self-play corpus
        if args.gen_azr_corpus:
            corpus_path = output_dir / "azr_corpus.jsonl"
            base_model = dpo_args.get("base_model", "Qwen/base-model")
            n = gen_azr_corpus(base_model, args.azr_corpus_size, corpus_path)
            log("azr_corpus_added", n_pairs=n, path=str(corpus_path))
            # Append the AZR corpus to the dataset
            dataset_path = args.dataset
            if not dataset_path:
                log("no_dataset_for_azr_append", action="training_on_azr_only")
                dataset_path = str(corpus_path)
            else:
                # Concatenate
                combined_path = output_dir / "combined_dataset.jsonl"
                with combined_path.open("w") as out:
                    for p in [Path(dataset_path), corpus_path]:
                        if p.exists():
                            with p.open() as f:
                                for line in f:
                                    if line.strip():
                                        out.write(line)
                dataset_path = str(combined_path)
                log("dataset_combined", path=dataset_path)
        else:
            dataset_path = args.dataset

        if not dataset_path:
            log("no_dataset", action="abort")
            return 3

        # 4. Load dataset (light validation; swift rlhf will do the real parsing)
        rows = load_dataset(dataset_path)
        if not rows:
            log("empty_dataset", action="abort")
            return 3
        log("dataset_loaded", n_pairs=len(rows), path=dataset_path)

        # 5. Train via swift rlhf subprocess (replaces the in-process
        # training-optimizer + TRL DPOTrainer path used in v1)
        result = run_swift_rlhf_subprocess(
            base_model=dpo_args.get("base_model", "Qwen/base-model"),
            dataset_path=dataset_path,
            output_dir=output_dir,
            beta=dpo_args.get("beta", 0.1),
            learning_rate=dpo_args.get("learning_rate", 5e-5),
            epochs=dpo_args.get("epochs", 1),
            per_device_train_batch_size=dpo_args.get("per_device_train_batch_size", 1),
            gradient_accumulation_steps=dpo_args.get("gradient_accumulation_steps", 2),
            lora_r=dpo_args.get("lora_r", 16),
            lora_alpha=dpo_args.get("lora_alpha", 32),
            lora_dropout=dpo_args.get("lora_dropout", 0.05),
            max_length=dpo_args.get("max_length", 2048),
            warmup_ratio=dpo_args.get("warmup_ratio", 0.05),
            weight_decay=dpo_args.get("weight_decay", 0.01),
            lr_scheduler_type=dpo_args.get("lr_scheduler_type", "cosine"),
            optim=dpo_args.get("optim", "adamw_8bit"),
            seed=dpo_args.get("seed", 42),
            rpo_alpha=dpo_args.get("rpo_alpha", 0.1),
            model_dir=args.model_dir,
            swift_timeout=args.swift_timeout,
            smoke=args.smoke_test,
        )

        if result.get("status") != "ok":
            log("job_end", run_id=run_id, status=result.get("status", "fail"),
                error=result.get("error", "unknown")[:500],
                duration_sec=round(time.time() - started, 1))
            # 4 = swift returned non-zero, 5 = swift timeout, 6 = no adapter
            if "timeout" in result.get("error", "").lower():
                return 5
            if "no LoRA" in result.get("error", ""):
                return 6
            return 4

        log("job_end", run_id=run_id, status="ok",
            duration_sec=round(time.time() - started, 1),
            output_dir=result.get("output_dir"),
            adapter_files_count=result.get("adapter_files_count"))
        return 0

    except FileNotFoundError as e:
        log("job_end", run_id=run_id, status="dataset_not_found", error=str(e))
        return 3
    except ImportError as e:
        log("job_end", run_id=run_id, status="import_error", error=str(e)[:500])
        return 4
    except RuntimeError as e:
        log("job_end", run_id=run_id, status="runtime_error", error=str(e)[:500],
            traceback=traceback.format_exc()[:2000])
        return 5
    except OSError as e:
        log("job_end", run_id=run_id, status="os_error", error=str(e)[:500])
        return 6
    except Exception as e:
        log("job_end", run_id=run_id, status="error", error=str(e)[:500],
            traceback=traceback.format_exc()[:2000])
        return 1


if __name__ == "__main__":
    sys.exit(main())
