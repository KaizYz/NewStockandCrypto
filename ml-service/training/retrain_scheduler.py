from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

REQUIRED_ARTIFACTS = [
    "artifact_meta.json",
    "model_outputs.json",
    "metrics.json",
    "runtime_manifest.json",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Schedule daily retraining and hot-reload the live Model Explorer runtime.")
    parser.add_argument("--artifact-root", type=str, default="artifacts", help="Root artifacts directory")
    parser.add_argument("--timezone", type=str, default="America/Chicago", help="Scheduler timezone")
    parser.add_argument("--hour", type=int, default=5, help="Daily run hour")
    parser.add_argument("--minute", type=int, default=10, help="Daily run minute")
    parser.add_argument("--api-base-url", type=str, default="http://127.0.0.1:8001", help="Model explorer API base URL")
    parser.add_argument("--python-executable", type=str, default=sys.executable, help="Python executable for training")
    parser.add_argument("--run-now", action="store_true", help="Run one training cycle immediately before starting the scheduler")
    parser.add_argument("train_args", nargs=argparse.REMAINDER, help="Additional arguments passed through to training.train_all")
    return parser.parse_args()


def timestamp_dir_name() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def validate_run_dir(run_dir: Path) -> None:
    missing = [name for name in REQUIRED_ARTIFACTS if not (run_dir / name).exists()]
    if missing:
        raise RuntimeError(f"Training output missing required artifacts: {', '.join(missing)}")

    runtime_manifest = run_dir / "runtime_manifest.json"
    if runtime_manifest.stat().st_size <= 2:
        raise RuntimeError("runtime_manifest.json is empty.")


def promote_latest(run_dir: Path, latest_dir: Path) -> None:
    backup_dir = latest_dir.with_name(f"{latest_dir.name}_backup_{timestamp_dir_name()}")
    if backup_dir.exists():
        shutil.rmtree(backup_dir)
    if latest_dir.exists():
        latest_dir.rename(backup_dir)
    try:
        shutil.move(str(run_dir), str(latest_dir))
    except Exception:
        if backup_dir.exists() and not latest_dir.exists():
            backup_dir.rename(latest_dir)
        raise
    if backup_dir.exists():
        shutil.rmtree(backup_dir)


def trigger_reload(api_base_url: str) -> None:
    response = requests.post(f"{api_base_url.rstrip('/')}/v1/admin/reload", timeout=30)
    response.raise_for_status()


def run_cycle(args: argparse.Namespace) -> None:
    artifact_root = Path(args.artifact_root).resolve()
    runs_root = artifact_root / "runs"
    latest_dir = artifact_root / "latest"
    runs_root.mkdir(parents=True, exist_ok=True)

    run_dir = runs_root / timestamp_dir_name()
    command = [
        args.python_executable,
        "-m",
        "training.train_all",
        "--artifact-dir",
        str(run_dir),
        *list(args.train_args or []),
    ]
    print(f"[scheduler] starting training: {' '.join(command)}")
    subprocess.run(command, check=True)
    validate_run_dir(run_dir)
    promote_latest(run_dir, latest_dir)
    trigger_reload(args.api_base_url)
    print(f"[scheduler] promoted {latest_dir} and reloaded live provider")


def main() -> None:
    args = parse_args()
    scheduler = BlockingScheduler(timezone=args.timezone)
    scheduler.add_job(
        lambda: run_cycle(args),
        trigger=CronTrigger(hour=args.hour, minute=args.minute, timezone=args.timezone),
        id="daily-model-explorer-retrain",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )

    if args.run_now:
        run_cycle(args)

    print(f"[scheduler] daily retrain scheduled at {args.hour:02d}:{args.minute:02d} {args.timezone}")
    scheduler.start()


if __name__ == "__main__":
    main()
