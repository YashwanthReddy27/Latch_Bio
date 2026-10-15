"""Reference analysis pipeline as a library of code cells, plus realistic flawed variants.

Every cell is plain Python source that runs inside the agent sandbox (persistent session,
cwd = task workspace). Cells are tagged with a *milestone* so trajectories can be aligned to
the reference pipeline when computing the "first divergence step".

The same cells are used by:
  * the scripted correct baseline   (all reference cells)
  * the scripted flawed baseline     (fixed set of mistakes)
  * the SIMULATED configs           (mistakes sampled at controlled rates)
  * the answer key builder          (bench.tasks.build runs the reference cells in-process)
"""

from __future__ import annotations

from dataclasses import dataclass, field

MILESTONES = [
    "load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize",
    "lfc", "test", "fdr", "interpret", "submit",
]


@dataclass(frozen=True)
class Cell:
    key: str
    milestone: str
    thought: str
    code: str


@dataclass(frozen=True)
class Mistake:
    """A realistic analysis error. Replaces one reference cell (or appends one)."""
    key: str
    category: str  # failure taxonomy category
    replaces: str  # reference cell key that is swapped out ("" = answer-level mistake)
    description: str
    cell: Cell | None = None
    tasks: tuple[str, ...] = field(default_factory=tuple)  # tasks where it applies


# --------------------------------------------------------------------------------------
# Reference cells
# --------------------------------------------------------------------------------------

LOAD = Cell("load", "load", "Start by loading the count matrix and the sample sheet to see what I am working with.", '''\
import json
import numpy as np
import pandas as pd
counts = pd.read_csv("counts.tsv", sep="\\t")
samples = pd.read_csv("samples.tsv", sep="\\t")
SAMPLES = ["plasmid", "day0", "treat_rep1", "treat_rep2", "ctrl_rep1", "ctrl_rep2"]
ENDPOINTS = ["treat_rep1", "treat_rep2", "ctrl_rep1", "ctrl_rep2"]
print(counts.shape)
print(counts.head())
print(samples.to_string(index=False))
''')

QC_COVERAGE = Cell("qc_coverage", "qc_coverage", "Before any statistics, check library representation: reads per guide, zero-count guides and the Gini index for each sample.", '''\
def gini(x):
    x = np.sort(np.asarray(x, dtype=float))
    n = len(x)
    return float(((2 * np.arange(1, n + 1) - n - 1) * x).sum() / (n * x.sum()))

cov = counts[SAMPLES].sum() / len(counts)
zeros = (counts[SAMPLES] == 0).sum()
ginis = {s: round(gini(counts[s]), 4) for s in SAMPLES}
qc = pd.DataFrame({"reads_per_guide": cov.round(1), "zero_guides": zeros, "gini": pd.Series(ginis)})
print(qc.to_string())
''')

QC_REPLICATES = Cell("qc_replicates", "qc_replicates", "Check replicate agreement: correlate guide-level log fold changes versus day0 across endpoint samples.", '''\
lib = counts[counts["plasmid"] > 0].copy()
lcpm = np.log2(lib[SAMPLES] / lib[SAMPLES].sum() * 1e6 + 1)
lfc_d0 = lcpm[ENDPOINTS].sub(lcpm["day0"], axis=0)
rep_cor = lfc_d0.corr(method="pearson")
print(rep_cor.round(3).to_string())
mean_cor = (rep_cor.sum() - 1) / (len(ENDPOINTS) - 1)
print("mean correlation to other endpoints:")
print(mean_cor.round(3).to_string())
''')

EXCLUDE_BAD = Cell("exclude_bad", "exclude_bad", "treat_rep2 looks problematic. Flag samples below 200x coverage or with poor replicate agreement, and drop them from the comparison.", '''\
bad = [s for s in ENDPOINTS if cov[s] < 200 or mean_cor[s] < 0.6]
TREAT = [s for s in ["treat_rep1", "treat_rep2"] if s not in bad]
CTRL = [s for s in ["ctrl_rep1", "ctrl_rep2"] if s not in bad]
print("excluded:", bad, "| treatment:", TREAT, "| control:", CTRL)
''')

