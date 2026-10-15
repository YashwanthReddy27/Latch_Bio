"""Generate grader parity fixtures: (task, answer) -> expected verdict.

The fixtures are consumed by tests/test_grader_parity.py (Python engine) and by
web/scripts/grader-parity.test.ts (TypeScript engine). Both must reproduce every verdict.

    python -m bench.graders.fixtures
"""

from __future__ import annotations

import copy
import json
import shutil
import tempfile
from pathlib import Path

from .. import BENCH_DIR, SCREEN_DIR
from ..pipeline import MISTAKES, build_cells, run_inprocess
from ..tasks.build import BASE_INPUTS, TASK_FILES_DIR, load_tasks
from .engine import grade

FIXTURE_PATH = BENCH_DIR / "tests" / "fixtures" / "grader_cases.json"


def _edge_cases(task: dict) -> list[tuple[str, object]]:
    ref = task["reference_answer"]
    cases: list[tuple[str, object]] = [
        ("null answer", None),
        ("string answer", "treat_rep2"),
        ("empty object", {}),
        ("array answer", [ref]),
    ]
    # perturb each top-level field type
    for key, val in ref.items():
        bad = copy.deepcopy(ref)
        if isinstance(val, bool) or isinstance(val, int):
            bad[key] = True
        elif isinstance(val, (float, str)):
            bad[key] = [val]
        elif isinstance(val, list):
            bad[key] = ",".join(map(str, val))
        elif isinstance(val, dict):
            bad[key] = list(val.values())
        cases.append((f"wrong type for {key}", bad))
    # case / whitespace insensitivity should still pass
    lower = json.loads(json.dumps(ref).lower()) if task["id"] in ("T03", "T06", "T08", "T09", "T11", "T12") else None
    if lower is not None:
        cases.append(("lower-cased strings", lower))
    return cases


def generate() -> list[dict]:
    tasks = load_tasks()
    cases: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp:
        wd = Path(tmp)
        for name in BASE_INPUTS:
            shutil.copy(SCREEN_DIR / name, wd / name)
        shutil.copy(TASK_FILES_DIR / "T10" / "candidates.json", wd / "candidates.json")
        for tid, task in tasks.items():
            cases.append({"task_id": tid, "name": "reference", "answer": task["reference_answer"]})
            for mk, m in MISTAKES.items():
                if tid in m.tasks and mk != "execution_error":
                    ans = run_inprocess(build_cells(tid, (mk,)), wd)["answer"]
                    cases.append({"task_id": tid, "name": f"mistake:{mk}", "answer": ans})
            for name, ans in _edge_cases(task):
                cases.append({"task_id": tid, "name": name, "answer": ans})
    # boundary cases on tolerances
    t05 = tasks["T05"]
    for delta, name in [(0.2, "T05 at tolerance edge"), (0.2001, "T05 just outside tolerance")]:
        ans = copy.deepcopy(t05["reference_answer"])
        ans["lfc"]["MLH1"] = round(ans["lfc"]["MLH1"] + delta, 6)
        cases.append({"task_id": "T05", "name": name, "answer": ans})
    for n, name in [(8, "T07 range min"), (24, "T07 range max"), (25, "T07 above range")]:
        cases.append({"task_id": "T07", "name": name, "answer": {"n_significant": n}})
    for c in cases:
        r = grade(tasks[c["task_id"]], c["answer"])
        c["expected"] = {"passed": r["passed"], "score": r["score"], "error_kind": r["error_kind"],
                         "checks": [ch["passed"] for ch in r["checks"]]}
    return cases


def main() -> None:
    from ..harness import task_message

    msgs = {tid: task_message(t) for tid, t in load_tasks().items()}
    (FIXTURE_PATH.parent / "task_messages.json").write_text(json.dumps(msgs, indent=1))
    cases = generate()
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(cases, indent=1))
    n_pass = sum(c["expected"]["passed"] for c in cases)
    print(f"wrote {len(cases)} cases ({n_pass} passing) to {FIXTURE_PATH}")


if __name__ == "__main__":
    main()
