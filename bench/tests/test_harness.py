"""Sandbox, harness loop and agent bookkeeping (no network)."""

from __future__ import annotations

import json

import pytest

from bench.configs import make_agent
from bench.harness import run_episode
from bench.sandbox import Sandbox
from bench.tasks.build import load_tasks

TASKS = load_tasks()


def test_sandbox_persistent_state_and_errors(tmp_path):
    (tmp_path / "x.txt").write_text("hello")
    with Sandbox(tmp_path, timeout_s=20) as sb:
        assert sb.run_python("a = 41")["error"] is None
        assert sb.run_python("print(a + 1)")["stdout"].strip() == "42"
        err = sb.run_python("1/0")["error"]
        assert "ZeroDivisionError" in err
        assert sb.read_file("x.txt")["content"] == "hello"
        assert "error" in sb.read_file("../outside.txt")
        assert [f["path"] for f in sb.list_files()["files"]] == ["x.txt"]


def test_sandbox_timeout_restarts_kernel(tmp_path):
    with Sandbox(tmp_path, timeout_s=2) as sb:
        sb.run_python("a = 1")
        out = sb.run_python("import time; time.sleep(10)")
        assert "TimeoutError" in out["error"]
        assert "NameError" in sb.run_python("print(a)")["error"]  # state lost, reported


def test_sandbox_truncates_output(tmp_path):
    with Sandbox(tmp_path, timeout_s=20) as sb:
        out = sb.run_python("print('x' * 50000)")
        assert out["truncated"] and len(out["stdout"]) < 7000


def test_sandbox_captures_plots(tmp_path):
    with Sandbox(tmp_path, timeout_s=60) as sb:
        out = sb.run_python("import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])")
        assert out["images"] and out["images"][0].endswith(".png")


def test_reference_baseline_passes_end_to_end():
    traj = run_episode(make_agent("baseline-reference"), TASKS["T08"], 0)
    assert traj["passed"] and traj["status"] == "submitted"
    assert traj["steps"][-1]["tool"] == "submit_answer"
    assert traj["totals"]["cost_usd"] == 0


def test_naive_baseline_fails_direction_sensitive_task():
    traj = run_episode(make_agent("baseline-naive"), TASKS["T09"], 0)
    assert not traj["passed"]
    assert "compare_to_day0" in traj["injected"]["mistakes"]


def test_simulated_agent_is_seeded():
    a = run_episode(make_agent("sim-d-small"), TASKS["T01"], 3)
    b = run_episode(make_agent("sim-d-small"), TASKS["T01"], 3)
    assert [s["args"] for s in a["steps"]] == [s["args"] for s in b["steps"]]
    assert a["passed"] == b["passed"]


# ------------------------------------------------------------------ Gemini (mocked client)

class _FakeModels:
    """Returns canned function calls; records every request it receives."""

    def __init__(self, types, script):
        self.types, self.script, self.calls = types, list(script), []

    def generate_content(self, model, contents, config):
        t = self.types
        self.calls.append(list(contents))
        name, args = self.script.pop(0)
        parts = [t.Part(text="thinking about it", thought=True),
                 t.Part(function_call=t.FunctionCall(id=f"c{len(self.calls)}", name=name, args=args),
                        thought_signature=b"sig")]
        return t.GenerateContentResponse(
            candidates=[t.Candidate(content=t.Content(role="model", parts=parts))],
            usage_metadata=t.GenerateContentResponseUsageMetadata(
                prompt_token_count=1000, candidates_token_count=50, thoughts_token_count=20),
        )


class _FakeClient:
    def __init__(self, models):
        self.models = models


def test_gemini_agent_loop_with_fake_client(monkeypatch):
    pytest.importorskip("google.genai")
    from google.genai import types

    from bench.agents.gemini import GeminiAgent

    monkeypatch.setenv("GEMINI_MODEL", "gemini-test")
    ref = TASKS["T01"]["reference_answer"]
    models = _FakeModels(types, [
        ("list_files", {}),
        ("run_python", {"code": "import pandas as pd\nc = pd.read_csv('counts.tsv', sep='\\t')\nprint((c.plasmid == 0).sum())"}),
        ("submit_answer", {"answer_json": json.dumps(ref)}),
    ])
    cfg = {"id": "gemini-test__minimal", "kind": "REAL", "model": "gemini-test", "harness": "test"}
    agent = GeminiAgent(cfg, "minimal", client=_FakeClient(models))
    traj = run_episode(agent, TASKS["T01"], 0)

    assert traj["passed"]
    assert [s["tool"] for s in traj["steps"]] == ["list_files", "run_python", "submit_answer"]
    assert traj["steps"][1]["output"]["stdout"].strip() == str(ref["zero_in_plasmid"])
    assert traj["totals"]["tokens_in"] == 3000 and traj["totals"]["cost_usd"] > 0
    # the model turn (with its thought signature) is echoed back, followed by a function response
    last_request = models.calls[-1]
    assert last_request[-2].role == "model"
    assert last_request[-2].parts[1].thought_signature == b"sig"
    fr = last_request[-1].parts[0].function_response
    assert fr.name == "run_python" and fr.id == "c2"