NORMALIZE = Cell("normalize", "normalize", "Samples differ ~2x in depth, so normalize with median-of-ratios size factors before computing fold changes.", '''\
lib = counts[counts["plasmid"] > 0].copy()
USE = ["day0"] + TREAT + CTRL
logc = np.log(lib[USE].where(lib[USE] > 0))
geo = logc.mean(axis=1)
ok = logc.notna().all(axis=1)
size_factors = np.exp(logc[ok].sub(geo[ok], axis=0).median())
norm = lib[USE] / size_factors
print(size_factors.round(3).to_string())
''')

LFC = Cell("lfc", "lfc", "Compute guide-level log2 fold changes of treatment vs vehicle control (pseudocount 0.5), then summarize per gene by the median.", '''\
PC = 0.5
lib["lfc"] = np.log2(norm[TREAT].mean(axis=1) + PC) - np.log2(norm[CTRL].mean(axis=1) + PC)
lib["lfc_ctrl_d0"] = np.log2(norm[CTRL].mean(axis=1) + PC) - np.log2(norm["day0"] + PC)
targeting = lib[lib["gene"] != "NON_TARGETING"]
gene_lfc = targeting.groupby("gene")["lfc"].median()
gene_ess = targeting.groupby("gene")["lfc_ctrl_d0"].median()
print(gene_lfc.describe().round(3).to_string())
''')

TEST = Cell("test", "test", "Score each gene against the non-targeting guide null: z-test on the mean guide LFC, one-sided in each direction.", '''\
from scipy import stats as st
ntc = lib.loc[lib["gene"] == "NON_TARGETING", "lfc"]
mu, sd = ntc.median(), ntc.std()
g = targeting.groupby("gene")["lfc"]
res = pd.DataFrame({"lfc": g.median(), "mean_lfc": g.mean(), "n": g.size()})
res["z"] = (res["mean_lfc"] - mu) / (sd / np.sqrt(res["n"]))
res["p_resist"] = st.norm.sf(res["z"])
res["p_sens"] = st.norm.cdf(res["z"])
ntc0 = lib.loc[lib["gene"] == "NON_TARGETING", "lfc_ctrl_d0"]
g0 = targeting.groupby("gene")["lfc_ctrl_d0"]
z0 = (g0.mean() - ntc0.median()) / (ntc0.std() / np.sqrt(g0.size()))
res["p_ess"] = st.norm.cdf(z0)
print(res.sort_values("z").head(8).round(4).to_string())
''')

FDR = Cell("fdr", "fdr", "~2,000 genes are tested, so control the false discovery rate with Benjamini-Hochberg in each direction.", '''\
res["fdr_resist"] = st.false_discovery_control(res["p_resist"], method="bh")
res["fdr_sens"] = st.false_discovery_control(res["p_sens"], method="bh")
res["fdr_ess"] = st.false_discovery_control(res["p_ess"], method="bh")
print("resistance FDR<0.1:", int((res["fdr_resist"] < 0.1).sum()))
print("sensitizer FDR<0.1:", int((res["fdr_sens"] < 0.1).sum()))
''')

# -- task-specific interpret/submit cells ------------------------------------------------

def submit_cell(thought: str, code: str, milestone: str = "submit") -> Cell:
    return Cell("submit", milestone, thought, code + "\nprint(json.dumps(answer))\n")


T05_GENES = ["MLH1", "BRCA2", "RPL11", "MGMT", "HX0042"]
T10_CANDIDATES_KEY = "t10_candidates"  # filled in by tasks.build (seeded selection)

