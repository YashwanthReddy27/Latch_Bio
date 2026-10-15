"""Build the 12 CRISPRScreenBench-mini task specs (bench/bench/tasks/T01..T12.json).

Numeric expected values come from running the reference pipeline on the generated data;
hit-recovery checks are graded against the PLANTED truth, with thresholds the reference
pipeline clears with margin. Run after `python -m bench.datagen`:

    python -m bench.tasks.build
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import numpy as np

from .. import DATA_DIR, SCREEN_DIR, TASKS_DIR
from ..graders import grade
from ..pipeline import T05_GENES, build_cells, run_inprocess

BASE_INPUTS = ["counts.tsv", "samples.tsv", "pathways.gmt", "common_essentials.txt", "design.md"]
TASK_FILES_DIR = DATA_DIR / "task_files"
SAMPLES = ["plasmid", "day0", "treat_rep1", "treat_rep2", "ctrl_rep1", "ctrl_rep2"]

CONTEXT = (
    "You are analyzing a pooled CRISPR knockout screen. The workspace contains raw sgRNA read "
    "counts (counts.tsv), a sample sheet, gene sets and a short design document (design.md). "
    "Read design.md first."
)


def _t10_candidates(truth: dict, seed: int) -> dict[str, str]:
    rng = np.random.default_rng(seed + 10)
    eff = truth["gene_effects"]
    strong_ess = sorted(g for g in truth["core_essential"] if eff[g]["essential_lfc"] < -2.6)
    res = sorted(g for g in truth["resistance_hits"] if eff[g]["treatment_lfc"] > 2.0)
    sens = sorted(g for g in truth["sensitizer_hits"] if eff[g]["treatment_lfc"] < -2.0)
    hit_or_ess = set(truth["core_essential"]) | set(truth["resistance_hits"]) | set(truth["sensitizer_hits"])
    neutral_pool = sorted(g for g in [f"HX{i:04d}" for i in range(1, 1800)]
                          if g not in hit_or_ess and g not in truth["mild_fitness"] and g not in eff)
    picks = {}
    for g in rng.choice(strong_ess, 10, replace=False):
        picks[str(g)] = "core_essential"
    for g in list(rng.choice(res, 5, replace=False)) + list(rng.choice(sens, 5, replace=False)):
        picks[str(g)] = "treatment_specific"
    for g in rng.choice(neutral_pool, 7, replace=False):
        picks[str(g)] = "neither"
    for g in rng.choice(truth["mild_fitness"], 3, replace=False):
        picks[str(g)] = "neither"
    order = list(rng.permutation(sorted(picks)))
    return {str(g): picks[str(g)] for g in order}


def task_specs(truth: dict, ref: dict[str, dict], t10: dict[str, str]) -> list[dict]:
    R, S, E = truth["resistance_hits"], truth["sensitizer_hits"], truth["core_essential"]
    a = {t: ref[t] for t in ref}
    specs = [
        {
            "id": "T01", "title": "Zero-count guides", "category": "qc", "difficulty": "easy",
            "prompt": "How many sgRNAs have zero reads in the plasmid sample, and how many sgRNAs have zero reads in every sample?",
            "answer_schema": {"type": "object", "required": ["zero_in_plasmid", "zero_in_all"],
                              "properties": {"zero_in_plasmid": {"type": "integer"}, "zero_in_all": {"type": "integer"}}},
            "grader": {"checks": [
                {"id": "zero_in_plasmid", "kind": "exact", "path": "zero_in_plasmid", "value": a["T01"]["zero_in_plasmid"], "label": "Zero in plasmid"},
                {"id": "zero_in_all", "kind": "exact", "path": "zero_in_all", "value": a["T01"]["zero_in_all"], "label": "Zero in all samples"},
            ]},
            "grader_plain": "Both counts must match exactly. 'Zero in every sample' means the row sum across all six samples is 0, not a zero in any one sample.",
            "traps": ["'every sample' vs 'any sample'"],
            "milestones": ["load", "submit"],
        },
        {
            "id": "T02", "title": "Gini index per sample", "category": "qc", "difficulty": "easy",
            "prompt": "Compute the Gini index of sgRNA read counts for each of the six samples (use raw counts of all sgRNAs, including zero-count guides).",
            "answer_schema": {"type": "object", "required": ["gini"],
                              "properties": {"gini": {"type": "object", "additionalProperties": {"type": "number"}}}},
            "grader": {"checks": [
                {"id": "gini", "kind": "numeric_map", "path": "gini", "values": a["T02"]["gini"], "abs_tol": 0.02, "label": "Gini per sample"},
            ]},
            "grader_plain": "All six Gini indices must be within ±0.02 of the reference computed on raw counts. Computing it on log counts gives values near 0.05 and fails.",
            "traps": ["Gini on log-transformed counts"],
            "milestones": ["load", "qc_coverage", "submit"],
        },
        {
            "id": "T03", "title": "Identify the failed replicate", "category": "qc", "difficulty": "medium",
            "prompt": ("One sample in this screen has a technical problem. Identify the sample and classify the problem as one of: "
                       "low_coverage_bottleneck, sample_swap, plasmid_library_skew, contamination."),
            "answer_schema": {"type": "object", "required": ["sample", "issue"],
                              "properties": {"sample": {"type": "string"}, "issue": {"type": "string"}}},
            "grader": {"checks": [
                {"id": "sample", "kind": "exact", "path": "sample", "value": truth["bad_sample"], "label": "Sample"},
                {"id": "issue", "kind": "exact", "path": "issue", "value": truth["bad_sample_issue"], "label": "Issue"},
            ]},
            "grader_plain": "Exact match on both the sample (treat_rep2) and the issue category. The evidence for a bottleneck is low reads per guide, excess dropouts and a high Gini index, not just low correlation.",
            "traps": ["Calling a bottleneck a sample swap from correlation alone"],
            "milestones": ["load", "qc_coverage", "qc_replicates", "submit"],
        },
        {
            "id": "T04", "title": "Library representation", "category": "qc", "difficulty": "easy",
            "prompt": "Report the mean number of reads per sgRNA for each sample, and list the samples that fall below the 200x per-sgRNA coverage target.",
            "answer_schema": {"type": "object", "required": ["reads_per_guide", "below_200x"],
                              "properties": {"reads_per_guide": {"type": "object", "additionalProperties": {"type": "number"}},
                                             "below_200x": {"type": "array", "items": {"type": "string"}}}},
            "grader": {"checks": [
                {"id": "reads_per_guide", "kind": "numeric_map", "path": "reads_per_guide",
                 "values": a["T04"]["reads_per_guide"], "abs_tol": 10.0, "label": "Reads per sgRNA"},
                {"id": "below_200x", "kind": "set_equal", "path": "below_200x", "values": a["T04"]["below_200x"], "label": "Samples below 200x"},
            ]},
            "grader_plain": "Reads per sgRNA within ±10 of the reference for every sample, and the set of under-covered samples must match exactly (treat_rep2). Dividing by number of genes instead of sgRNAs inflates coverage 4x.",
            "traps": ["Per-gene vs per-sgRNA coverage"],
            "milestones": ["load", "qc_coverage", "submit"],
        },
        {
            "id": "T05", "title": "Normalized gene-level fold changes", "category": "statistical_reasoning", "difficulty": "medium",
            "prompt": (f"For the genes {', '.join(T05_GENES)}, report the gene-level log2 fold change of helixin treatment versus vehicle control. "
                       "Use only samples that pass QC, account for differences in sequencing depth, compute sgRNA-level log2 fold changes, "
                       "and summarize each gene by the median of its sgRNAs."),
            "answer_schema": {"type": "object", "required": ["lfc"],
                              "properties": {"lfc": {"type": "object", "additionalProperties": {"type": "number"}}}},
            "grader": {"checks": [
                {"id": "lfc", "kind": "numeric_map", "path": "lfc", "values": a["T05"]["lfc"], "abs_tol": 0.2, "label": "Gene LFCs"},
            ]},
            "grader_plain": "Each gene's LFC within ±0.2 of the reference. Total-count, CPM, median-of-ratios or non-targeting normalization with pseudocount 0.5–1 all land within 0.05; skipping normalization shifts values by ~+1, and keeping the bottlenecked replicate or comparing to day0 moves at least one gene out of tolerance.",
            "traps": ["2x depth difference between arms", "bottlenecked replicate", "comparing against day0 instead of vehicle"],
            "milestones": ["load", "qc_coverage", "exclude_bad", "normalize", "lfc", "submit"],
        },
        {
            "id": "T06", "title": "Replicate handling", "category": "statistical_reasoning", "difficulty": "medium",
            "prompt": ("Assess agreement between the four endpoint samples (treat_rep1, treat_rep2, ctrl_rep1, ctrl_rep2) and decide which to keep "
                       "for the treatment-vs-control comparison. Report the samples to keep and the samples to exclude."),
            "answer_schema": {"type": "object", "required": ["keep", "exclude"],
                              "properties": {"keep": {"type": "array", "items": {"type": "string"}},
                                             "exclude": {"type": "array", "items": {"type": "string"}}}},
            "grader": {"checks": [
                {"id": "keep", "kind": "set_equal", "path": "keep", "values": a["T06"]["keep"], "label": "Keep"},
                {"id": "exclude", "kind": "set_equal", "path": "exclude", "values": a["T06"]["exclude"], "label": "Exclude"},
            ]},
            "grader_plain": "Both sets must match exactly: keep treat_rep1, ctrl_rep1, ctrl_rep2; exclude treat_rep2.",
            "traps": ["Keeping every replicate 'for power'"],
            "milestones": ["load", "qc_coverage", "qc_replicates", "exclude_bad", "submit"],
        },
        {
            "id": "T07", "title": "FDR-controlled hit count", "category": "statistical_reasoning", "difficulty": "hard",
            "prompt": ("How many genes are significantly ENRICHED in helixin treatment relative to vehicle control at a false discovery rate below 10%? "
                       "Test at the gene level using all sgRNAs for each gene."),
            "answer_schema": {"type": "object", "required": ["n_significant"],
                              "properties": {"n_significant": {"type": "integer"}}},
            "grader": {"checks": [
                {"id": "n_significant", "kind": "range", "path": "n_significant", "min": 8, "max": 24, "label": "Significant genes"},
            ]},
            "grader_plain": f"Count must fall in [8, 24] (reference: {a['T07']['n_significant']}; 12 resistance genes are planted). The range admits different sound tests (z vs non-targeting null, t-test, rank-based) but excludes uncorrected p < 0.1, which yields ~200.",
            "traps": ["No multiple-testing correction"],
            "milestones": ["load", "qc_coverage", "exclude_bad", "normalize", "lfc", "test", "fdr", "submit"],
        },
        {
            "id": "T08", "title": "Resistance genes", "category": "problem_interpretation", "difficulty": "medium",
            "prompt": "Rank genes whose knockout confers RESISTANCE to helixin. Return the top 15 genes, most confident first.",
            "answer_schema": {"type": "object", "required": ["genes"],
                              "properties": {"genes": {"type": "array", "items": {"type": "string"}}}},
            "grader": {"checks": [
                {"id": "recovery", "kind": "set_overlap", "path": "genes", "truth": R, "min_recall": 0.75, "min_precision": 0.6, "max_items": 15, "label": "Planted resistance genes"},
            ]},
            "grader_plain": "At most 15 genes; at least 9 of the 12 planted resistance genes (recall ≥ 0.75) and precision ≥ 0.6. Resistance = ENRICHED in treatment vs vehicle; ranking by depletion returns the sensitizers and scores 0.",
            "traps": ["Direction of selection (enriched vs depleted)"],
            "milestones": ["load", "qc_coverage", "exclude_bad", "normalize", "lfc", "test", "interpret", "submit"],
        },
        {
            "id": "T09", "title": "Sensitizer genes", "category": "problem_interpretation", "difficulty": "medium",
            "prompt": "Identify genes whose knockout SENSITIZES cells to helixin. Return the top 20 genes, most confident first.",
            "answer_schema": {"type": "object", "required": ["genes"],
                              "properties": {"genes": {"type": "array", "items": {"type": "string"}}}},
            "grader": {"checks": [
                {"id": "recovery", "kind": "set_overlap", "path": "genes", "truth": S, "min_recall": 0.6, "min_precision": 0.5, "max_items": 20, "label": "Planted sensitizer genes"},
                {"id": "no_essentials", "kind": "max_overlap", "path": "genes", "forbidden": E, "max_count": 4, "label": "Core essentials in list"},
            ]},
            "grader_plain": "At most 20 genes; recall ≥ 0.6 and precision ≥ 0.5 against the 18 planted sensitizers, and no more than 4 core-essential genes. Comparing treatment to day0 instead of to vehicle fills the list with ribosome/proteasome genes.",
            "traps": ["Baseline choice: vehicle control, not day0", "Direction of selection"],
            "milestones": ["load", "qc_coverage", "exclude_bad", "normalize", "lfc", "test", "interpret", "submit"],
        },
        {
            "id": "T10", "title": "Core-essential vs treatment-specific", "category": "biological_interpretation", "difficulty": "hard",
            "prompt": ("candidates.json lists 30 genes. Classify each as core_essential (fitness gene required regardless of drug), "
                       "treatment_specific (knockout changes the response to helixin, either direction), or neither."),
            "extra_inputs": ["candidates.json"],
            "answer_schema": {"type": "object", "required": ["core_essential", "treatment_specific", "neither"],
                              "properties": {"core_essential": {"type": "array", "items": {"type": "string"}},
                                             "treatment_specific": {"type": "array", "items": {"type": "string"}},
                                             "neither": {"type": "array", "items": {"type": "string"}}}},
            "grader": {"checks": [
                {"id": "classification", "kind": "classification", "path": "", "truth": t10, "min_accuracy": 0.85, "label": "Classification accuracy"},
            ]},
            "grader_plain": "At least 26 of 30 genes in the planted class. Essential genes deplete in BOTH arms relative to day0, so depletion in the treated arm alone is not evidence of a drug interaction.",
            "traps": ["Essential genes look like sensitizers if compared to day0"],
            "milestones": ["load", "qc_coverage", "exclude_bad", "normalize", "lfc", "test", "fdr", "interpret", "submit"],
        },
        {
            "id": "T11", "title": "Pathway enrichment of resistance hits", "category": "biological_interpretation", "difficulty": "medium",
            "prompt": ("Which gene set in pathways.gmt is most significantly over-represented among genes whose knockout confers resistance "
                       "to helixin (FDR < 0.1)? Report the gene set name exactly as written in the GMT file."),
            "answer_schema": {"type": "object", "required": ["pathway"], "properties": {"pathway": {"type": "string"}}},
            "grader": {"checks": [
                {"id": "pathway", "kind": "exact", "path": "pathway", "value": truth["enriched_pathway_resistance"], "label": "Gene set"},
            ]},
            "grader_plain": "Exact match: MISMATCH_REPAIR. Using sensitizers instead gives HOMOLOGOUS_RECOMBINATION; picking the set with the largest raw overlap with all significant genes gives RIBOSOME.",
            "traps": ["Direction", "Raw overlap instead of an enrichment test"],
            "milestones": ["load", "qc_coverage", "exclude_bad", "normalize", "lfc", "test", "fdr", "interpret", "submit"],
        },
        {
            "id": "T12", "title": "End-to-end hit calling", "category": "biological_interpretation", "difficulty": "hard",
            "prompt": ("Produce final hit calls for this screen: genes whose knockout confers resistance and genes whose knockout sensitizes "
                       "to helixin, each at FDR < 0.1. Exclude samples that fail QC and do not report core-essential genes whose depletion "
                       "is not specific to the drug."),
            "answer_schema": {"type": "object", "required": ["resistance", "sensitizer"],
                              "properties": {"resistance": {"type": "array", "items": {"type": "string"}},
                                             "sensitizer": {"type": "array", "items": {"type": "string"}}}},
            "grader": {"checks": [
                {"id": "resistance", "kind": "f1", "path": "resistance", "truth": R, "min_f1": 0.6, "label": "Resistance F1"},
                {"id": "sensitizer", "kind": "f1", "path": "sensitizer", "truth": S, "min_f1": 0.6, "label": "Sensitizer F1"},
                {"id": "no_essentials", "kind": "max_overlap", "path": "sensitizer", "forbidden": E, "max_count": 3, "label": "Core essentials in sensitizers"},
            ]},
            "grader_plain": "F1 ≥ 0.6 against planted hits in each direction, and at most 3 core-essential genes in the sensitizer list.",
            "traps": ["No multiple-testing correction", "Essential genes reported as sensitizers", "Comparing to day0"],
            "milestones": ["load", "qc_coverage", "exclude_bad", "normalize", "lfc", "test", "fdr", "interpret", "submit"],
        },
    ]
    for s in specs:
        s["context"] = CONTEXT
        s["inputs"] = BASE_INPUTS + s.pop("extra_inputs", [])
        s["reference_answer"] = ref[s["id"]]
    # ground truth shown in the task browser
    gt = {
        "T01": {"failed_synthesis_guides": len(truth["failed_synthesis_guides"])},
        "T03": {"bad_sample": truth["bad_sample"], "issue": truth["bad_sample_issue"]},
        "T08": {"planted_resistance": R},
        "T09": {"planted_sensitizer": S},
        "T10": {"labels": t10},
        "T11": {"planted_pathway": truth["enriched_pathway_resistance"]},
        "T12": {"planted_resistance": R, "planted_sensitizer": S},
    }
    for s in specs:
        s["ground_truth"] = gt.get(s["id"], {})
    return specs


def make_workspace(task: dict, dest: Path) -> Path:
    """Copy a task's input files into a fresh workspace directory."""
    dest.mkdir(parents=True, exist_ok=True)
    for name in task["inputs"]:
        src = SCREEN_DIR / name
        if not src.exists():
            src = TASK_FILES_DIR / task["id"] / name
        shutil.copy(src, dest / name)
    return dest


