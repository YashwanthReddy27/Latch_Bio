"""Gemini as the benchmarked agent (manual function calling via google-genai).

Uses the stateless `models.generate_content` API: the full conversation is kept here and
re-sent each turn. The model's own `Content` objects are appended unchanged so Gemini 3
thought signatures are preserved, as required for multi-turn function calling.

Env: GEMINI_API_KEY (required), GEMINI_MODEL (required, e.g. gemini-3.8-flash).
"""

from __future__ import annotations

import json
import os
import time

from ..harness import TOOLS, Action, task_message

SYSTEM_PROMPTS = {
    "minimal": (
        "You are a data analysis agent. Use the tools to analyze the files in the workspace and answer the task. "
        "Call one tool at a time. When you are done, call submit_answer with a JSON object matching the schema."
    ),
    "careful": (
        "You are a careful computational biologist analyzing a pooled CRISPR screen. Work like a reviewer would expect:\n"
        "1. Read design.md and inspect the data before any statistics.\n"
        "2. Run QC first: reads per sgRNA, zero-count guides, Gini index per sample, replicate correlation. "
        "Decide explicitly which samples to exclude and say why.\n"
        "3. Normalize for sequencing depth before computing fold changes.\n"
        "4. Compare against the correct baseline (treatment vs vehicle control unless asked otherwise) and use "
        "non-targeting guides as the null where helpful.\n"
        "5. Control the false discovery rate whenever many genes are tested.\n"
        "6. Separate core-essential fitness effects from treatment-specific effects.\n"
        "7. Before submitting, re-read the task: check the direction (enriched vs depleted), the requested count and the "
        "answer schema.\n"
        "Call one tool at a time; keep printed output short. Finish with submit_answer."
    ),
}

# USD per 1M tokens (standard tier, through 2026-12-31, from ai.google.dev/gemini-api/docs/pricing).
PRICES = {
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.6-flash": (0.75, 3.75),
    "gemini-3.5-flash-lite": (0.30, 2.50),
}
DEFAULT_PRICE = (0.75, 3.75)
MAX_OUTPUT_TOKENS = 8192


RETRY_DELAYS_S = (4, 8, 16, 30, 60, 90)


def with_retry(call):
    """Retry transient Gemini errors (429 rate limit, 500/503 overload) with backoff.
    Time spent waiting is not charged to the agent's step latency budget beyond the call itself."""
    for i, delay in enumerate((*RETRY_DELAYS_S, None)):
        try:
            return call()
        except Exception as e:  # noqa: BLE001
            code = getattr(e, "code", None) or getattr(e, "status_code", None)
            transient = code in (429, 500, 502, 503, 504) or "UNAVAILABLE" in str(e) or "RESOURCE_EXHAUSTED" in str(e)
            if not transient or delay is None:
                raise
            print(f"    gemini {code}: retry {i + 1}/{len(RETRY_DELAYS_S)} in {delay}s", flush=True)
            time.sleep(delay)


def model_id() -> str:
    m = os.environ.get("GEMINI_MODEL", "").strip()
    if not m:
        raise SystemExit("GEMINI_MODEL is not set (e.g. GEMINI_MODEL=gemini-3.8-flash)")
    return m


def tool_declarations(types) -> list:
    return [types.Tool(function_declarations=[
        types.FunctionDeclaration(name=t["name"], description=t["description"], parameters_json_schema=t["parameters"])
        for t in TOOLS
    ])]


def compact_observation(obs: dict) -> dict:
    """What the model sees after a tool call (images are summarized, not sent)."""
    out = dict(obs["output"])
    out.pop("exec_s", None)
    if "images" in out:
        out["images"] = [f"<figure {i + 1} captured>" for i in range(len(out["images"]))]
    return out


class GeminiAgent:
    def __init__(self, config: dict, prompt_variant: str, client=None):
        from google import genai
        from google.genai import types

        self.types = types
        self.config = config
        self.variant = prompt_variant
        self.model = config["model"]
        self.client = client or genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        self.injected = None
        self.price = PRICES.get(self.model, DEFAULT_PRICE)

    def start(self, task: dict, run_idx: int) -> None:
        t = self.types
        self.contents = [t.Content(role="user", parts=[t.Part.from_text(text=task_message(task))])]
        self.pending: list = []  # function calls from the last model turn not yet executed
        self.responses: list = []  # function responses waiting to be sent
        self.gen_config = t.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPTS[self.variant],
            tools=tool_declarations(t),
            max_output_tokens=MAX_OUTPUT_TOKENS,
            temperature=1.0,
            thinking_config=t.ThinkingConfig(include_thoughts=True),
            automatic_function_calling=t.AutomaticFunctionCallingConfig(disable=True),
        )
        self.nudges = 0

    def _record_observation(self, observation: dict | None) -> None:
        if observation is None or not self._last_call:
            return
        fc = self._last_call
        self.responses.append(self.types.Part(function_response=self.types.FunctionResponse(
            id=fc.id, name=fc.name, response={"result": compact_observation(observation)})))
        self._last_call = None

    _last_call = None

    def act(self, observation: dict | None) -> Action | None:
        t = self.types
        self._record_observation(observation)
        tokens_in = tokens_out = tokens_think = 0
        latency = 0.0
        thought = ""
        if not self.pending:
            if self.responses:
                self.contents.append(t.Content(role="user", parts=self.responses))
                self.responses = []
            while True:
                t0 = time.perf_counter()
                resp = with_retry(lambda: self.client.models.generate_content(
                    model=self.model, contents=self.contents, config=self.gen_config))
                latency += time.perf_counter() - t0
                um = resp.usage_metadata
                if um:
                    tokens_in += um.prompt_token_count or 0
                    tokens_out += um.candidates_token_count or 0
                    tokens_think += um.thoughts_token_count or 0
                cand = resp.candidates[0] if resp.candidates else None
                if cand is None or cand.content is None:
                    return None
                self.contents.append(cand.content)
                parts = cand.content.parts or []
                thought = "\n".join(p.text for p in parts if p.text).strip()
                calls = [p.function_call for p in parts if p.function_call]
                if calls:
                    self.pending = calls
                    break
                # text-only turn: nudge once or twice, then give up
                self.nudges += 1
                if self.nudges > 2:
                    return None
                self.contents.append(t.Content(role="user", parts=[t.Part.from_text(
                    text="Continue by calling a tool. When finished, call submit_answer.")]))
        fc = self.pending.pop(0)
        self._last_call = fc
        args = dict(fc.args or {})
        cost = (tokens_in * self.price[0] + (tokens_out + tokens_think) * self.price[1]) / 1e6
        return Action(tool=fc.name, args=args, thought=thought, tokens_in=tokens_in, tokens_out=tokens_out,
                      tokens_thinking=tokens_think, latency_s=latency, cost_usd=cost,
                      meta={"prompt": self.variant})


def config_for(variant: str) -> dict:
    m = model_id()
    return {
        "id": f"{m}__{variant}",
        "label": f"{m} · {variant} prompt",
        "kind": "REAL",
        "model": m,
        "harness": f"helix-react-v1 / {variant}",
        "description": f"Gemini ({m}) with function calling; '{variant}' system prompt.",
    }


def dump_system_prompts() -> str:
    return json.dumps(SYSTEM_PROMPTS, indent=1)