SUBMIT = {
    "T01": submit_cell("Count guides with zero plasmid reads and guides with zero reads everywhere.", '''\
answer = {
    "zero_in_plasmid": int((counts["plasmid"] == 0).sum()),
    "zero_in_all": int((counts[SAMPLES].sum(axis=1) == 0).sum()),
}'''),
    "T02": submit_cell("Report the Gini index for every sample.", '''\
answer = {"gini": {s: round(ginis[s], 4) for s in SAMPLES}}'''),
    "T03": submit_cell("treat_rep2 has ~110 reads/guide, far more zero-count guides, the highest Gini, and weak correlation to every other endpoint. That pattern means a cell bottleneck with low coverage, not a sample swap.", '''\
worst = min(ENDPOINTS, key=lambda s: mean_cor[s])
issue = "low_coverage_bottleneck" if cov[worst] < 200 and ginis[worst] > max(ginis[s] for s in ENDPOINTS if s != worst) else "sample_swap"
answer = {"sample": worst, "issue": issue}'''),
    "T04": submit_cell("Report reads per guide and flag samples under 200x.", '''\
answer = {
    "reads_per_guide": {s: round(float(cov[s]), 1) for s in SAMPLES},
    "below_200x": [s for s in SAMPLES if cov[s] < 200],
}'''),
    "T05": submit_cell("Report the median guide LFC for the requested genes.", '''\
answer = {"lfc": {g: round(float(gene_lfc[g]), 3) for g in %r}}''' % T05_GENES),
    "T06": submit_cell("Keep the samples with good replicate agreement; exclude the outlier.", '''\
answer = {"keep": sorted(TREAT + CTRL), "exclude": sorted(bad)}'''),
    "T07": submit_cell("Count genes enriched in treatment at BH FDR < 0.1.", '''\
answer = {"n_significant": int((res["fdr_resist"] < 0.1).sum())}'''),
    "T08": submit_cell("Rank by enrichment in treatment vs control (positive z). Those knockouts confer resistance.", '''\
answer = {"genes": res.sort_values("z", ascending=False).index[:15].tolist()}''', "interpret"),
    "T09": submit_cell("Rank by depletion in treatment vs control (negative z). These are sensitizers, not core essentials, which deplete in both arms.", '''\
answer = {"genes": res.sort_values("z", ascending=True).index[:20].tolist()}''', "interpret"),
    "T10": submit_cell("Core essentials deplete versus day0 in the vehicle arm; treatment-specific genes differ between treatment and vehicle. Classify each candidate.", '''\
cands = json.load(open("candidates.json"))["genes"]
def classify(g):
    r = res.loc[g]
    if min(r["fdr_resist"], r["fdr_sens"]) < 0.1:
        return "treatment_specific"
    if r["fdr_ess"] < 0.1 and gene_ess[g] < -1.0:
        return "core_essential"
    return "neither"
labels = {g: classify(g) for g in cands}
answer = {k: sorted([g for g, v in labels.items() if v == k]) for k in ["core_essential", "treatment_specific", "neither"]}''', "interpret"),
    "T11": submit_cell("Test each gene set for over-representation among resistance hits (hypergeometric) and pick the most significant.", '''\
hits = set(res.index[res["fdr_resist"] < 0.1])
universe = set(res.index)
sets = {}
for line in open("pathways.gmt"):
    parts = line.rstrip("\\n").split("\\t")
    sets[parts[0]] = set(parts[2:]) & universe
M, N = len(universe), len(hits)
pvals = {k: st.hypergeom.sf(len(v & hits) - 1, M, len(v), N) for k, v in sets.items()}
for k in sorted(pvals, key=pvals.get)[:5]:
    print(k, len(sets[k] & hits), "/", len(sets[k]), f"p={pvals[k]:.2e}")
answer = {"pathway": min(pvals, key=pvals.get)}''', "interpret"),
    "T12": submit_cell("Final calls: treatment-specific hits at FDR < 0.1 in each direction, excluding core-essential genes whose depletion is not treatment-specific.", '''\
ref_ess = set(open("common_essentials.txt").read().split())
core = set(res.index[(res["fdr_ess"] < 0.1) & (gene_ess < -1.0)]) | ref_ess
answer = {
    "resistance": sorted(res.index[(res["fdr_resist"] < 0.1)].tolist()),
    "sensitizer": sorted(g for g in res.index[(res["fdr_sens"] < 0.1)] if g not in core),
}''', "interpret"),
}

