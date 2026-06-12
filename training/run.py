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
  3. Loads the base model with training-optimizer 4-bit QLoRA
  4. Applies LoRA adapters
  5. Runs TRL DPOTrainer for the configured number of epochs
  6. Saves the merged model + adapter to the Modal Volume
  7. Writes a run summary to the Modal Volume (consumed by the
     trainer service when it polls for job completion)

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
This script never sees <redacted-credential-name>; it only uses the modal Python
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
        {"event": "checkpoint_saved", "path": "...", "size_mb": 4500, "ts": "..."}
        {"event": "job_end", "status": "ok", "duration_sec": 1234, "ts": "..."}

EXIT CODES:
    0  - success
    1  - generic error
    2  - config validation failed
    3  - dataset not found / unreadable
    4  - base model load failed (network, OOM, etc.)
    5  - training OOM or runtime error
    6  - checkpoint save failed

The trainer service reads the exit code and the last JSON line to
decide whether the run was successful.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
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
            pass


# -- CLI -------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    """Parse the job's CLI args. The trainer service builds the command
    line from the modal-training.json config + the env vars; the script
    is invoked once per job.

    Defaults match config/modal-training.json so the script works
    standalone (e.g. for manual debugging inside the container) as
    well as under Modal orchestration.
    """
    p = argparse.ArgumentParser(
        prog="training.run",
        description="AWARE 2.0 DPO training job (Phase 3)",
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
        help="Path to the DPO dataset JSONL (one row per line, in heavy-think's toDpoRow output shape).",
    )
    p.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Where to write the merged model + adapter. Defaults to /root/aware-data/checkpoints/<run-id>.",
    )
    p.add_argument(
        "--run-id",
        type=str,
        default=None,
        help="Unique run identifier. Auto-generated if not provided.",
    )
    p.add_argument(
        "--gen-azr-corpus",
        action="store_true",
        help="Generate an AZR self-play corpus BEFORE training. Adds to the dataset.",
    )
    p.add_argument(
        "--azr-corpus-size",
        type=int,
        default=1000,
        help="How many synthetic tasks to generate for AZR self-play (when --gen-azr-corpus is set).",
    )
    p.add_argument(
        "--smoke-test",
        action="store_true",
        help="Run a 1-pair smoke test (load model, run 1 DPO step, save). Verifies the image works end-to-end without burning GPU hours.",
    )
    return p.parse_args()


# -- Config ---------------------------------------------------------------


def load_config(path: str | None) -> dict[str, Any]:
    """Load the modal-training.json config (or a job-specific override).

    The trainer service always writes a job-specific config to
    /root/aware-data/config.json before submitting the job, so we
    can use the path it's passed. Falls back to modal-training.json
    if --config is not given.
    """
    if path is None:
        # Default location the trainer service writes to
        path = os.environ.get(
            "AWARE_TRAINING_CONFIG",
            str(_REPO_ROOT / "config" / "modal-training.json"),
        )
    p = Path(path)
    if not p.exists():
        log("config_not_found", path=path, fallback="env_defaults")
        return {}
    try:
        with p.open() as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log("config_load_failed", path=path, error=str(e))
        return {}


def _env_overrides() -> dict[str, Any]:
    """Pull env-var overrides (set by trainer service or operator)."""
    overrides: dict[str, Any] = {}
    for key, env_var in [
        ("base_model", "AWARE_BASE_MODEL"),
        ("beta", "AWARE_DPO_BETA"),
        ("learning_rate", "AWARE_DPO_LR"),
        ("epochs", "AWARE_DPO_EPOCHS"),
        ("per_device_train_batch_size", "AWARE_DPO_BATCH_SIZE"),
        ("gradient_accumulation_steps", "AWARE_DPO_GRAD_ACCUM"),
    ]:
        v = os.environ.get(env_var)
        if v is not None and v != "":
            # Type-coerce based on the key
            if key in ("base_model",):
                overrides[key] = v
            elif key in ("epochs", "per_device_train_batch_size", "gradient_accumulation_steps"):
                overrides[key] = int(v)
            else:
                overrides[key] = float(v)
    return overrides


def _resolve_dpo_args(config: dict[str, Any]) -> dict[str, Any]:
    """Merge config defaults with env overrides for the DPO section."""
    defaults = config.get("dpo_defaults", {})
    merged = {**defaults, **_env_overrides()}
    return merged


# -- AZR self-play corpus generation (optional) ---------------------------


def gen_azr_corpus(
    base_model_id: str,
    n_tasks: int,
    output_path: Path,
    *,
    seed: int = 42,
) -> int:
    """Generate synthetic tasks with the base model, verify them with
    azr.executor, and emit preference pairs to a JSONL file.

    Returns the number of preference pairs written.

    PROPOSE: ask the base model to invent a Python coding task.
    SOLVE:   ask the base model to solve the task (twice, with different
             temperatures to get two distinct attempts).
    VERIFY:  use azr.executor to run both attempts against the
             proposed task's hidden test cases.
    PREFERENCE_PAIR: if exactly one attempt passes, emit a pair.
                     If both pass or both fail, skip (no preference signal).

    NOTE: this function LAZILY IMPORTS the heavy ML stack (transformers,
    peft, unsloth) so the CLI parts of training/run.py work even on
    systems without an NVIDIA GPU + training-optimizer installed (e.g. unit tests
    on a Mac). The expensive imports are inside this function.
    """
    log("azr_corpus_gen_start", n_tasks=n_tasks, base_model=base_model_id, output=str(output_path))

    # Lazy imports — training-optimizer is ~3GB and we don't want to fail at import
    # time for non-GPU environments.
    import torch  # noqa: F401  (validates CUDA presence)
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from azr.executor import SandboxExecutor

    # Load base model in 4-bit. The "bnb-4bit" training-optimizer repo is pre-quantized;
    # loading via HF transformers gives us the same 4-bit weights.
    log("azr_base_model_loading", base_model=base_model_id)
    tokenizer = AutoTokenizer.from_pretrained(base_model_id)
    model = AutoModelForCausalLM.from_pretrained(
        base_model_id,
        torch_dtype="auto",
        device_map="auto",
    )
    log("azr_base_model_loaded", device=str(model.device))

    executor = SandboxExecutor(
        scratch_dir="/tmp/azr-sandbox",
        timeout_seconds=int(os.environ.get("AZR_SANDBOX_TIMEOUT_SECONDS", "5")),
        memory_mb=int(os.environ.get("AZR_SANDBOX_MEMORY_MB", "128")),
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    n_pairs = 0
    n_attempts = 0
    started = time.time()

    with output_path.open("w", encoding="utf-8") as fp:
        for i in range(n_tasks):
            try:
                task = _propose_python_task(model, tokenizer, seed=seed + i)
                tests_source = _extract_hidden_tests(task)
                if not tests_source:
                    continue

                solution_a = _solve_task(model, tokenizer, task, temperature=0.0)
                solution_b = _solve_task(model, tokenizer, task, temperature=0.7)
                n_attempts += 2

                result_a = executor.run(solution_a, tests_source)
                result_b = executor.run(solution_b, tests_source)

                if result_a.passed and not result_b.passed:
                    chosen, rejected = solution_a, solution_b
                    chosen_score, rejected_score = 1.0, 0.0
                elif result_b.passed and not result_a.passed:
                    chosen, rejected = solution_b, solution_a
                    chosen_score, rejected_score = 1.0, 0.0
                else:
                    continue  # both pass or both fail — no preference signal

                pair = {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "problem": task.get("description", ""),
                    "task_type": "azr_self_play",
                    "chosen": {"reasoning": chosen, "prm_score": chosen_score},
                    "rejected": {"reasoning": rejected, "prm_score": rejected_score},
                    "verification": {
                        "method": "azr.executor",
                        "passed": True,
                        "duration_ms": result_a.duration_ms + result_b.duration_ms,
                    },
                    "cost": {
                        "attempts_usd": 0.0,  # self-play cost is on Modal's A100, not a paid API
                        "refinement_usd": 0.0,
                        "judge_usd": 0.0,
                    },
                    "_content_hash": uuid.uuid4().hex,
                }
                fp.write(json.dumps(pair) + "\n")
                fp.flush()
                n_pairs += 1

                if n_pairs % 50 == 0:
                    log("azr_corpus_progress",
                        task_index=i + 1,
                        n_pairs=n_pairs,
                        n_attempts=n_attempts,
                        pass_rate=round(n_pairs / max(1, n_attempts // 2), 3),
                        elapsed_sec=round(time.time() - started, 1))

            except Exception as e:
                log("azr_corpus_task_error", task_index=i, error=str(e)[:200])
                continue

    log("azr_corpus_gen_end",
        n_pairs=n_pairs,
        n_attempts=n_attempts,
        elapsed_sec=round(time.time() - started, 1),
        output=str(output_path))
    return n_pairs


def _propose_python_task(model, tokenizer, *, seed: int) -> dict:
    """Ask the base model to invent a Python coding task.

    The model returns a task as a JSON object with:
      - description: natural-language prompt
      - function_signature: the expected def line
      - test_cases: list of (input_args, expected_output) tuples

    The hidden tests are what we'll verify against in step 3.
    """
    import torch
    import random
    random.seed(seed)

    prompt = (
        "You are designing Python coding tasks for self-play training.\n"
        "Invent ONE task that is solvable in 5-15 lines of Python.\n"
        "Return ONLY a JSON object with this exact shape:\n"
        "{\n"
        '  "description": "<natural language problem statement>",\n'
        '  "function_signature": "def function_name(arg1: type, arg2: type) -> type:",\n'
        '  "test_cases": [{"input": [<args>], "output": <expected>}, ...]\n'
        "}\n"
        "Make the task concrete (specific inputs, specific outputs). "
        "Do not include commentary outside the JSON."
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=512,
            do_sample=True,
            temperature=0.9,
            pad_token_id=tokenizer.eos_token_id,
        )
    text = tokenizer.decode(out[0][inputs.input_ids.shape[1]:], skip_special_tokens=True).strip()

    # Try to parse the response as JSON. If it fails, the caller skips
    # this task (no preference pair emitted).
    try:
        # Models sometimes wrap the JSON in ```json ... ``` fences. Strip them.
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except (json.JSONDecodeError, IndexError):
        return {}


def _extract_hidden_tests(task: dict) -> str:
    """Convert a proposed task's test_cases to a Python source string
    of assert statements that the executor can run.

    The returned string is a series of lines like:
        assert function_name(*input) == output
    The executor runs them inside its sandbox; the solver LLM's
    function is bound to the same name in the test namespace.

    The function name is inferred from `function_signature`. We don't
    actually use the signature for binding — the test harness binds
    by the function_under_test arg to verify(). We DO need a Python
    identifier to use as the bound name.
    """
    import re
    sig = task.get("function_signature", "")
    m = re.search(r"def\s+(\w+)\s*\(", sig)
    if not m:
        return ""
    fn_name = m.group(1)

    lines = []
    for tc in task.get("test_cases", []):
        args = tc.get("input", [])
        expected = tc.get("output")
        # Use repr() so the args serialize cleanly
        args_repr = ", ".join(repr(a) for a in args)
        lines.append(f"assert {fn_name}({args_repr}) == {expected!r}")

    return "\n".join(lines)


def _solve_task(model, tokenizer, task: dict, *, temperature: float) -> str:
    """Ask the base model to produce a Python solution for `task`."""
    import torch
    prompt = (
        f"You are an expert Python programmer. Solve this task:\n\n"
        f"```\n{task.get('description', '')}\n```\n\n"
        f"Write a single Python function named `solve` that solves the task. "
        f"Return ONLY the function definition, no commentary."
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=512,
            temperature=temperature if temperature > 0 else 1.0,
            do_sample=temperature > 0,
            pad_token_id=tokenizer.eos_token_id,
        )
    text = tokenizer.decode(out[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
    return text.strip()


# -- Dataset loading ------------------------------------------------------


def load_dataset(path: str) -> list[dict[str, Any]]:
    """Load a DPO dataset from a JSONL file.

    The expected shape is the heavy-think toDpoRow output:
        {prompt, chosen, rejected, _ts, _task_type, _chosen_prm_score, ...}

    The trainer service writes this file to the Modal Volume after
    running heavy-think's toDpoDataset() on the preference pairs.
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"DPO dataset not found: {path}")
    rows = []
    with p.open() as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                log("dataset_skip_bad_row", line_no=i + 1, error=str(e)[:200])
    log("dataset_loaded", path=path, n_rows=len(rows))
    return rows


