"""Offline agents: scripted baselines and SIMULATED model configs.

Both replay cells from bench.pipeline through the real sandbox, so every stdout, number
and grader verdict in their trajectories is genuinely computed. What is simulated is the
*decision-making* (which mistakes happen, how verbose the agent is) and the token/cost/
latency accounting, which is estimated from text length with a per-config price table.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field

from ..harness import Action, task_message
from ..pipeline import MISTAKES, Cell, build_cells

# ---------------------------------------------------------------------------- flavour cells

EXPLORE_CELLS = [
    Cell("explore", "explore", "Quick look at the count distributions.", '''\
print(counts[SAMPLES].describe().round(1).to_string())
'''),
    Cell("explore", "explore", "How many guides per gene, and how many non-targeting controls?", '''\
print(counts["gene"].value_counts().value_counts().to_string())
print("non-targeting:", int((counts["gene"] == "NON_TARGETING").sum()))
'''),
    Cell("explore", "explore", "Peek at the gene sets.", '''\
for line in open("pathways.gmt").readlines()[:5]:
    parts = line.strip().split("\\t")
    print(parts[0], len(parts) - 2)
'''),
]

PLOT_CELL = Cell("plot", "explore", "Plot the gene-level LFC distribution to sanity-check the hits.", '''\
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(5, 3))
ax.hist(gene_lfc.clip(-4, 4), bins=60, color="#2f6f6a")
ax.set_xlabel("gene log2 fold change (treatment vs control)")
ax.set_ylabel("genes")
ax.set_title("Gene-level LFC")
print("plotted", len(gene_lfc), "genes")
''')

QC_PLOT_CELL = Cell("plot", "explore", "Plot per-sample coverage to make the QC call visible.", '''\
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(5, 3))
ax.bar(range(len(SAMPLES)), [cov[s] for s in SAMPLES], color="#2f6f6a")
ax.axhline(200, color="#b5473a", lw=1, ls="--")
ax.set_xticks(range(len(SAMPLES)), SAMPLES, rotation=30, ha="right")
ax.set_ylabel("reads per sgRNA")
print({s: round(float(cov[s]), 1) for s in SAMPLES})
''')

TRANSIENT_ERRORS = [
    ('Load the counts table.', 'counts = pd.read_csv("counts.tsv")\nprint(counts[["sgRNA", "gene"]].head())',
     "The file is tab-separated; I need sep='\\t'."),
    ('Check the treatment columns.', 'print(counts[["treatment_rep1", "treatment_rep2"]].sum())',
     "The columns are named treat_rep1/treat_rep2, not treatment_*."),
    ('Compute guide totals.', 'print(counts.loc[:, "plasmid":"ctrl_rep2"].sum(axis=1).describe().round(1)\n',
     "Missing parenthesis, fix the syntax."),
]

FATAL_ERRORS = [  # (thought, code) pairs an agent loops on without fixing the root cause
    ("I need a standard error per gene; I'll reuse the column from the results table.",
     'res = pd.DataFrame({"lfc": gene_lfc})\nres["z"] = res["lfc"] / res["se"]\nprint(res.head())'),
    ("Use statsmodels for the BH correction.",
     'from statsmodels.stats.multitest import multipletests\nprint(multipletests([0.01, 0.2], method="fdr_bh"))'),
    ("MAGeCK is the standard tool for this; let me call it directly.",
     'import mageck\nprint(mageck.__version__)'),
    ("Join the results with the sample sheet for annotation.",
     'res = res.merge(samples, on="gene")\nprint(res.shape)'),
]
RETRY_PREFIX = ["That failed. Trying again: ", "Still failing; one more attempt: ", "Let me retry: "]


@dataclass
class Profile:
    """Behavioural + cost profile of an offline config."""
    mistake_rates: dict[str, float] = field(default_factory=dict)
    fixed_mistakes: tuple[str, ...] = ()
    explore_p: float = 0.0
    plot_p: float = 0.0
    transient_error_p: float = 0.0
    skip_intro_p: float = 0.0
    price_in: float = 0.0  # USD per 1M input tokens
    price_out: float = 0.0  # USD per 1M output tokens
    thinking: tuple[int, int] = (0, 0)  # range of thinking tokens per step
    verbosity: float = 1.0
    tok_per_s: float = 120.0
    ttft_s: float = 0.6


class ScriptedAgent:
    """Replays the reference pipeline (plus profile-driven deviations) through the sandbox."""

    def __init__(self, config: dict, profile: Profile):
        self.config = config
        self.profile = profile
        self.injected: dict | None = None

    # -- planning ---------------------------------------------------------------------
    def start(self, task: dict, run_idx: int) -> None:
        p = self.profile
        rng = random.Random(f"{self.config['id']}|{task['id']}|{run_idx}")
        tid = task["id"]
        mistakes = [m for m in p.fixed_mistakes if tid in MISTAKES[m].tasks]
        for key, rate in p.mistake_rates.items():
            if tid in MISTAKES[key].tasks and key not in mistakes and rng.random() < rate:
                mistakes.append(key)
        # one fatal-error or format-error at most, and they dominate
        if "execution_error" in mistakes:
            mistakes = ["execution_error"]
        cells = build_cells(tid, tuple(m for m in mistakes if m != "execution_error"))

        # a sloppy agent that keeps a bad replicate also tends to skip the replicate QC cell
        if "keep_bad_replicate" in mistakes and tid not in ("T03", "T06"):
            cells = [c for c in cells if c.key != "qc_replicates"]

        plan: list[tuple[str, str, dict, str]] = []  # (thought, tool, args, tag)
        if rng.random() >= p.skip_intro_p:
            plan.append(("Start by seeing what files I have.", "list_files", {}, "intro"))
            plan.append(("Read the design document before touching the data.", "read_file",
                         {"path": "design.md", "max_bytes": 4000}, "intro"))
        transient_used = False
        for idx, c in enumerate(cells):
            if c.key == "submit":
                break
            if not transient_used and rng.random() < p.transient_error_p:
                t, code, fix = rng.choice(TRANSIENT_ERRORS)
                if code.startswith("counts = ") and c.key != "load":
                    mistakes.append("clobbered_state")  # realistic: the typo cell overwrote state
                plan.append((t, "run_python", {"code": code}, "transient_error"))
                plan.append((fix + " " + c.thought, "run_python", {"code": c.code}, c.key))
                transient_used = True
            else:
                plan.append((c.thought, "run_python", {"code": c.code}, c.key))
            if c.key == "load" and rng.random() < p.explore_p:
                e = rng.choice(EXPLORE_CELLS)
                plan.append((e.thought, "run_python", {"code": e.code}, "explore"))
            if c.key == "qc_coverage" and rng.random() < p.plot_p / 2:
                plan.append((QC_PLOT_CELL.thought, "run_python", {"code": QC_PLOT_CELL.code}, "plot"))
            if c.key == "lfc" and rng.random() < p.plot_p:
                plan.append((PLOT_CELL.thought, "run_python", {"code": PLOT_CELL.code}, "plot"))
        submit = cells[-1]
        if "execution_error" in mistakes:
            # break somewhere after loading and never recover
            keep = max(1, rng.randint(1, max(1, len(plan) - 1)))
            plan = plan[:keep]
            for k in range(25):
                thought, code = FATAL_ERRORS[rng.randrange(len(FATAL_ERRORS))]
                prefix = "" if k == 0 else rng.choice(RETRY_PREFIX)
                plan.append((prefix + thought[0].lower() + thought[1:] if prefix else thought,
                             "run_python", {"code": code}, "fatal_error"))
        else:
            plan.append((submit.thought, "run_python", {"code": submit.code}, "submit_cell"))
        self.plan = plan
        self.cursor = 0
        self.history_chars = len(task_message(task)) + 1200  # system prompt + tool schemas
        self.rng = rng
        self.injected = {  # ground truth for validating the rule labeler / judge

            "mistakes": mistakes,
            "categories": sorted({MISTAKES[m].category for m in mistakes}),
            "descriptions": [MISTAKES[m].description for m in mistakes],
        } if mistakes else {"mistakes": [], "categories": [], "descriptions": []}

    # -- acting -----------------------------------------------------------------------
    def _account(self, a: Action) -> Action:
        p = self.profile
        if p.price_in == 0 and p.price_out == 0:
            return a  # scripted baselines are not LLMs: no tokens, no cost
        out_chars = len(a.thought) + len(json.dumps(a.args))
        a.tokens_out = int(out_chars / 3.6 * p.verbosity) + 12
        a.tokens_thinking = self.rng.randint(*p.thinking) if p.thinking[1] else 0
        a.tokens_in = int(self.history_chars / 3.8)
        a.cost_usd = (a.tokens_in * p.price_in + (a.tokens_out + a.tokens_thinking) * p.price_out) / 1e6
        a.latency_s = p.ttft_s + (a.tokens_out + a.tokens_thinking) / p.tok_per_s
        self.history_chars += out_chars
        return a

    def act(self, observation: dict | None) -> Action | None:
        if observation is not None:
            self.history_chars += min(len(json.dumps(observation)), 7000)
        if self.cursor < len(self.plan):
            thought, tool, args, tag = self.plan[self.cursor]
            self.cursor += 1
            return self._account(Action(tool=tool, args=args, thought=thought, meta={"tag": tag}))
        # plan exhausted: submit whatever the last cell printed
        if self.cursor == len(self.plan):
            self.cursor += 1
            out = (observation or {}).get("output", {})
            if out.get("error"):
                return None
            last = (out.get("stdout") or "").strip().splitlines()
            if not last:
                return None
            return self._account(Action(tool="submit_answer", args={"answer_json": last[-1]},
                                        thought="Submitting the answer.", meta={"tag": "submit"}))
        return None