# which reference cells each task needs (in order)
RECIPES: dict[str, list[str]] = {
    "T01": ["load"],
    "T02": ["load", "qc_coverage"],
    "T03": ["load", "qc_coverage", "qc_replicates"],
    "T04": ["load", "qc_coverage"],
    "T05": ["load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize", "lfc"],
    "T06": ["load", "qc_coverage", "qc_replicates", "exclude_bad"],
    "T07": ["load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize", "lfc", "test", "fdr"],
    "T08": ["load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize", "lfc", "test"],
    "T09": ["load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize", "lfc", "test"],
    "T10": ["load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize", "lfc", "test", "fdr"],
    "T11": ["load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize", "lfc", "test", "fdr"],
    "T12": ["load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize", "lfc", "test", "fdr"],
}

REFERENCE_CELLS = {c.key: c for c in [LOAD, QC_COVERAGE, QC_REPLICATES, EXCLUDE_BAD, NORMALIZE, LFC, TEST, FDR]}

# --------------------------------------------------------------------------------------
# Mistake catalog
# --------------------------------------------------------------------------------------

_STATS_TASKS = ("T05", "T07", "T08", "T09", "T10", "T11", "T12")

MISTAKES: dict[str, Mistake] = {m.key: m for m in [
    Mistake(
        "skip_normalization", "statistical_reasoning", "normalize",
        "Fold changes computed on raw counts; ~2x depth difference between arms is never corrected.",
        Cell("normalize", "normalize", "The counts are already comparable, so I'll use them directly.", '''\
lib = counts[counts["plasmid"] > 0].copy()
norm = lib[["day0"] + TREAT + CTRL].astype(float)
print(norm.sum().to_string())
'''), _STATS_TASKS),
    Mistake(
        "keep_bad_replicate", "statistical_reasoning", "exclude_bad",
        "Low-coverage, bottlenecked replicate treat_rep2 kept in the analysis despite failing QC.",
        Cell("exclude_bad", "exclude_bad", "Every replicate has reads, so I'll use all of them for power.", '''\
bad = []
TREAT = ["treat_rep1", "treat_rep2"]
CTRL = ["ctrl_rep1", "ctrl_rep2"]
print("using all replicates:", TREAT, CTRL)
'''), ("T05", "T06", "T07", "T12")),
    Mistake(
        "no_fdr_correction", "statistical_reasoning", "fdr",
        "Raw p-values thresholded at 0.1 across ~2,000 genes; no multiple-testing correction.",
        Cell("fdr", "fdr", "I'll call genes significant at p < 0.1.", '''\
res["fdr_resist"] = res["p_resist"]
res["fdr_sens"] = res["p_sens"]
res["fdr_ess"] = res["p_ess"]
print("resistance p<0.1:", int((res["fdr_resist"] < 0.1).sum()))
'''), ("T07", "T11", "T12")),
    Mistake(
        "flip_direction", "problem_interpretation", "submit",
        "Ranked by depletion when the question asked for knockouts that confer resistance (enrichment), or vice versa.",
        None, ("T08", "T09", "T11")),
    Mistake(
        "compare_to_day0", "problem_interpretation", "lfc",
        "Compared treatment to day0 instead of to the vehicle control, conflating essentiality with drug response.",
        Cell("lfc", "lfc", "Fold change of the treated cells relative to the starting population.", '''\
PC = 0.5
lib["lfc"] = np.log2(norm[TREAT].mean(axis=1) + PC) - np.log2(norm["day0"] + PC)
lib["lfc_ctrl_d0"] = np.log2(norm[CTRL].mean(axis=1) + PC) - np.log2(norm["day0"] + PC)
targeting = lib[lib["gene"] != "NON_TARGETING"]
gene_lfc = targeting.groupby("gene")["lfc"].median()
gene_ess = targeting.groupby("gene")["lfc_ctrl_d0"].median()
print(gene_lfc.describe().round(3).to_string())
'''), ("T05", "T09", "T12")),
    Mistake(
        "essentials_as_hits", "biological_interpretation", "submit",
        "Core-essential genes (depleted in both arms) reported as treatment-specific hits.",
        None, ("T10", "T12")),
    Mistake(
        "pathway_by_overlap", "biological_interpretation", "submit",
        "Picked the gene set with the largest raw overlap with all significant genes instead of testing enrichment.",
        None, ("T11",)),
    Mistake(
        "gini_on_log", "qc_miss", "qc_coverage",
        "Gini index computed on log-transformed counts, which compresses inequality and hides skew.",
        Cell("qc_coverage", "qc_coverage", "Compute coverage metrics; log scale is easier to handle for skewed counts.", '''\
def gini(x):
    x = np.sort(np.asarray(x, dtype=float))
    n = len(x)
    return float(((2 * np.arange(1, n + 1) - n - 1) * x).sum() / (n * x.sum()))

cov = counts[SAMPLES].sum() / len(counts)
zeros = (counts[SAMPLES] == 0).sum()
ginis = {s: round(gini(np.log2(counts[s] + 1)), 4) for s in SAMPLES}
print(pd.DataFrame({"reads_per_guide": cov.round(1), "gini": pd.Series(ginis)}).to_string())
'''), ("T02",)),
    Mistake(
        "per_gene_coverage", "qc_miss", "qc_coverage",
        "Coverage computed per gene instead of per sgRNA (4x inflated), so the under-sequenced sample is not flagged.",
        Cell("qc_coverage", "qc_coverage", "Compute read coverage across the library.", '''\
def gini(x):
    x = np.sort(np.asarray(x, dtype=float))
    n = len(x)
    return float(((2 * np.arange(1, n + 1) - n - 1) * x).sum() / (n * x.sum()))

cov = counts[SAMPLES].sum() / counts["gene"].nunique()
zeros = (counts[SAMPLES] == 0).sum()
ginis = {s: round(gini(counts[s]), 4) for s in SAMPLES}
print(pd.DataFrame({"reads_per_guide": cov.round(1), "gini": pd.Series(ginis)}).to_string())
'''), ("T04",)),
    Mistake(
        "zero_any_sample", "qc_miss", "submit",
        "Counted guides with a zero in ANY sample as 'zero in all samples'.",
        None, ("T01",)),
    Mistake(
        "misread_bad_replicate", "qc_miss", "submit",
        "Never checked coverage/Gini when judging the outlier; called it a sample swap from correlation alone.",
        None, ("T03",)),
    Mistake(
        "execution_error", "execution_error", "",
        "Referenced a non-existent column, never recovered, and ran out of steps without submitting.",
        None, tuple(f"T{i:02d}" for i in range(1, 13))),
    Mistake(
        "clobbered_state", "execution_error", "",
        "A failed exploratory cell overwrote the counts table with a mis-parsed copy; later cells kept failing.",
        None, ()),
    Mistake(
        "format_error", "formatting", "submit",
        "Submitted an answer whose keys or types don't match the required schema.",
        None, tuple(f"T{i:02d}" for i in range(1, 13))),
]}


