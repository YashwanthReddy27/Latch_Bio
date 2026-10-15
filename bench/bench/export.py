"""Export runs + labels to static JSON for the web app (web/public/data).

    python -m bench.export

Writes:
  meta.json          sweep metadata, judge status
  configs.json       leaderboard rows (Wilson 95% CI, cost, tokens, per-task pass, failure mix)
  tasks.json         task specs, grader logic in plain language, planted ground truth
  index.json         one summary row per trajectory (drives tables, charts, filters)
  traj/<id>.json     full trajectory + rule label + judge label
  failures.json      taxonomy aggregates, first-divergence, judge/rule/gold agreement
  plots/<sha>.png    de-duplicated figures produced by agents
  live_replays.json  which cached run /live replays per task when no API key is configured
and copies task input files to web/public/tasks/ for the in-browser (Pyodide) live runner,
plus the judge prompt + grader specs into web/lib/generated/ for the server routes.
"""

from __future__ import annotations

import base64
import json
import math
import shutil
from collections import Counter, defaultdict
from pathlib import Path

from . import DATA_DIR, REPO_DIR, SCREEN_DIR, WEB_DATA_DIR, WEB_TASKS_DIR
from .configs import OFFLINE
from .judge import CACHE_PATH, GOLD_PATH, prompt_template
from .rules import CATEGORIES, label
from .run import SWEEP_N
from .tasks.build import BASE_INPUTS, TASK_FILES_DIR, load_tasks

WEB_LIB_GEN = REPO_DIR / "web" / "lib" / "generated"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4))


def _input_summary() -> dict:
    import pandas as pd

    c = pd.read_csv(SCREEN_DIR / "counts.tsv", sep="\t")
    files = {}
    for name in BASE_INPUTS:
        p = SCREEN_DIR / name
        files[name] = {"bytes": p.stat().st_size}
    files["counts.tsv"].update({"rows": int(len(c)), "columns": list(c.columns),
                                "genes": int(c["gene"].nunique() - 1), "non_targeting": int((c["gene"] == "NON_TARGETING").sum())})
    files["pathways.gmt"]["gene_sets"] = sum(1 for _ in open(SCREEN_DIR / "pathways.gmt"))
    files["candidates.json"] = {"bytes": (TASK_FILES_DIR / "T10" / "candidates.json").stat().st_size, "genes": 30}
    preview = c.head(6).to_dict(orient="records")
    return {"files": files, "counts_preview": preview}


def _load_runs() -> list[dict]:
    from .judge import iter_trajectories

    return list(iter_trajectories())


def _config_meta(cid: str, sample: dict) -> dict:
    if cid in OFFLINE:
        meta = OFFLINE[cid][0]
        return {"id": cid, **meta}
    return {"id": cid, "kind": sample["kind"], "model": sample["model"], "harness": sample["harness"],
            "label": f"{sample['model']} · {sample['harness'].split('/')[-1].strip()}",
            "description": f"REAL run: Gemini ({sample['model']}) via function calling, harness {sample['harness']}."}


