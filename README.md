# Helix Trace

An agent-trajectory explorer and mini-benchmark for AI agents doing biology data analysis.

- **CRISPRScreenBench-mini** (`/bench`) has 12 verifiable tasks on a seeded synthetic pooled CRISPR knockout screen, each with a deterministic grader. A harness runs agents (scripted, SIMULATED, or Gemini) with a sandboxed Python tool and logs every step.
- **Helix Trace** (`/web`) is a Next.js app for reading those trajectories:
  - a leaderboard with Wilson CIs
  - a **failure taxonomy** (rule-based labels plus a Gemini judge, with disagreements surfaced)
  - a step-by-step trajectory viewer with evidence lines
  - side-by-side diffs
  - a **Live run** page that streams a Gemini agent whose code executes in the browser via Pyodide

> Synthetic screen data and simulated agent runs for demonstration. Not affiliated with LatchBio.

## Why this matters for LatchBio's benchmark work

LatchBio's benchmarks (scBench, SpatialBench, EpiBench, …) find that agents produce plausible analyses yet fail on problem interpretation, statistical reasoning and biological interpretation. A pass rate says *that* a configuration fails. Helix Trace shows *why and where*: every failed run gets a root-cause label, a first-divergence step relative to the reference pipeline, and the code lines that triggered the label. The labels are checked against injected-fault ground truth and a gold set rather than trusted blindly, and LLM-judge/rule disagreements are shown. It also adds a domain the benchmark list doesn't cover yet: pooled CRISPR screen analysis, where direction of selection, choice of baseline and essential-gene confounding are classic traps.

## Repo layout

```
bench/                 Python 3.11+ package (CRISPRScreenBench-mini)
  bench/datagen.py       seeded synthetic screen (NB counts, planted truth)
  bench/tasks/           T01–T12.json task specs + build.py (answer key from the reference pipeline)
  bench/graders/         declarative grader engine + parity fixture generator
  bench/pipeline.py      reference analysis cells + realistic mistake catalog
  bench/sandbox.py       persistent Python kernel in a subprocess (timeout, workspace, plot capture)
  bench/harness.py       25-step agent loop, tools, trajectory logging
  bench/agents/          scripted / SIMULATED agents, Gemini agent (google-genai)
  bench/rules.py         rule-based failure labels + first-divergence step
  bench/judge.py         Gemini failure judge (structured output) + cache
  bench/export.py        writes web/public/data/*.json
  labels_gold.json       20 hand-labeled failures
  runs/                  trajectories (JSONL, one file per config)
web/                   Next.js 14 App Router + TypeScript + Tailwind + Recharts (deploy root)
  public/data/           exported JSON the site reads statically (no database)
  public/tasks/          task input files for the in-browser runner
  public/pyodide-worker.js  Pyodide sandbox (module Web Worker)
  lib/graders/engine.ts  TypeScript port of the grader engine
  app/api/agent/*        live-run routes (Gemini, server-side key, rate-limited)
  app/api/label          Gemini judge for live runs
```

## The benchmark

The screen covers 2,000 genes × 4 sgRNAs plus 200 non-targeting controls. Samples are plasmid, day 0, two helixin-treated replicates and two vehicle replicates, with negative-binomial counts. Planted ground truth:
- 148 core-essential genes, depleted in both arms
- 30 treatment-specific hits: 12 resistance (7 from mismatch repair), 18 sensitizers (HR, Fanconi, TLS, MGMT)
- per-guide efficacy noise with ~6% near-dead guides
- 40 failed-synthesis guides (zero reads)
- a bottlenecked `treat_rep2`: 110 reads/sgRNA, Gini 0.40

The biology is modeled on temozolomide screens, but every number is synthetic.

| Probes | Tasks |
|---|---|
| QC | T01 zero-count guides · T02 Gini per sample · T03 identify the failed replicate · T04 library representation |
| Statistical reasoning | T05 normalized fold changes · T06 replicate handling · T07 FDR-controlled hit count |
| Problem interpretation | T08 resistance genes · T09 sensitizer genes (direction and baseline traps) |
| Biological interpretation | T10 core-essential vs treatment-specific · T11 pathway enrichment · T12 end-to-end hit calls |