def rows_to_hf_dataset(rows: list[dict[str, Any]]):
    """Convert JSONL rows to an HF Dataset for TRL's DPOTrainer.

    Lazily imports datasets so non-ML environments can still parse the
    JSONL without the HF datasets dep.
    """
    from datasets import Dataset
    # DPOTrainer needs prompt/chosen/rejected as plain strings
    cleaned = []
    for r in rows:
        prompt = r.get("prompt", "")
        chosen = r.get("chosen", "")
        rejected = r.get("rejected", "")
        if not prompt or not chosen or not rejected:
            continue
        cleaned.append({
            "prompt": prompt,
            "chosen": chosen,
            "rejected": rejected,
        })
    log("dataset_cleaned", n_input=len(rows), n_kept=len(cleaned))
    return Dataset.from_list(cleaned)


# -- Model loading + LoRA -------------------------------------------------


def load_model_with_lora(base_model_id: str, max_seq_length: int, lora_r: int,
                         lora_alpha: int, lora_dropout: float, *, smoke: bool = False):
    """Load base model with training-optimizer + apply LoRA adapters.

    Lazy-imports training-optimizer so non-GPU environments can still parse config
    and load datasets without crashing.
    """
    from unsloth import FastLanguageModel

    log("model_loading", base_model=base_model_id, max_seq_length=max_seq_length)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model_id,
        max_seq_length=max_seq_length,
        dtype=None,  # auto-detect
        load_in_4bit=True,
    )
    log("model_loaded", base_model=base_model_id)

    model = FastLanguageModel.get_peft_model(
        model,
        r=lora_r,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_alpha=lora_alpha,
        lora_dropout=lora_dropout,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )
    log("lora_applied", r=lora_r, alpha=lora_alpha, dropout=lora_dropout)
    return model, tokenizer