# what the agent *says* when it makes an answer-level mistake (its reasoning must match its action)
MISTAKE_THOUGHTS = {
    ("flip_direction", "T08"): "Resistance genes should show the strongest effect under drug; rank by the most negative z (strongest depletion).",
    ("flip_direction", "T09"): "Sensitizers are the genes with the largest treatment effect; rank by z, largest first.",
    ("flip_direction", "T11"): "Use the strongest hits in the screen (depleted genes, FDR < 0.1) as the foreground for the enrichment test.",
    ("essentials_as_hits", "T10"): "Any gene that drops out under helixin responds to the treatment, so depleted genes are treatment-specific.",
    ("essentials_as_hits", "T12"): "Genes strongly depleted versus day0 are also killed under treatment, so add them to the sensitizer calls.",
    ("pathway_by_overlap", "T11"): "Pick the gene set that contains the most significant genes.",
    ("zero_any_sample", "T01"): "Count guides with zero plasmid reads, and guides that dropped to zero in the samples.",
    ("misread_bad_replicate", "T03"): "treat_rep2 correlates poorly with every other endpoint, which looks like a mislabelled sample: a sample swap.",
}


def _sub(code: str, old: str, new: str) -> str:
    assert old in code, f"edit anchor not found: {old!r}"
    return code.replace(old, new)


