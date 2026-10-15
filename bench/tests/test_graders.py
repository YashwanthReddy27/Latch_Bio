"""Grader unit tests: every task's reference answer passes, and known-wrong answers fail."""

from __future__ import annotations

import copy
import shutil
from pathlib import Path

import pytest

from bench import SCREEN_DIR
from bench.graders import grade, validate_schema
from bench.pipeline import MISTAKES, build_cells, run_inprocess
from bench.tasks.build import BASE_INPUTS, TASK_FILES_DIR, load_tasks

TASKS = load_tasks()
TASK_IDS = sorted(TASKS)

# Mistakes that are designed to flip the verdict on a given task. (Some catalogued mistakes
# are harmless on some tasks — e.g. skipping depth normalization does not change a z-score
# centred on non-targeting guides — and that is intentional realism, not a grader bug.)
MUST_FAIL = {
    "T01": ["zero_any_sample", "format_error"],
    "T02": ["gini_on_log", "format_error"],
    "T03": ["misread_bad_replicate", "format_error"],
    "T04": ["per_gene_coverage", "format_error"],
    "T05": ["skip_normalization", "keep_bad_replicate", "compare_to_day0", "format_error"],
    "T06": ["keep_bad_replicate", "format_error"],
    "T07": ["no_fdr_correction", "format_error"],
    "T08": ["flip_direction", "format_error"],
    "T09": ["flip_direction", "compare_to_day0", "format_error"],
    "T10": ["essentials_as_hits", "format_error"],
    "T11": ["flip_direction", "pathway_by_overlap", "format_error"],
    "T12": ["no_fdr_correction", "compare_to_day0", "essentials_as_hits", "format_error"],
}


@pytest.fixture(scope="module")
def workspace(tmp_path_factory) -> Path:
    wd = tmp_path_factory.mktemp("ws")
    for name in BASE_INPUTS:
        shutil.copy(SCREEN_DIR / name, wd / name)
    shutil.copy(TASK_FILES_DIR / "T10" / "candidates.json", wd / "candidates.json")
    return wd


def test_twelve_tasks():
    assert TASK_IDS == [f"T{i:02d}" for i in range(1, 13)]
    cats = {t["category"] for t in TASKS.values()}
    assert cats == {"qc", "statistical_reasoning", "problem_interpretation", "biological_interpretation"}


@pytest.mark.parametrize("tid", TASK_IDS)
def test_reference_answer_passes(tid):
    r = grade(TASKS[tid], TASKS[tid]["reference_answer"])
    assert r["passed"], r
    assert r["score"] == 1.0


@pytest.mark.parametrize("tid", TASK_IDS)
def test_reference_pipeline_reproduces_answer(tid, workspace):
    ans = run_inprocess(build_cells(tid), workspace)["answer"]
    assert grade(TASKS[tid], ans)["passed"]


@pytest.mark.parametrize("tid,mistake", [(t, m) for t, ms in MUST_FAIL.items() for m in ms])
def test_known_wrong_answer_fails(tid, mistake, workspace):
    assert tid in MISTAKES[mistake].tasks
    ans = run_inprocess(build_cells(tid, (mistake,)), workspace)["answer"]
    r = grade(TASKS[tid], ans)
    assert not r["passed"], f"{mistake} should fail {tid}: {r}"
    if mistake == "format_error":
        assert r["error_kind"] == "schema"


@pytest.mark.parametrize("tid", TASK_IDS)
def test_malformed_answers_fail(tid):
    task = TASKS[tid]
    for bad in [None, "text", [], {}, {"unexpected": 1}]:
        r = grade(task, bad)
        assert not r["passed"]
        assert r["score"] == 0.0


def test_graders_are_deterministic():
    for tid in TASK_IDS:
        a = grade(TASKS[tid], TASKS[tid]["reference_answer"])
        b = grade(TASKS[tid], copy.deepcopy(TASKS[tid]["reference_answer"]))
        assert a == b


def test_direction_trap_t08():
    sens = TASKS["T09"]["ground_truth"]["planted_sensitizer"][:15]
    assert not grade(TASKS["T08"], {"genes": sens})["passed"]


def test_t07_uncorrected_count_fails():
    assert not grade(TASKS["T07"], {"n_significant": 211})["passed"]
    assert grade(TASKS["T07"], {"n_significant": 12})["passed"]


def test_t05_alternative_normalizations_pass():
    ref = TASKS["T05"]["reference_answer"]["lfc"]
    shifted = {"lfc": {g: v + 0.05 for g, v in ref.items()}}
    assert grade(TASKS["T05"], shifted)["passed"]
    depth_bias = {"lfc": {g: v + 1.0 for g, v in ref.items()}}
    assert not grade(TASKS["T05"], depth_bias)["passed"]


def test_case_insensitive_gene_names():
    genes = [g.lower() for g in TASKS["T08"]["reference_answer"]["genes"]]
    assert grade(TASKS["T08"], {"genes": genes})["passed"]


def test_too_many_items_fails():
    genes = TASKS["T08"]["reference_answer"]["genes"] + ["HX0001"]
    assert not grade(TASKS["T08"], {"genes": genes})["passed"]


def test_bool_is_not_integer():
    assert validate_schema({"n_significant": True}, TASKS["T07"]["answer_schema"])


def test_t10_essentials_as_hits_fails():
    labels = TASKS["T10"]["ground_truth"]["labels"]
    ans = {"core_essential": [], "treatment_specific": [g for g, c in labels.items() if c != "neither"],
           "neither": [g for g, c in labels.items() if c == "neither"]}
    assert not grade(TASKS["T10"], ans)["passed"]