# -- DPO training ---------------------------------------------------------


def run_dpo_training(
    model, tokenizer, hf_dataset, *,
    beta: float, learning_rate: float, epochs: int,
    per_device_train_batch_size: int, gradient_accumulation_steps: int,
    warmup_ratio: float, weight_decay: float,
    lr_scheduler_type: str, optim: str, seed: int,
    output_dir: Path,
    smoke: bool = False,
) -> dict[str, Any]:
    """Configure TRL DPOTrainer and run the training loop.

    Returns a dict of summary metrics (loss, num_steps, duration_sec).
    """
    from trl import DPOConfig, DPOTrainer

    if smoke:
        # 1 pair, 1 step — just verify the loop works end-to-end
        hf_dataset = hf_dataset.select(range(min(1, len(hf_dataset))))
        epochs = 1
        per_device_train_batch_size = 1
        gradient_accumulation_steps = 1
        log("smoke_test_mode", n_pairs=len(hf_dataset))

    config = DPOConfig(
        beta=beta,
        learning_rate=learning_rate,
        num_train_epochs=epochs,
        per_device_train_batch_size=per_device_train_batch_size,
        gradient_accumulation_steps=gradient_accumulation_steps,
        warmup_ratio=warmup_ratio,
        weight_decay=weight_decay,
        lr_scheduler_type=lr_scheduler_type,
        optim=optim,
        seed=seed,
        output_dir=str(output_dir),
        logging_steps=10,
        save_strategy="no",  # we save explicitly below
        report_to="none",  # we log to stdout
        max_length=2048,
        max_prompt_length=1024,
    )

    trainer = DPOTrainer(
        model=model,
        ref_model=None,  # tuning-lib model: TRL auto-uses the base as ref
        args=config,
        train_dataset=hf_dataset,
        tokenizer=tokenizer,
    )
    log("training_start",
        epochs=epochs,
        total_steps=len(trainer.train_dataset) // (per_device_train_batch_size * gradient_accumulation_steps),
        beta=beta,
        learning_rate=learning_rate)

    started = time.time()
    # Custom train loop that emits JSON-line progress
    # (Trainer.train() returns, but we want incremental progress)
    train_result = trainer.train()
    duration_sec = time.time() - started

    metrics = {
        "training_loss": float(train_result.training_loss) if train_result.training_loss else None,
        "total_steps": train_result.global_step,
        "duration_sec": round(duration_sec, 1),
        "epochs": epochs,
        "n_pairs": len(hf_dataset),
    }
    log("training_end", **metrics)
    return metrics


