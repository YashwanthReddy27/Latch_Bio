"""Harness runner.

    python -m bench.run --model baseline-reference --tasks all --n 3
    python -m bench.run --model sim-c-mid --tasks T05,T07 --n 5
    python -m bench.run --model gemini --prompt careful --tasks all --n 3   # needs GEMINI_API_KEY, GEMINI_MODEL
    python -m bench.run --sweep                                              # every offline config (demo data)

Trajectories are appended to bench/runs/<config_id>.jsonl (one JSON object per line).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from . import BENCH_DIR, RUNS_DIR
from .configs import OFFLINE, make_agent
from .harness import run_episode
from .tasks.build import load_tasks

SWEEP_N = {"baseline-reference": 3, "baseline-naive": 3, "sim-a-careful": 5, "sim-b-fast": 5,
           "sim-c-mid": 5, "sim-d-small": 5}


def _load_env() -> None:
    """Minimal .env loader (repo root or bench/), so no extra dependency is needed."""
    for p in (BENCH_DIR.parent / ".env", BENCH_DIR / ".env"):
        if p.exists():
            for line in p.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _job(config_id: str, prompt: str, task: dict, run_idx: int) -> dict:
    agent = make_agent(config_id, prompt)
    return run_episode(agent, task, run_idx)


def run(config_id: str, task_ids: list[str], n: int, prompt: str = "minimal", workers: int = 4,
        out: Path | None = None) -> Path:
    tasks = load_tasks()
    agent = make_agent(config_id, prompt)
    cid = agent.config["id"]
    out = out or RUNS_DIR / f"{cid.replace('/', '_')}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("")
    jobs = [(config_id, prompt, tasks[t], r) for t in task_ids for r in range(n)]
    workers = 1 if agent.config["kind"] == "REAL" else workers  # be polite to the API
    n_pass = 0
    with open(out, "a", encoding="utf-8") as f:
        if workers == 1:
            results = (_job(*j) for j in jobs)
            for traj in results:
                f.write(json.dumps(traj) + "\n")
                f.flush()
                n_pass += traj["passed"]
                print(f"  {traj['id']}: {'PASS' if traj['passed'] else 'fail'} ({traj['status']}, {traj['totals']['n_steps']} steps)")
        else:
            with ProcessPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(_job, *j) for j in jobs]
                for fut in as_completed(futs):
                    traj = fut.result()
                    f.write(json.dumps(traj) + "\n")
                    n_pass += traj["passed"]
    print(f"{cid}: {n_pass}/{len(jobs)} passed -> {out}")
    return out


def main(argv: list[str] | None = None) -> None:
    _load_env()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", help=f"config id: {', '.join(OFFLINE)}, or 'gemini'")
    ap.add_argument("--tasks", default="all", help="'all' or comma-separated ids (T01,T05)")
    ap.add_argument("--n", type=int, default=3, help="runs per task")
    ap.add_argument("--prompt", default="minimal", choices=["minimal", "careful"], help="system prompt (gemini only)")
    ap.add_argument("--workers", type=int, default=max(1, min(6, (os.cpu_count() or 2) - 1)))
    ap.add_argument("--sweep", action="store_true", help="run every offline config with the demo sweep sizes")
    args = ap.parse_args(argv)

    task_ids = sorted(load_tasks()) if args.tasks == "all" else args.tasks.split(",")
    if args.sweep:
        for cid, n in SWEEP_N.items():
            run(cid, task_ids, n, workers=args.workers)
        return
    if not args.model:
        ap.error("--model is required (or use --sweep)")
    if args.model.startswith("gemini") and not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY is not set. Offline configs: " + ", ".join(OFFLINE))
    run(args.model, task_ids, args.n, args.prompt, args.workers)


if __name__ == "__main__":
    main()