### How the graders stay deterministic

- **Declarative checks only.** A task's grader is JSON built from a small set of check kinds: `exact`, `numeric`, `numeric_map`, `range`, `set_equal`, `set_overlap`, `f1`, `max_overlap`, `classification`. They use no LLM, no randomness and no wall clock, so the same answer always gets the same verdict.
- **Calibrated tolerances.** Numeric expected values come from the reference pipeline run on the generated data. Tolerances are set so every legitimate method passes: T05 accepts CPM, total-count, median-of-ratios or NTC normalization with pseudocount 0.5–1, all within 0.05 of each other. Each catalogued mistake fails: skipping normalization shifts LFCs by about +1.
- **Planted truth for hit recovery.** Hit-recovery tasks are graded against the planted genes, with recall/precision/F1 thresholds the reference clears with margin.
- **Schema first.** A schema check runs before any grading check. Malformed answers fail as formatting errors.
- **Tests.** `pytest` checks that every reference answer passes, that every designed mistake fails (a flipped sign, uncorrected p-values, essentials reported as hits…), and that malformed answers fail.
- **Python/TypeScript parity.** `bench/tests/fixtures/grader_cases.json` (129 cases) is replayed by both pytest and `npm run test:parity`, which must produce identical verdicts. The parity test also checks that the live route's task prompt matches the Python harness byte for byte.

### Add a task

1. Add a spec in `bench/bench/tasks/build.py` (`task_specs`): prompt, `answer_schema`, `grader.checks`, `grader_plain`, `traps`, `milestones`, and optional `extra_inputs`.
2. Add the reference submit cell to `SUBMIT` and its recipe to `RECIPES` in `bench/bench/pipeline.py`. Add mistakes to `MISTAKES` if the task has new traps.
3. Run `python -m bench.tasks.build`. It refuses to write a task whose reference answer fails its own grader.
4. Add must-fail cases to `tests/test_graders.py`, then regenerate the parity fixtures with `python -m bench.graders.fixtures`.
5. Run `pytest`, then `cd web && npm run test:parity`.

## Run the harness

```bash
cd bench
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -e ".[gemini,dev]"
pytest                                               # 213 tests

python -m bench.run --model baseline-reference --tasks all --n 3
python -m bench.run --model sim-c-mid --tasks T05,T07 --n 5
python -m bench.run --sweep                          # all offline configs (the demo data)
python -m bench.run --model gemini --prompt careful --tasks all --n 3   # REAL runs, needs .env
```

Offline model ids: `baseline-reference`, `baseline-naive`, `sim-a-careful`, `sim-b-fast`, `sim-c-mid`, `sim-d-small`. Trajectories go to `bench/runs/<config>.jsonl` and contain thoughts, tool calls, outputs, the final answer, tokens, cost, latency and wall time per step.

**Gemini.** The harness uses the official `google-genai` SDK with manual function calling through `models.generate_content`. It defines four tools: `run_python`, `list_files`, `read_file` and `submit_answer`. The model's own `Content` is sent back unchanged, so Gemini 3 thought signatures are preserved. The model id is read from `GEMINI_MODEL` and never hardcoded. This project was built for **`gemini-3.8-flash`**, the current stable Flash model as of October 2026, priced at $0.75 / $3.75 per 1M input/output tokens. Two configs are compared: a minimal system prompt and a "careful analyst" prompt that asks for QC first.

## Regenerate the data

```bash
cd bench
python -m bench.datagen            # synthetic screen (seeded)
python -m bench.tasks.build        # task specs + answer key
python -m bench.graders.fixtures   # parity fixtures
python -m bench.run --sweep        # 312 offline trajectories (~20 min on 8 cores)
python -m bench.judge              # optional: Gemini judge on failures (needs key; cached)
python -m bench.export             # -> web/public/data, web/public/tasks, web/lib/generated
```

## Environment

Create `.env` in the repo root for the Python side. Set the same variables in Vercel for the web app. **The site works with none of them:** `/live` then replays cached runs.