def answer_level_edit(mistake_key: str, task_id: str, code: str) -> str | None:
    """In-place edits of the submit cell, so a flawed agent's code reads like it was written that way
    (rather than computing the right answer and then overwriting it). None = no in-place edit."""
    key = (mistake_key, task_id)
    if key == ("flip_direction", "T08"):
        return _sub(code, 'ascending=False).index[:15]', 'ascending=True).index[:15]')
    if key == ("flip_direction", "T09"):
        return _sub(code, 'ascending=True).index[:20]', 'ascending=False).index[:20]')
    if key == ("flip_direction", "T11"):
        return _sub(code, 'hits = set(res.index[res["fdr_resist"] < 0.1])', 'hits = set(res.index[res["fdr_sens"] < 0.1])')
    if key == ("zero_any_sample", "T01"):
        return _sub(code, '(counts[SAMPLES].sum(axis=1) == 0).sum()', '(counts[SAMPLES] == 0).any(axis=1).sum()')
    if key == ("misread_bad_replicate", "T03"):
        start = code.index("issue = ")
        end = code.index("\n", start)
        return code[:start] + 'issue = "sample_swap"  # poor correlation with every other endpoint' + code[end:]
    if key == ("pathway_by_overlap", "T11"):
        marker = 'sets[parts[0]] = set(parts[2:]) & universe\n'
        head = code[: code.index(marker) + len(marker)]
        return head + (
            'sig = set(res.index[(res["fdr_resist"] < 0.1) | (res["fdr_sens"] < 0.1) | (res["fdr_ess"] < 0.1)])\n'
            'overlap = {k: len(v & sig) for k, v in sets.items()}\n'
            'for k in sorted(overlap, key=overlap.get, reverse=True)[:5]:\n'
            '    print(k, overlap[k], "/", len(sets[k]))\n'
            'answer = {"pathway": max(overlap, key=overlap.get)}\n'
            'print(json.dumps(answer))\n'
        )
    if key == ("essentials_as_hits", "T10"):
        marker = 'cands = json.load(open("candidates.json"))["genes"]\n'
        head = code[: code.index(marker) + len(marker)]
        return head + (
            'def classify(g):\n'
            '    r = res.loc[g]\n'
            '    # depleted under drug (vs day0) or significant vs vehicle -> responds to treatment\n'
            '    if min(r["fdr_resist"], r["fdr_sens"]) < 0.1 or gene_ess[g] < -1.0:\n'
            '        return "treatment_specific"\n'
            '    return "neither"\n'
            'labels = {g: classify(g) for g in cands}\n'
            'answer = {k: sorted([g for g, v in labels.items() if v == k]) for k in ["core_essential", "treatment_specific", "neither"]}\n'
            'print(json.dumps(answer))\n'
        )
    return None