def load_tasks() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text()) for p in sorted(TASKS_DIR.glob("T*.json"))}


def main() -> None:
    truth = json.loads((DATA_DIR / "truth.json").read_text())
    t10 = _t10_candidates(truth, truth["seed"])
    (TASK_FILES_DIR / "T10").mkdir(parents=True, exist_ok=True)
    (TASK_FILES_DIR / "T10" / "candidates.json").write_text(json.dumps({"genes": list(t10)}, indent=1))

    ref: dict[str, dict] = {}
    with tempfile.TemporaryDirectory() as tmp:
        wd = Path(tmp)
        for name in BASE_INPUTS:
            shutil.copy(SCREEN_DIR / name, wd / name)
        shutil.copy(TASK_FILES_DIR / "T10" / "candidates.json", wd / "candidates.json")
        for i in range(1, 13):
            tid = f"T{i:02d}"
            ref[tid] = run_inprocess(build_cells(tid), wd)["answer"]

    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    for spec in task_specs(truth, ref, t10):
        result = grade(spec, spec["reference_answer"])
        assert result["passed"], f"reference answer fails its own grader: {spec['id']} {result}"
        (TASKS_DIR / f"{spec['id']}.json").write_text(json.dumps(spec, indent=1))
        print(spec["id"], "ok", spec["title"])


if __name__ == "__main__":
    main()