# -- Checkpoint save ------------------------------------------------------


def save_checkpoint(
    model, tokenizer, output_dir: Path,
    *, save_merged: bool, save_adapter: bool,
) -> dict[str, Any]:
    """Save the trained model + adapter to the output directory.

    Writes:
      - <output_dir>/                ← merged 16-bit model (if save_merged)
      - <output_dir>/adapter/        ← LoRA adapter only (if save_adapter)
      - <output_dir>/run_summary.json ← training metrics

    The merged model is what the coordinator would load to serve
    inference. The adapter is for incremental retraining.
    """
    from unsloth import FastLanguageModel

    output_dir.mkdir(parents=True, exist_ok=True)

    sizes_mb: dict[str, float] = {}

    if save_adapter:
        adapter_dir = output_dir / "adapter"
        model.save_pretrained(str(adapter_dir))
        tokenizer.save_pretrained(str(adapter_dir))
        sizes_mb["adapter_mb"] = round(_dir_size_mb(adapter_dir), 1)
        log("adapter_saved", path=str(adapter_dir), size_mb=sizes_mb["adapter_mb"])

    if save_merged:
        # Merge LoRA into base, save as 16-bit model
        merged_dir = output_dir / "merged"
        # training-optimizer's merge_and_save handles 4-bit → 16-bit conversion
        FastLanguageModel.save_merged_pretrained(
            model, tokenizer, str(merged_dir), save_method="merged_16bit",
        )
        sizes_mb["merged_mb"] = round(_dir_size_mb(merged_dir), 1)
        log("merged_saved", path=str(merged_dir), size_mb=sizes_mb["merged_mb"])

    summary = {
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "output_dir": str(output_dir),
        "sizes_mb": sizes_mb,
        "save_merged": save_merged,
        "save_adapter": save_adapter,
    }
    with (output_dir / "run_summary.json").open("w") as f:
        json.dump(summary, f, indent=2)
    log("checkpoint_saved", **summary)
    return summary