def main() -> None:
    tasks = load_tasks()
    truth = json.loads((DATA_DIR / "truth.json").read_text())
    runs = _load_runs()
    if not runs:
        raise SystemExit("no runs found; run `python -m bench.run --sweep` first")
    judge_cache = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}
    gold = json.loads(GOLD_PATH.read_text()) if GOLD_PATH.exists() else {"labels": []}

    out = WEB_DATA_DIR
    if out.exists():
        shutil.rmtree(out)
    (out / "traj").mkdir(parents=True)
    (out / "plots").mkdir()

    index, plots = [], set()
    signal_stats: dict[str, dict] = {}
    by_cfg: dict[str, list[dict]] = defaultdict(list)
    for traj in runs:
        task = tasks[traj["task_id"]]
        rl = label(traj, task, truth)
        for sg in rl["signals"]:
            st = signal_stats.setdefault(sg["id"], {"id": sg["id"], "category": sg["category"], "n_fail": 0,
                                                    "n_latent": 0, "example": sg["message"], "example_id": traj["id"]})
            st["n_latent" if traj["passed"] else "n_fail"] += 1
        jc = judge_cache.get(traj["id"])
        judge = None
        if jc and not traj["passed"]:
            judge = {**jc["output"], "model": jc["model"], "created": jc.get("created")}
        disagree = bool(judge and judge["category"] != rl["category"])
        div_gap = (abs(judge["first_divergence_step"] - rl["first_divergence_step"])
                   if judge and rl["first_divergence_step"] is not None else None)

        steps = []
        for s in traj["steps"]:
            imgs = []
            for im in s.get("images", []):
                path = out / "plots" / f"{im['sha']}.png"
                if im["sha"] not in plots:
                    path.write_bytes(base64.b64decode(im["b64"]))
                    plots.add(im["sha"])
                imgs.append(f"plots/{im['sha']}.png")
            steps.append({**{k: v for k, v in s.items() if k != "images"}, "images": imgs,
                          "milestones": rl["milestones"].get(str(s["i"]), [])})
        full = {**{k: v for k, v in traj.items() if k != "steps"}, "steps": steps,
                "labels": {"rule": {k: v for k, v in rl.items() if k != "milestones"}, "judge": judge,
                           "disagree": disagree}}
        (out / "traj" / f"{traj['id']}.json").write_text(json.dumps(full, separators=(",", ":")))

        row = {
            "id": traj["id"], "config_id": traj["config_id"], "task_id": traj["task_id"], "run_idx": traj["run_idx"],
            "kind": traj["kind"], "passed": traj["passed"], "score": traj["grade"]["score"], "status": traj["status"],
            "n_steps": traj["totals"]["n_steps"],
            "tokens": traj["totals"]["tokens_in"] + traj["totals"]["tokens_out"] + traj["totals"]["tokens_thinking"],
            "cost_usd": traj["totals"]["cost_usd"], "wall_s": traj["totals"]["wall_s"],
            "rule_category": rl["category"], "rule_first_div": rl["first_divergence_step"],
            "judge_category": judge["category"] if judge else None,
            "judge_first_div": judge["first_divergence_step"] if judge else None,
            "disagree": disagree, "div_gap": div_gap,
            "injected": (traj.get("injected") or {}).get("categories", []),
            "latent": rl["latent_issues"],
            "has_plot": any(s["images"] for s in steps),
        }
        index.append(row)
        by_cfg[traj["config_id"]].append(row)

    # ---------------------------------------------------------------- configs
    order = list(OFFLINE) + sorted(c for c in by_cfg if c not in OFFLINE)
    configs = []
    for cid in order:
        rows = by_cfg.get(cid)
        if not rows:
            continue
        sample = next(t for t in runs if t["config_id"] == cid)
        n, k = len(rows), sum(r["passed"] for r in rows)
        per_task = {}
        for tid in tasks:
            tr = [r for r in rows if r["task_id"] == tid]
            per_task[tid] = {"n": len(tr), "pass": sum(r["passed"] for r in tr)}
        fails = [r for r in rows if not r["passed"]]
        divs = [r["rule_first_div"] for r in fails if r["rule_first_div"] is not None]
        configs.append({
            **_config_meta(cid, sample), "n": n, "n_pass": k, "pass_rate": round(k / n, 4), "ci": wilson(k, n),
            "mean_cost": round(sum(r["cost_usd"] for r in rows) / n, 5),
            "mean_tokens": round(sum(r["tokens"] for r in rows) / n),
            "mean_steps": round(sum(r["n_steps"] for r in rows) / n, 2),
            "mean_wall_s": round(sum(r["wall_s"] for r in rows) / n, 2),
            "runs_per_task": SWEEP_N.get(cid, round(n / len(tasks))),
            "per_task": per_task,
            "failures": {c: sum(1 for r in fails if r["rule_category"] == c) for c in CATEGORIES},
            "judge_failures": {c: sum(1 for r in fails if r["judge_category"] == c) for c in CATEGORIES},
            "mean_first_div": round(sum(divs) / len(divs), 2) if divs else None,
        })

    # ---------------------------------------------------------------- failures / agreement
    fails = [r for r in index if not r["passed"]]
    inj = [r for r in fails if r["kind"] != "REAL" and r["injected"]]
    rule_vs_inj = {"n": len(inj), "agree": sum(r["rule_category"] in r["injected"] for r in inj)}
    judged = [r for r in fails if r["judge_category"]]
    judge_vs_rule = {"n": len(judged), "agree": sum(not r["disagree"] for r in judged)}
    gold_rows = []
    for g in gold["labels"]:
        r = next((x for x in index if x["id"] == g["trajectory_id"]), None)
        if r is None:
            continue
        gold_rows.append({"id": r["id"], "gold": g["category"], "gold_first_div": g.get("first_divergence_step"),
                          "rule": r["rule_category"], "judge": r["judge_category"],
                          "rule_first_div": r["rule_first_div"], "judge_first_div": r["judge_first_div"],
                          "rationale": g.get("rationale", "")})
    gold_summary = {
        "n": len(gold_rows),
        "labeler": gold.get("labeler", ""),
        "rule_correct": sum(x["rule"] == x["gold"] for x in gold_rows),
        "judge_n": sum(1 for x in gold_rows if x["judge"]),
        "judge_correct": sum(1 for x in gold_rows if x["judge"] and x["judge"] == x["gold"]),
        "rule_div_within1": sum(1 for x in gold_rows if x["gold_first_div"] is not None and x["rule_first_div"] is not None
                                and abs(x["gold_first_div"] - x["rule_first_div"]) <= 1),
        "rows": gold_rows,
    }
    div_hist: dict[str, Counter] = defaultdict(Counter)
    for r in fails:
        if r["rule_first_div"] is not None:
            div_hist[r["config_id"]][r["rule_first_div"]] += 1
    failures = {
        "categories": CATEGORIES,
        "by_config": {c["id"]: c["failures"] for c in configs},
        "judge_by_config": {c["id"]: c["judge_failures"] for c in configs},
        "by_task": {tid: {c: sum(1 for r in fails if r["task_id"] == tid and r["rule_category"] == c) for c in CATEGORIES}
                    for tid in tasks},
        "first_divergence": {cid: dict(sorted(h.items())) for cid, h in div_hist.items()},
        "agreement": {"rule_vs_injected": rule_vs_inj, "judge_vs_rule": judge_vs_rule, "gold": gold_summary},
        "disagreements": [r["id"] for r in fails if r["disagree"]],
        "signals": sorted(signal_stats.values(), key=lambda x: -(x["n_fail"] + x["n_latent"])),
        "multi_fault": [{"id": r["id"], "config_id": r["config_id"], "task_id": r["task_id"],
                         "injected": r["injected"], "rule": r["rule_category"]}
                        for r in fails if len(r["injected"]) > 1],
        "latent": [{"id": r["id"], "config_id": r["config_id"], "task_id": r["task_id"], "signals": r["latent"]}
                   for r in index if r["passed"] and r["latent"]],
    }

    # ---------------------------------------------------------------- tasks, replays, meta
    summary = _input_summary()
    task_rows = []
    for tid, t in tasks.items():
        rows = [r for r in index if r["task_id"] == tid]
        task_rows.append({**t, "n_runs": len(rows), "pass_rate": round(sum(r["passed"] for r in rows) / max(1, len(rows)), 4)})
    replays = {}
    for tid in tasks:
        real = [r for r in index if r["task_id"] == tid and r["kind"] == "REAL"]
        pool = real or [r for r in index if r["task_id"] == tid and r["config_id"] == "sim-a-careful"]
        pool = sorted(pool, key=lambda r: (not r["has_plot"], -r["n_steps"]))  # prefer richer runs
        if pool:
            replays[tid] = {"id": pool[0]["id"], "kind": pool[0]["kind"]}
    real_models = sorted({t["model"] for t in runs if t["kind"] == "REAL"})
    meta = {
        "generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
        "n_trajectories": len(index), "n_configs": len(configs), "n_tasks": len(tasks),
        "n_failures": len(fails), "n_real": sum(r["kind"] == "REAL" for r in index),
        "real_models": real_models,
        "judge": {"n_labeled": len(judged), "models": sorted({judge_cache[r["id"]]["model"] for r in judged})},
        "n_plots": len(plots),
        "dataset": {"genes": 2000, "guides_per_gene": 4, "non_targeting": 200, "samples": 6, "seed": truth["seed"]},
    }

    def dump(name: str, obj) -> None:
        (out / name).write_text(json.dumps(obj, separators=(",", ":")))

    dump("meta.json", meta)
    dump("configs.json", configs)
    dump("tasks.json", {"tasks": task_rows, "inputs": summary})
    dump("index.json", index)
    dump("failures.json", failures)
    dump("live_replays.json", replays)

    # task inputs for the browser runner
    if WEB_TASKS_DIR.exists():
        shutil.rmtree(WEB_TASKS_DIR)
    (WEB_TASKS_DIR / "screen").mkdir(parents=True)
    for name in BASE_INPUTS:
        shutil.copy(SCREEN_DIR / name, WEB_TASKS_DIR / "screen" / name)
    (WEB_TASKS_DIR / "T10").mkdir()
    shutil.copy(TASK_FILES_DIR / "T10" / "candidates.json", WEB_TASKS_DIR / "T10" / "candidates.json")

    # server-side copies (graders + judge prompt) for /api routes
    WEB_LIB_GEN.mkdir(parents=True, exist_ok=True)
    (WEB_LIB_GEN / "judge-prompt.json").write_text(json.dumps(prompt_template(), indent=1, ensure_ascii=False), encoding="utf-8")
    (WEB_LIB_GEN / "tasks.json").write_text(json.dumps(list(tasks.values()), separators=(",", ":")))

    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"exported {len(index)} trajectories, {len(configs)} configs, {len(plots)} plots "
          f"({size / 1e6:.1f} MB) -> {out}")
    print(f"rule vs injected: {rule_vs_inj['agree']}/{rule_vs_inj['n']} | judge labels: {len(judged)} | "
          f"gold: {gold_summary['rule_correct']}/{gold_summary['n']} rule-correct")


if __name__ == "__main__":
    main()