def answer_level_patch(mistake_key: str, task_id: str) -> str | None:
    """Code appended to the submit cell to apply answer-level mistakes."""
    if mistake_key == "flip_direction":
        if task_id == "T08":
            return 'answer = {"genes": res.sort_values("z", ascending=True).index[:15].tolist()}'
        if task_id == "T09":
            return 'answer = {"genes": res.sort_values("z", ascending=False).index[:20].tolist()}'
        if task_id == "T11":
            return ('hits = set(res.index[res["fdr_sens"] < 0.1])\nN = len(hits)\n'
                    'pvals = {k: st.hypergeom.sf(len(v & hits) - 1, M, len(v), N) for k, v in sets.items()}\n'
                    'answer = {"pathway": min(pvals, key=pvals.get)}')
    if mistake_key == "essentials_as_hits":
        if task_id == "T10":
            return ('labels = {g: ("treatment_specific" if (res.loc[g, "fdr_sens"] < 0.1 or res.loc[g, "fdr_resist"] < 0.1 or gene_ess[g] < -1.0) else "neither") for g in cands}\n'
                    'answer = {k: sorted([g for g, v in labels.items() if v == k]) for k in ["core_essential", "treatment_specific", "neither"]}')
        if task_id == "T12":
            return ('answer["sensitizer"] = sorted(set(answer["sensitizer"]) | set(res.index[(res["fdr_ess"] < 0.1) & (gene_ess < -1.0)]))')
    if mistake_key == "pathway_by_overlap":
        return ('sig = set(res.index[(res["fdr_resist"] < 0.1) | (res["fdr_sens"] < 0.1) | (res["fdr_ess"] < 0.1)])\n'
                'answer = {"pathway": max(sets, key=lambda k: len(sets[k] & sig))}')
    if mistake_key == "zero_any_sample":
        return 'answer["zero_in_all"] = int((counts[SAMPLES] == 0).any(axis=1).sum())'
    if mistake_key == "misread_bad_replicate":
        return 'answer = {"sample": worst, "issue": "sample_swap"}'
    if mistake_key == "format_error":
        return {
            "T01": 'answer = {"zero_guides": answer["zero_in_plasmid"]}',
            "T02": 'answer = {"gini": list(answer["gini"].values())}',
            "T03": 'answer = {"bad_sample": answer["sample"]}',
            "T04": 'answer = {"coverage": answer["reads_per_guide"]}',
            "T05": 'answer = {"log2fc": answer["lfc"]}',
            "T06": 'answer = {"keep": ",".join(answer["keep"])}',
            "T07": 'answer = {"n_significant": f"{answer[\'n_significant\']} genes"}',
            "T08": 'answer = {"top_genes": answer["genes"]}',
            "T09": 'answer = {"hits": answer["genes"]}',
            "T10": 'answer = {"labels": answer}',
            "T11": 'answer = {"pathways": [answer["pathway"]]}',
            "T12": 'answer = {"hits": answer["resistance"] + answer["sensitizer"]}',
        }[task_id]
    return None


def build_cells(task_id: str, mistakes: tuple[str, ...] = ()) -> list[Cell]:
    """Reference cells for a task with the given mistakes applied (in pipeline order)."""
    cells: list[Cell] = []
    for key in RECIPES[task_id]:
        cell = REFERENCE_CELLS[key]
        for mk in mistakes:
            m = MISTAKES[mk]
            if m.replaces == key and m.cell is not None and task_id in m.tasks:
                cell = m.cell
        cells.append(cell)
    sub = SUBMIT[task_id]
    code = sub.code
    patches = []
    for mk in mistakes:
        if task_id not in MISTAKES[mk].tasks:
            continue
        edited = answer_level_edit(mk, task_id, code)
        if edited is not None:
            code = edited
        elif (p := answer_level_patch(mk, task_id)):
            patches.append(p)
    if code != sub.code or patches:
        if patches:
            code = code.replace("\nprint(json.dumps(answer))\n", "\n" + "\n".join(patches) + "\nprint(json.dumps(answer))\n")
        thought = next((MISTAKE_THOUGHTS[(mk, task_id)] for mk in mistakes if (mk, task_id) in MISTAKE_THOUGHTS),
                       sub.thought)
        sub = Cell(sub.key, sub.milestone, thought, code)
    cells.append(sub)
    return cells


def run_inprocess(cells: list[Cell], workdir) -> dict:
    """Execute cells in-process with cwd=workdir. Used to build the answer key."""
    import contextlib
    import io
    import os

    ns: dict = {}
    prev = os.getcwd()
    os.chdir(workdir)
    try:
        for c in cells:
            with contextlib.redirect_stdout(io.StringIO()):
                exec(compile(c.code, c.key, "exec"), ns)
    finally:
        os.chdir(prev)
    return ns
