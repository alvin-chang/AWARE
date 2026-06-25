#!/usr/bin/env python3
"""training/app.py - Modal-app wrapper for AWARE 2.0 DPO training (Phase 3 R2, the AWARE 2.0 Architecture ADR (internal)).

Extracted from training/run.py lines 879-1002 to keep the CLI form (training/run.py)
and the Modal-app form (this file) cleanly separated. The deploy target is
this file, not training/run.py:

    MODAL_PROFILE=goodciso modal deploy training/app.py

This file exists as a sibling of training/run.py because:
  1. run.py is a pure-CLI script that runs as 'python3 -m training.run --config ...'
     per the trainer service's job-submission contract.
  2. The Modal-app form (decorated function) is only needed at deploy time, when
     the Modal CLI imports this file to find the top-level 'app' attribute.
  3. Mixing both forms in one file (with a try/except ImportError to suppress
     the modal import on the CLI path) is fragile: any host without the modal
     Python package installed would silently produce a module with no 'app'
     attribute, leading to a 'module run has no attribute app' deploy error
     that is hard to diagnose. Keeping them in separate files makes the
     contract explicit: this file requires modal at import time.

After deploy, the trainer service (src/trainer/modal-client.js) looks up the
function via client.functions.fromName("aware-trainer", "train") and submits
training jobs via fn.spawn([runId, datasetPath, config], {}).

CONTRACT (must match src/trainer/modal-client.js):
  fn.spawn([run_id: str, dataset_path: str, config: dict], {})
  -> returns call_id
  -> call.get({timeoutMs: 300000}) returns exit_code

The decorated function writes config to <volume>/config.json so the existing
main() in training/run.py can read it via load_config() - keeps the CLI and
Modal paths unified (one config loader, not two).
"""

import json
import os
import sys
from pathlib import Path

import modal

# Resolve the repo root the same way training/run.py does, so config lookups
# work whether this file is run as 'training.app' (modal deploy) or imported.
_REPO_ROOT = Path(os.environ.get("AWARE_REPO_ROOT", "/opt/aware"))
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Read image/GPU/volume/timeout from the same config the Node poller uses,
# so the two never drift. Fall back to documented defaults from the AWARE 2.0 Architecture ADR (internal)
# if the config is missing (e.g. a stripped-down checkout).
_modal_config_path = os.environ.get(
    "AWARE_TRAINING_CONFIG",
    str(_REPO_ROOT / "config" / "modal-training.json"),
)
_modal_config = {}
if Path(_modal_config_path).exists():
    try:
        with open(_modal_config_path) as _f:
            _modal_config = json.load(_f)
    except (OSError, json.JSONDecodeError):
        _modal_config = {}

app = modal.App("aware-trainer")

# Container image. We build from the same Dockerfile the poller's config
# references, so the deployed function and the manual-debug docker run
# path share the exact same image.
_image = modal.Image.from_dockerfile(
    _modal_config.get("image_dockerfile", "Dockerfile.training")
).env({
    # Bake the base-model default into the image so a stale deploy of an
    # old run.py doesn't regress to the deprecated training-optimizer pre-quantized
    # Qwen 2.5 build. Override per-job via AWARE_BASE_MODEL env var in
    # the function kwargs.
    "AWARE_BASE_MODEL": _modal_config.get("dpo_defaults", {}).get("base_model", "Qwen/trained-model"),
    "AWARE_DPO_BETA": str(_modal_config.get("dpo_defaults", {}).get("beta", 0.1)),
    "AWARE_DPO_LR": str(_modal_config.get("dpo_defaults", {}).get("learning_rate", 5e-6)),
    "AWARE_DPO_EPOCHS": str(_modal_config.get("dpo_defaults", {}).get("epochs", 1)),
    "AWARE_DPO_BATCH_SIZE": str(_modal_config.get("dpo_defaults", {}).get("per_device_train_batch_size", 4)),
    "AWARE_DPO_GRAD_ACCUM": str(_modal_config.get("dpo_defaults", {}).get("gradient_accumulation_steps", 4)),
})

# Persistent volume for datasets + checkpoints.
_volume_cfg = _modal_config.get("modal_volume", {})
_volume = modal.Volume.from_name(
    _volume_cfg.get("name", "aware-training-data"),
    create_if_missing=True,
)
_volume_mount = _volume_cfg.get("mount_path", "/root/aware-data")

# GPU spec - single A100-80GB per the AWARE 2.0 Architecture ADR (internal) Decision 2.
_gpu_cfg = _modal_config.get("gpu", {})
_gpu = _gpu_cfg.get("type", "A100-80GB")

# Resource limits.
_resources_cfg = _modal_config.get("resources", {})
_timeout = _modal_config.get("timeout_seconds", 18000)


@app.function(
    name="train",
    image=_image,
    gpu=_gpu,
    volumes={_volume_mount: _volume},
    timeout=_timeout,
    cpu=_resources_cfg.get("cpu_cores", 8),
    memory=_resources_cfg.get("memory_mb", 32768),
)
def train(run_id: str, dataset_path: str, config: dict, dataset_bytes: bytes = b"") -> int:
    """Modal entrypoint - synthesizes argv from spawn() args and calls main().

    Contract (matched by src/trainer/modal-client.js):
        fn.spawn([runId, datasetPath, config, datasetBytes], {})

    We write config to <volume>/config.json and the dataset bytes to
    <volume>/datasets/<runId>.jsonl so the existing main() in
    training/run.py can read both via its CLI flags. This keeps the
    CLI and Modal paths unified (one config loader, not two).

    `dataset_bytes` is the raw content of the DPO dataset JSONL
    produced by the trainer's _packageDataset() flow. Passing bytes
    is the simplest way to get the data into the Modal container's
    Volume without a JS-side Volume upload API (modal@0.8.x JS SDK
    does not expose Volume.writeFile).
    """
    # Mount the volume into the container's filesystem (Modal requires an
    # explicit reload after writes).
    os.makedirs(_volume_mount, exist_ok=True)
    config_path = os.path.join(_volume_mount, "config.json")
    with open(config_path, "w") as _f:
        json.dump(config or {}, _f)

    # Write the dataset bytes to the volume. The Modal container's
    # filesystem is fresh per-job; the volume is the only thing that
    # persists across the call's lifetime. We honor dataset_path
    # (the JS side computes it from trainingConfig.modal_volume
    # .mount_path) so the script's --dataset argv points at the
    # correct location.
    dataset_dir = os.path.dirname(dataset_path)
    if dataset_dir:
        os.makedirs(dataset_dir, exist_ok=True)
    if dataset_bytes:
        with open(dataset_path, "wb") as _f:
            _f.write(dataset_bytes)
    _volume.reload()

    # Import the CLI form and call its main() with a synthesized argv.
    # This is the single point of contact between the Modal-app form
    # (this file) and the CLI form (training/run.py). It exists so the
    # CLI form stays free of any modal-aware code.
    from training.run import main

    sys.argv = [
        "training.run",
        "--config", config_path,
        "--dataset", dataset_path,
        "--output-dir", os.path.join(_volume_mount, "checkpoints", run_id),
        "--run-id", run_id,
    ]
    return main()