```bash
GEMINI_API_KEY=            # server-side only, never sent to the browser
GEMINI_MODEL=gemini-3.8-flash
# optional (web)
RUN_TOKEN_SECRET=          # signs live-run tokens; derived from the key if unset
LIVE_RUNS_PER_HOUR=5
LIVE_STEPS_PER_HOUR=150
LIVE_DAILY_RUN_CAP=200
LIVE_MAX_OUTPUT_TOKENS=4096
LIVE_RUNS_DISABLED=        # 1 = pause live runs without removing the key
KV_REST_API_URL=           # Vercel KV / Upstash REST: shared rate limits across instances
KV_REST_API_TOKEN=
```

## Live run: architecture and abuse protection

```
browser                                     Next.js (Node runtime)              Gemini
 ├─ POST /api/agent/start ───────────────▶ rate limit (IP, daily cap) ── signed run token
 ├─ loop ≤ 25 steps:
 │   POST /api/agent/step {token, history} ▶ verify token + history ────────▶ generateContent
 │   ◀── next function call ─────────────── (tools, max output tokens)  ◀──
 │   execute in Pyodide Web Worker (numpy, pandas, scipy, matplotlib)
 ├─ grade with lib/graders/engine.ts (same verdicts as Python)
 └─ POST /api/label (if failed) ─────────▶ judge, structured output ──────────▶
```

- **Signed run tokens.** The key is usable only through a run that `/api/agent/start` issued. Each token is short-lived, HMAC-signed and bound to the client's IP. It also carries a per-run step budget.
- **Conversation validation.** The conversation must begin with the exact task prompt. Later user turns may contain only tool results, and parts are restricted to text, function calls and function responses. This means the route can't be used as a general chatbot.
- **Limits.** 5 runs per hour per IP, 150 steps per hour per IP, a daily run cap, a 25-step maximum, a 4,096 output-token maximum and a 300 KB request cap.
- **Quota handling.** A Gemini 429 or quota error pauses live runs for 15 minutes, and the UI shows *Live runs temporarily paused*.
- **No key.** Without a key, `/live` replays a cached run with the same streaming UI, labeled **Replay**. By default it re-executes the cached agent's code in Pyodide and re-grades the answer in the browser.

## Deploy on Vercel

1. Push the repo to GitHub and import it in Vercel.
2. Set **Root Directory** to `web`. The framework preset is Next.js; build is `npm run build` and output is the default.
3. Under **Settings → Environment Variables**, add `GEMINI_API_KEY`, `GEMINI_MODEL` and (recommended) `RUN_TOKEN_SECRET`. Optionally connect Vercel KV / Upstash so rate limits are shared across instances.
4. Deploy. All pages are statically generated from `web/public/data`; only the four `/api` routes run server-side.

## Limitations

- **The data is synthetic.** The biology is plausible and the gene symbols are real, but the effects are planted. One screen design and one drug.
- **SIMULATED configs are not models.** Their mistakes are injected at controlled rates into the reference pipeline. The code really runs, but tokens, cost and latency are estimates from text length and a price table.
- **REAL runs and judge labels are not included yet** (no API key at build time). The harness, judge and live route are wired and tested against a mocked Gemini client. One command each produces them.
- **The rule labeler knows the mistake catalog.** That makes "rule vs injected fault: 132/132" a sanity check, not a validation. On the 20-run gold set the rules score 18/20, and that is optimistic: the gold labels were drafted by an AI assistant (blind to rule output) and need human review, and the rules were revised once after the gold set was drafted, demoting process-level signals that rarely flip a verdict. The two remaining disagreements are kept visible.
- **"First divergence" is the earliest departure from the reference milestones, even if that departure was harmless.** It is computed from regex-detected milestones, which a creative agent could evade.
- **The sandbox is process-level isolation** (separate interpreter, throwaway workspace, timeout, stripped environment). It is not a security boundary for hostile code. The browser sandbox inherits Pyodide's limits; its first load is about 30 MB.
- **In-memory rate limits are per serverless instance.** Configure KV for strict global limits.
