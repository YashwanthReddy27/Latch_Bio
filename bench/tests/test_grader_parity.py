"""Parity fixtures: the Python engine must reproduce every stored verdict.

The same file is replayed by the TypeScript port (web: `npm run test:parity`).
Regenerate with `python -m bench.graders.fixtures` after changing tasks or graders.
"""

import json

import pytest

from bench.graders import grade
from bench.graders.fixtures import FIXTURE_PATH
from bench.tasks.build import load_tasks

TASKS = load_tasks()
CASES = json.loads(FIXTURE_PATH.read_text())


def test_fixture_file_is_substantial():
    assert len(CASES) >= 100
    assert any(c["expected"]["passed"] for c in CASES)
    assert any(not c["expected"]["passed"] for c in CASES)


@pytest.mark.parametrize("case", CASES, ids=[f"{c['task_id']}:{c['name']}" for c in CASES])
def test_python_matches_fixture(case):
    r = grade(TASKS[case["task_id"]], case["answer"])
    got = {"passed": r["passed"], "score": r["score"], "error_kind": r["error_kind"],
           "checks": [c["passed"] for c in r["checks"]]}
    assert got == case["expected"]