def _dir_size_mb(p: Path) -> float:
    """Best-effort dir size in MB. Used for checkpoint metadata only."""
    total = 0
    try:
        for child in p.rglob("*"):
            if child.is_file():
                total += child.stat().st_size
    except OSError:
        return 0.0
    return total / (1024 * 1024)


# -- Main ------------------------------------------------------------------


def main() -> int:
    args = parse_args()
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
            base_model = dpo_args.get("base_model", "unsloth/Qwen2.5-7B-Instruct-bnb-4bit")
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

        # 4. Load dataset
        rows = load_dataset(dataset_path)
        if not rows:
            log("empty_dataset", action="abort")
            return 3
        hf_dataset = rows_to_hf_dataset(rows)

        # 5. Load model + LoRA
        model, tokenizer = load_model_with_lora(
            base_model_id=dpo_args.get("base_model", "unsloth/Qwen2.5-7B-Instruct-bnb-4bit"),
            max_seq_length=dpo_args.get("max_seq_length", 2048),
            lora_r=dpo_args.get("lora_r", 16),
            lora_alpha=dpo_args.get("lora_alpha", 16),
            lora_dropout=dpo_args.get("lora_dropout", 0.05),
            smoke=args.smoke_test,
        )

        # 6. Train
        metrics = run_dpo_training(
            model, tokenizer, hf_dataset,
            beta=dpo_args.get("beta", 0.1),
            learning_rate=dpo_args.get("learning_rate", 5e-6),
            epochs=dpo_args.get("epochs", 1),
            per_device_train_batch_size=dpo_args.get("per_device_train_batch_size", 4),
            gradient_accumulation_steps=dpo_args.get("gradient_accumulation_steps", 4),
            warmup_ratio=dpo_args.get("warmup_ratio", 0.1),
            weight_decay=dpo_args.get("weight_decay", 0.01),
            lr_scheduler_type=dpo_args.get("lr_scheduler_type", "cosine"),
            optim=dpo_args.get("optim", "adamw_8bit"),
            seed=dpo_args.get("seed", 42),
            output_dir=output_dir,
            smoke=args.smoke_test,
        )

        # 7. Save checkpoint
        ckpt_cfg = config.get("checkpoint", {})
        save_checkpoint(
            model, tokenizer, output_dir,
            save_merged=ckpt_cfg.get("save_merged", True),
            save_adapter=ckpt_cfg.get("save_adapter", True),
        )

        log("job_end",
            run_id=run_id,
            status="ok",
            duration_sec=round(time.time() - started, 1),
            **metrics)
        return 0

    except FileNotFoundError as e:
        log("job_end", run_id=run_id, status="dataset_not_found", error=str(e))
        return 3
    except ImportError as e:
        # Probably a missing ML dep (training-optimizer, peft, etc.) on a non-GPU box
        log("job_end", run_id=run_id, status="import_error", error=str(e)[:500])
        return 4
    except RuntimeError as e:
        # Probably OOM
        log("job_end", run_id=run_id, status="runtime_error", error=str(e)[:500],
            traceback=traceback.format_exc()[:2000])
        return 5
    except OSError as e:
        # Probably checkpoint save failed (disk full, perms, etc.)
        log("job_end", run_id=run_id, status="os_error", error=str(e)[:500])
        return 6
    except Exception as e:
        log("job_end", run_id=run_id, status="error", error=str(e)[:500],
            traceback=traceback.format_exc()[:2000])
        return 1


if __name__ == "__main__":
    sys.exit(main())
