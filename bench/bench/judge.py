"""Gemini as the failure judge (structured output), with an on-disk cache.

For each failed trajectory we send: the task spec, the grader result, a summary of the
reference pipeline, the rule-based signals are NOT sent (so the two labelers stay
independent), and a compact digest of the trajectory. Gemini must answer with:

  { category, first_divergence_step, evidence_step_ids, explanation (<= 60 words) }

Outputs are cached in bench/judge_cache.json keyed by trajectory id and digest hash, so
re-running is free and the exported site never needs the API.

    python -m bench.judge                 # judge every failed trajectory not yet cached
    python -m bench.judge --gold-only     # just the 20 gold-labelled failures
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time

from . import BENCH_DIR, RUNS_DIR
from .rules import CATEGORIES
from .tasks.build import load_tasks

CACHE_PATH = BENCH_DIR / "judge_cache.json"
GOLD_PATH = BENCH_DIR / "labels_gold.json"
PROMPT_PATH = BENCH_DIR / "bench" / "judge_prompt.json"

SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": CATEGORIES},
        "first_divergence_step": {"type": "integer"},
        "evidence_step_ids": {"type": "array", "items": {"type": "integer"}},
        "explanation": {"type": "string"},
    },
    "required": ["category", "first_divergence_step", "evidence_step_ids", "explanation"],
}

REFERENCE_SUMMARY = (
    "Reference pipeline: (1) load counts.tsv and read design.md; (2) QC: reads per sgRNA, zero-count guides, Gini "
    "per sample; (3) replicate correlation of guide LFC vs day0; (4) exclude treat_rep2 (≈110 reads/sgRNA, Gini 0.40, "
    "r≈0.45: a cell bottleneck); (5) median-of-ratios (or CPM) depth normalization; (6) guide log2FC of treatment vs "
    "VEHICLE CONTROL (not day0), median per gene; (7) gene z-test against non-targeting guides, one-sided per "
    "direction; (8) Benjamini-Hochberg FDR; (9) interpret: resistance = enriched, sensitizer = depleted, core "
    "essentials deplete in both arms and are not drug hits, pathway enrichment by hypergeometric test."
)

CATEGORY_GUIDE = {
    "problem_interpretation": "misread what was asked: wrong direction (enriched vs depleted), wrong comparison/baseline, wrong quantity",
    "statistical_reasoning": "unsound statistics: no/incorrect normalization, kept a failed replicate, no multiple-testing correction, wrong test",
    "biological_interpretation": "sound numbers, wrong biology: essential genes called drug hits, enrichment by raw overlap, misclassified gene roles",
    "qc_miss": "missed or mis-computed a quality-control metric or the failed sample",
    "execution_error": "code/tool errors the agent never recovered from; no valid answer",
    "formatting": "analysis may be fine but the submitted JSON violates the schema",
}

SYSTEM = (
    "You are an expert reviewer of AI agent trajectories for bioinformatics benchmark tasks (pooled CRISPR screen "
    "analysis). Given a FAILED trajectory, identify the single root-cause failure category and the first step where the "
    "agent diverged from a sound analysis. Judge the root cause, not downstream symptoms. Cite only step ids that appear "
    "in the digest. The explanation must be at most 60 words and refer to concrete evidence."
)


def prompt_template() -> dict:
    return {"system": SYSTEM, "reference_summary": REFERENCE_SUMMARY, "categories": CATEGORY_GUIDE, "schema": SCHEMA}


def _clip(s: str, n: int) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n] + f" …[{len(s) - n} more chars]"


def digest(traj: dict) -> str:
    lines = []
    for s in traj["steps"]:
        out = s.get("output") or {}
        head = f"[step {s['i']}] {s['tool']}"
        if s.get("thought"):
            head += f"\n  thought: {_clip(s['thought'], 300)}"
        lines.append(head)
        args = s.get("args") or {}
        if s["tool"] == "run_python":
            code = "\n".join(str(args.get("code", "")).splitlines()[:30])
            lines.append("  code:\n" + "\n".join("    " + ln for ln in code.splitlines()))
            if out.get("error"):
                lines.append("  error: " + _clip(str(out["error"]).strip().splitlines()[-1], 200))
            elif out.get("stdout"):
                lines.append("  stdout: " + _clip(out["stdout"].strip(), 500).replace("\n", "\n    "))
        elif s["tool"] == "submit_answer":
            lines.append("  answer: " + _clip(str(args.get("answer_json", args)), 600))
        elif s["tool"] == "read_file":
            lines.append(f"  path: {args.get('path')}")
    return "\n".join(lines)


def grade_summary(traj: dict) -> str:
    g = traj["grade"]
    if g.get("error"):
        return f"FAILED: {g['error']} (status: {traj['status']})"
    parts = [f"{c['label']}: {'pass' if c['passed'] else 'FAIL'} (expected {c['expected']}; got {c['actual']}; {c['detail']})"
             for c in g["checks"]]
    return "FAILED checks:\n" + "\n".join("  " + p for p in parts)


def build_prompt(task: dict, traj: dict) -> str:
    cats = "\n".join(f"- {k}: {v}" for k, v in CATEGORY_GUIDE.items())
    return (
        f"TASK {task['id']} — {task['title']}\n{task['prompt']}\n\n"
        f"Grader (deterministic): {task['grader_plain']}\n\n"
        f"{REFERENCE_SUMMARY}\n\n"
        f"Grader result:\n{grade_summary(traj)}\n\n"
        f"Failure categories:\n{cats}\n\n"
        f"Trajectory digest ({len(traj['steps'])} steps, status {traj['status']}):\n{digest(traj)}"
    )


def _key(traj: dict, model: str) -> str:
    return hashlib.sha1((model + build_prompt_cache_key(traj)).encode()).hexdigest()[:16]


def build_prompt_cache_key(traj: dict) -> str:
    return digest(traj) + json.dumps(traj["grade"], sort_keys=True)


def judge_one(client, model: str, task: dict, traj: dict) -> dict:
    from google.genai import types

    t0 = time.perf_counter()
    resp = client.models.generate_content(
        model=model,
        contents=build_prompt(task, traj),
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM,
            response_mime_type="application/json",
            response_json_schema=SCHEMA,
            temperature=0.0,
            max_output_tokens=2048,
        ),
    )
    out = json.loads(resp.text)
    words = out.get("explanation", "").split()
    if len(words) > 60:
        out["explanation"] = " ".join(words[:60]) + "…"
    valid_ids = {s["i"] for s in traj["steps"]}
    out["evidence_step_ids"] = [i for i in out.get("evidence_step_ids", []) if i in valid_ids]
    um = resp.usage_metadata
    return {
        "output": out,
        "model": model,
        "latency_s": round(time.perf_counter() - t0, 2),
        "tokens_in": getattr(um, "prompt_token_count", 0) or 0,
        "tokens_out": (getattr(um, "candidates_token_count", 0) or 0) + (getattr(um, "thoughts_token_count", 0) or 0),
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def load_cache() -> dict:
    return json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}


def iter_trajectories():
    for p in sorted(RUNS_DIR.glob("*.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                yield json.loads(line)


def main(argv: list[str] | None = None) -> None:
    from .run import _load_env

    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold-only", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args(argv)

    PROMPT_PATH.write_text(json.dumps(prompt_template(), indent=1, ensure_ascii=False), encoding="utf-8")
    if not os.environ.get("GEMINI_API_KEY") or not os.environ.get("GEMINI_MODEL"):
        raise SystemExit("GEMINI_API_KEY and GEMINI_MODEL must be set to run the judge (cached labels are used otherwise).")

    from google import genai

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    model = os.environ["GEMINI_MODEL"]
    tasks = load_tasks()
    cache = load_cache()
    gold_ids = {g["trajectory_id"] for g in json.loads(GOLD_PATH.read_text())["labels"]} if GOLD_PATH.exists() else set()
    todo = [t for t in iter_trajectories() if not t["passed"] and (not args.gold_only or t["id"] in gold_ids)]
    done = 0
    for traj in todo:
        k = _key(traj, model)
        if cache.get(traj["id"], {}).get("key") == k:
            continue
        try:
            res = judge_one(client, model, tasks[traj["task_id"]], traj)
        except Exception as e:  # noqa: BLE001
            print(f"  {traj['id']}: judge error {type(e).__name__}: {e}")
            continue
        cache[traj["id"]] = {"key": k, **res}
        done += 1
        print(f"  {traj['id']}: {res['output']['category']} (step {res['output']['first_divergence_step']})")
        if done % 10 == 0:
            CACHE_PATH.write_text(json.dumps(cache, indent=1))
        if args.limit and done >= args.limit:
            break
    CACHE_PATH.write_text(json.dumps(cache, indent=1))
    print(f"judged {done} trajectories; cache has {len(cache)} entries -> {CACHE_PATH}")


if __name__ == "__main__":
    main()
