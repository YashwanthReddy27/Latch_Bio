"""Agent loop: tool definitions, step execution, trajectory logging and grading."""

from __future__ import annotations

import json
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from .graders import grade
from .sandbox import Sandbox
from .tasks.build import make_workspace

MAX_STEPS = 25

TOOLS: list[dict] = [
    {
        "name": "run_python",
        "description": (
            "Execute Python code in a persistent session (variables persist between calls). "
            "The working directory contains the task's input files. numpy, pandas, scipy and "
            "matplotlib are available. Use print() to see results; output is truncated to ~6,000 characters. "
            "Matplotlib figures are captured automatically."
        ),
        "parameters": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "Python source to execute."}},
            "required": ["code"],
        },
    },
    {
        "name": "list_files",
        "description": "List files in the workspace with their sizes in bytes.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "read_file",
        "description": "Read the beginning of a text file in the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path relative to the workspace."},
                "max_bytes": {"type": "integer", "description": "Maximum bytes to return (default 4000, max 20000)."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "submit_answer",
        "description": "Submit the final answer as a JSON object matching the required schema. Ends the task.",
        "parameters": {
            "type": "object",
            "properties": {"answer_json": {"type": "string", "description": "The answer as a JSON-encoded object."}},
            "required": ["answer_json"],
        },
    },
]


def task_message(task: dict) -> str:
    return (
        f"{task['context']}\n\n"
        f"TASK ({task['id']}): {task['prompt']}\n\n"
        f"Input files: {', '.join(task['inputs'])}\n"
        f"Submit your final answer with submit_answer. The answer must be a JSON object matching this schema:\n"
        f"{json.dumps(task['answer_schema'])}\n"
        f"You have at most {MAX_STEPS} tool calls."
    )


@dataclass
class Action:
    tool: str
    args: dict
    thought: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    tokens_thinking: int = 0
    latency_s: float = 0.0
    cost_usd: float = 0.0
    meta: dict = field(default_factory=dict)


class Agent(Protocol):
    config: dict

    def start(self, task: dict, run_idx: int) -> None: ...

    def act(self, observation: dict | None) -> Action | None:
        """Return the next action, or None to stop without submitting."""


def execute(sandbox: Sandbox, action: Action) -> dict:
    t0 = time.perf_counter()
    if action.tool == "run_python":
        out = sandbox.run_python(str(action.args.get("code", "")))
    elif action.tool == "list_files":
        out = sandbox.list_files()
    elif action.tool == "read_file":
        out = sandbox.read_file(str(action.args.get("path", "")), int(action.args.get("max_bytes", 4000) or 4000))
    elif action.tool == "submit_answer":
        raw = action.args.get("answer_json", action.args.get("answer"))
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                out = {"accepted": True, "answer": parsed}
            except json.JSONDecodeError as e:
                out = {"accepted": False, "error": f"answer_json is not valid JSON: {e}", "raw": raw[:500]}
        else:
            out = {"accepted": True, "answer": raw}
    else:
        out = {"error": f"unknown tool '{action.tool}'"}
    out.setdefault("exec_s", round(time.perf_counter() - t0, 3))
    return out


def run_episode(agent: Agent, task: dict, run_idx: int, workdir: Path | None = None) -> dict:
    """Run one agent on one task and return a full trajectory record."""
    cfg = agent.config
    traj_id = f"{cfg['id']}__{task['id']}__r{run_idx}"
    tmp = tempfile.TemporaryDirectory(prefix="helix_", ignore_cleanup_errors=True) if workdir is None else None
    ws = make_workspace(task, Path(tmp.name) if tmp else workdir)
    steps: list[dict] = []
    answer: Any = None
    status = "max_steps"
    t_start = time.perf_counter()
    try:
        with Sandbox(ws) as sb:
            agent.start(task, run_idx)
            obs: dict | None = None
            for i in range(MAX_STEPS):
                try:
                    action = agent.act(obs)
                except Exception as e:  # noqa: BLE001 - API errors end the episode, logged
                    status = "agent_error"
                    steps.append({"i": i, "thought": "", "tool": "agent_error", "args": {},
                                  "output": {"error": f"{type(e).__name__}: {e}"},
                                  "tokens_in": 0, "tokens_out": 0, "tokens_thinking": 0,
                                  "cost_usd": 0.0, "latency_s": 0.0, "exec_s": 0.0})
                    break
                if action is None:
                    status = "no_submission"
                    break
                out = execute(sb, action)
                images = out.pop("images", []) if action.tool == "run_python" else []
                steps.append({
                    "i": i, "thought": action.thought, "tool": action.tool, "args": action.args,
                    "output": out, "images": [str((ws / p).resolve()) for p in images],
                    "tokens_in": action.tokens_in, "tokens_out": action.tokens_out,
                    "tokens_thinking": action.tokens_thinking, "cost_usd": round(action.cost_usd, 6),
                    "latency_s": round(action.latency_s, 3), "exec_s": out.get("exec_s", 0.0),
                    **({"meta": action.meta} if action.meta else {}),
                })
                obs = {"tool": action.tool, "output": out}
                if action.tool == "submit_answer":
                    if out.get("accepted"):
                        answer = out["answer"]
                        status = "submitted"
                        break
                    # invalid JSON: let the agent retry
            wall = time.perf_counter() - t_start
            # keep plot files alive past the temp dir: copy bytes into the record
            for s in steps:
                s["images"] = [_read_png(p) for p in s.get("images", [])]
    finally:
        if tmp:
            _remove_tree(Path(tmp.name))
            tmp.cleanup()

    result = grade(task, answer) if status == "submitted" else grade(task, None)
    totals = {
        "n_steps": len(steps),
        "tokens_in": sum(s["tokens_in"] for s in steps),
        "tokens_out": sum(s["tokens_out"] for s in steps),
        "tokens_thinking": sum(s["tokens_thinking"] for s in steps),
        "cost_usd": round(sum(s["cost_usd"] for s in steps), 6),
        "model_latency_s": round(sum(s["latency_s"] for s in steps), 3),
        "exec_s": round(sum(s["exec_s"] for s in steps), 3),
        "wall_s": round(wall + sum(s["latency_s"] for s in steps if cfg["kind"] == "SIMULATED"), 3),
    }
    return {
        "id": traj_id,
        "config_id": cfg["id"],
        "task_id": task["id"],
        "run_idx": run_idx,
        "kind": cfg["kind"],
        "model": cfg["model"],
        "harness": cfg["harness"],
        "status": status,
        "answer": answer,
        "grade": result,
        "passed": bool(result["passed"]),
        "totals": totals,
        "steps": steps,
        "injected": getattr(agent, "injected", None),
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _remove_tree(path: Path, attempts: int = 5) -> None:
    """Windows can hold a lock on the workspace for a moment after the kernel is killed;
    retry so sweeps don't leave hundreds of empty temp folders behind."""
    import shutil

    for i in range(attempts):
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            return
        time.sleep(0.2 * (i + 1))


def _read_png(path: str) -> dict:
    import base64
    import hashlib

    data = Path(path).read_bytes()
    return {"sha": hashlib.sha1(data).hexdigest()[:16], "b64": base64.b64encode(data).decode()}
