"""Rule-based failure labeling from trajectory evidence.

Each rule inspects the code the agent ran, the outputs it saw and the answer it submitted,
and emits a *signal* with the steps (and code lines) that triggered it. The failure
category of a failed trajectory is the highest-priority active signal. Signals on PASSING
trajectories are kept as "latent issues" (the agent got lucky or the mistake was harmless).

First divergence step = the earliest step where the trajectory departs from the reference
pipeline: a flawed cell, a milestone performed before its prerequisite (e.g. fold changes
before normalization), the first step of an unrecovered error streak, or — if nothing
else — the submit step.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

CATEGORIES = [
    "problem_interpretation", "statistical_reasoning", "biological_interpretation",
    "qc_miss", "execution_error", "formatting",
]
PRIORITY = ["execution_error", "formatting", "problem_interpretation", "qc_miss",
            "statistical_reasoning", "biological_interpretation"]

MILESTONE_PATTERNS = {
    "load": r"read_csv\(\s*['\"]counts\.tsv",
    "qc_coverage": r"gini|reads_per_guide|/\s*len\(counts\)|==\s*0\)\.sum\(|nunique\(\)",
    "qc_replicates": r"\.corr\(|pearsonr|spearmanr|corrcoef",
    "exclude_bad": r"\bexclud|\bbad\s*=|\.drop\(|not in bad",
    "normalize": r"size_factor|median.of.ratio|\bcpm\b|1e6|normaliz|/\s*\w+\[[^\]]+\]\.sum\(\)",
    "lfc": r"log2\(.*\)\s*-\s*np\.log2\(|\blfc\b|fold.?change",
    "test": r"norm\.sf|norm\.cdf|ttest|mannwhitney|ranksums|\bz\s*=|\[\"z\"\]|p_value|pval|p_resist|p_sens",
    "fdr": r"false_discovery_control|multipletests|benjamini|fdr_bh|method=\"bh\"",
    "interpret": r"sort_values|hypergeom|classif|nlargest|nsmallest",
}
PREREQ = {"lfc": ["normalize"], "test": ["lfc"], "fdr": ["test"]}
NEEDS = {  # milestones a sound solution must contain, by task
    "T05": ["normalize", "lfc"], "T07": ["normalize", "lfc", "test", "fdr"],
    "T08": ["lfc", "test"], "T09": ["lfc", "test"],
    "T10": ["lfc", "test", "fdr"], "T11": ["lfc", "test", "fdr"], "T12": ["lfc", "test", "fdr"],
}


@dataclass
class Signal:
    id: str
    category: str
    message: str
    evidence: list[dict] = field(default_factory=list)  # [{"step": i, "lines": [1-based line numbers]}]

    def as_dict(self) -> dict:
        return {"id": self.id, "category": self.category, "message": self.message, "evidence": self.evidence}


def _code(step: dict) -> str:
    return str(step.get("args", {}).get("code", "")) if step.get("tool") == "run_python" else ""


def _match_lines(code: str, pattern: str) -> list[int]:
    rx = re.compile(pattern, re.IGNORECASE)
    return [i + 1 for i, line in enumerate(code.splitlines()) if rx.search(line)]


def detect_milestones(step: dict) -> list[str]:
    if step.get("tool") == "read_file" and "design" in str(step.get("args", {}).get("path", "")):
        return ["read_design"]
    if step.get("tool") == "submit_answer":
        return ["submit"]
    code = _code(step)
    if not code or (step.get("output") or {}).get("error"):
        return []
    return [m for m, pat in MILESTONE_PATTERNS.items() if re.search(pat, code, re.IGNORECASE)]


def _steps_matching(steps: list[dict], pattern: str, ok_only: bool = True) -> list[dict]:
    ev = []
    for s in steps:
        code = _code(s)
        if not code or (ok_only and (s.get("output") or {}).get("error")):
            continue
        lines = _match_lines(code, pattern)
        if lines:
            ev.append({"step": s["i"], "lines": lines})
    return ev


def _gene_set(x) -> set[str]:
    return {str(g).strip().upper() for g in x} if isinstance(x, list) else set()


def label(traj: dict, task: dict, truth: dict) -> dict:
    steps = traj["steps"]
    tid = task["id"]
    ans = traj.get("answer") if isinstance(traj.get("answer"), dict) else {}
    grade = traj["grade"]
    submit_step = next((s["i"] for s in steps if s["tool"] == "submit_answer"), None)
    last_step = steps[-1]["i"] if steps else 0
    R, S, E = (_gene_set(truth["resistance_hits"]), _gene_set(truth["sensitizer_hits"]),
               _gene_set(truth["core_essential"]))
    sig: list[Signal] = []

    # -- execution ----------------------------------------------------------------------
    if traj["status"] != "submitted":
        errs = [s for s in steps if (s.get("output") or {}).get("error")]
        streak_start = None
        for s in reversed(steps):
            if (s.get("output") or {}).get("error"):
                streak_start = s["i"]
            else:
                break
        ev = [{"step": s["i"], "lines": []} for s in errs[-6:]]
        msg = {"max_steps": f"Hit the {len(steps)}-step limit without submitting",
               "no_submission": "Stopped without submitting an answer",
               "agent_error": "Agent/API error ended the run"}.get(traj["status"], traj["status"])
        if errs:
            msg += f"; {len(errs)} tool calls raised errors (last: {str(errs[-1]['output']['error']).strip().splitlines()[-1][:120]})"
        s0 = Signal("unrecovered_error", "execution_error", msg, ev)
        s0.first = streak_start if streak_start is not None else last_step  # type: ignore[attr-defined]
        sig.append(s0)

    # -- formatting ---------------------------------------------------------------------
    if grade.get("error_kind") == "schema":
        s1 = Signal("schema_mismatch", "formatting", f"Answer rejected by schema check ({grade['error']})",
                    [{"step": submit_step, "lines": []}] if submit_step is not None else [])
        sig.append(s1)

    # -- problem interpretation -----------------------------------------------------------
    if tid in ("T08", "T09", "T12"):
        lists = {"T08": [("genes", R, S)], "T09": [("genes", S, R)],
                 "T12": [("resistance", R, S), ("sensitizer", S, R)]}[tid]
        for key, want, opposite in lists:
            got = _gene_set(ans.get(key))
            if got and len(got & opposite) > len(got & want):
                ev = _steps_matching(steps, r"sort_values\(.*ascending|nlargest|nsmallest|p_sens|p_resist")
                sig.append(Signal("direction_flip", "problem_interpretation",
                                  f"'{key}' contains {len(got & opposite)} genes from the opposite direction vs "
                                  f"{len(got & want)} from the requested one (enriched vs depleted confused)",
                                  ev[-1:] + ([{"step": submit_step, "lines": []}] if submit_step is not None else [])))
                break
    if tid == "T11" and ans.get("pathway") and str(ans["pathway"]).upper() in (
            "HOMOLOGOUS_RECOMBINATION", "FANCONI_ANEMIA", "TRANSLESION_SYNTHESIS"):
        ev = _steps_matching(steps, r"fdr_sens|p_sens|ascending=True")
        sig.append(Signal("direction_flip", "problem_interpretation",
                          f"Reported {ans['pathway']}, the pathway enriched among SENSITIZERS, for a resistance question",
                          ev[-1:] + ([{"step": submit_step, "lines": []}] if submit_step is not None else [])))

    vs_day0 = _steps_matching(steps, r"(TREAT|treat).*log2.*day0|log2.*(TREAT|treat)[^\n]*-[^\n]*day0")
    vs_day0 = [e for e in vs_day0 if not re.search(r"ctrl|CTRL", _code(steps[e["step"]]).splitlines()[e["lines"][0] - 1])]
    if vs_day0 and tid in ("T05", "T07", "T08", "T09", "T10", "T11", "T12"):
        sig.append(Signal("wrong_baseline", "problem_interpretation",
                          "Fold change computed as treatment vs day0, not treatment vs vehicle control: "
                          "essential-gene depletion is mistaken for drug response", vs_day0[:1]))

    # -- QC ---------------------------------------------------------------------------------
    if tid == "T02":
        ev = _steps_matching(steps, r"gini\(.*log")
        if ev:
            sig.append(Signal("gini_on_log", "qc_miss", "Gini index computed on log counts, compressing inequality", ev))
    if tid == "T04":
        ev = _steps_matching(steps, r"nunique\(\)")
        if ev:
            sig.append(Signal("per_gene_coverage", "qc_miss", "Coverage divided by number of genes, not sgRNAs (4x inflated)", ev))
    if tid == "T01":
        ev = _steps_matching(steps, r"\.any\(axis=1\)")
        if ev:
            sig.append(Signal("zero_any", "qc_miss", "Counted zero in ANY sample as zero in ALL samples", ev))
    if tid == "T03" and ans.get("issue") and str(ans["issue"]).lower() != truth["bad_sample_issue"]:
        sig.append(Signal("misread_qc", "qc_miss",
                          f"Called the failure '{ans['issue']}' although coverage/Gini/dropouts point to a bottleneck",
                          [{"step": submit_step, "lines": []}] if submit_step is not None else []))
    if tid == "T03" and ans.get("sample") and str(ans["sample"]).lower() != truth["bad_sample"]:
        sig.append(Signal("wrong_sample", "qc_miss", f"Flagged {ans['sample']} instead of {truth['bad_sample']}",
                          [{"step": submit_step, "lines": []}] if submit_step is not None else []))

    milestones_by_step = {s["i"]: detect_milestones(s) for s in steps}
    done = {m for ms in milestones_by_step.values() for m in ms}
    never_rep_qc = "qc_replicates" not in done

    # -- statistical reasoning -----------------------------------------------------------------
    kept = [e for e in _steps_matching(steps, r"TREAT\s*=\s*\[[^\]]*treat_rep2")
            if not re.search(r"\bif\b|not in", _code(steps[e["step"]]).splitlines()[e["lines"][0] - 1])]
    if tid == "T06":
        keep = _gene_set(ans.get("keep"))
        if "TREAT_REP2" in keep:
            sig.append(Signal("kept_bad_replicate", "statistical_reasoning",
                              "Kept treat_rep2 (110 reads/sgRNA, Gini 0.40, r≈0.45 with other endpoints)",
                              kept[:1] or [{"step": submit_step, "lines": []}]))
    elif kept and tid in ("T05", "T07", "T08", "T09", "T10", "T11", "T12"):
        sig.append(Signal("kept_bad_replicate", "statistical_reasoning",
                          "Bottlenecked replicate treat_rep2 used in the comparison"
                          + (" — replicate correlation was never inspected" if never_rep_qc else ""), kept[:1]))

    no_fdr = _steps_matching(steps, r"fdr\w*\"\]\s*=\s*res\[\"p_|p\s*<\s*0\.1|pval\w*\s*<\s*0\.1")
    if tid in ("T07", "T10", "T11", "T12"):
        n_sig = ans.get("n_significant") if tid == "T07" else None
        if no_fdr or "fdr" not in done or (isinstance(n_sig, int) and n_sig > 60):
            sig.append(Signal("no_multiple_testing", "statistical_reasoning",
                              "No multiple-testing correction across ~2,000 genes"
                              + (f" ({n_sig} 'significant' genes)" if isinstance(n_sig, int) else ""),
                              no_fdr[:1] or ([{"step": submit_step, "lines": []}] if submit_step is not None else [])))

    raw = _steps_matching(steps, r"norm\s*=\s*lib\[.*\]\.astype\(float\)")
    if tid in NEEDS and "lfc" in NEEDS[tid] and (raw or ("normalize" not in done and "lfc" in done)):
        lfc_step = next((i for i, ms in milestones_by_step.items() if "lfc" in ms), None)
        sig.append(Signal("no_normalization", "statistical_reasoning",
                          "Fold changes computed on raw counts; ~2x depth difference between arms not corrected",
                          raw[:1] or ([{"step": lfc_step, "lines": []}] if lfc_step is not None else [])))

    # -- biological interpretation ---------------------------------------------------------------
    if tid in ("T09", "T12"):
        key = "genes" if tid == "T09" else "sensitizer"
        got = _gene_set(ans.get(key))
        if len(got & E) > (4 if tid == "T09" else 3):
            ev = _steps_matching(steps, r"gene_ess|fdr_ess|essential")
            sig.append(Signal("essentials_as_hits", "biological_interpretation",
                              f"{len(got & E)} core-essential genes reported as drug sensitizers",
                              ev[-1:] or [{"step": submit_step, "lines": []}]))
    if tid == "T10" and not grade.get("passed") and grade.get("checks"):
        core = _gene_set(ans.get("core_essential"))
        labels = task["ground_truth"]["labels"]
        missed = [g for g, c in labels.items() if c == "core_essential" and g.upper() not in core]
        if len(missed) >= 3:
            ev = _steps_matching(steps, r"gene_ess|classify|treatment_specific")
            sig.append(Signal("essentials_as_hits", "biological_interpretation",
                              f"{len(missed)}/10 core-essential genes not recognised as such (called treatment-specific)",
                              ev[-1:] or [{"step": submit_step, "lines": []}]))
    if tid == "T11" and ans.get("pathway") and str(ans["pathway"]).upper() != truth["enriched_pathway_resistance"]:
        if not any(s.id == "direction_flip" for s in sig):
            ev = _steps_matching(steps, r"max\(sets|len\(sets\[k\] & |overlap")
            sig.append(Signal("no_enrichment_test", "biological_interpretation",
                              f"Reported {ans['pathway']} from raw overlap; large housekeeping sets (ribosome) win without a hypergeometric test",
                              ev[-1:] or [{"step": submit_step, "lines": []}]))

    # -- weak signal, never decisive on its own ----------------------------------------------------
    if never_rep_qc and tid in ("T05", "T06", "T07", "T12"):
        sig.append(Signal("no_replicate_qc", "qc_miss", "Never inspected replicate agreement", []))

    # -- choose a category -------------------------------------------------------------------------
    category = None
    if not traj["passed"]:
        # Process-level signals that rarely flip a verdict on their own are "weak" outside the tasks
        # where they act directly: depth normalization only matters when fold-change magnitudes are
        # reported (T05; NTC-centred tests are depth-invariant), and one noisy replicate only matters
        # for T05/T06. Weak signals decide the label only when nothing stronger explains the failure.
        weak = {"no_replicate_qc"}
        if tid != "T05":
            weak.add("no_normalization")
        if tid not in ("T05", "T06"):
            weak.add("kept_bad_replicate")
        strong = [s for s in sig if s.id not in weak]
        fallback = [s for s in sig if s.id != "no_replicate_qc"]
        for pool in (strong, fallback):
            for cat in PRIORITY:
                if any(s.category == cat for s in pool):
                    category = cat
                    break
            if category:
                break
        if category is None:
            category = {"qc": "qc_miss"}.get(task["category"], task["category"])
            sig.append(Signal("unexplained", category,
                              "No specific rule fired; defaulting to the task's category", []))

    first_div = _first_divergence(traj, sig, milestones_by_step, submit_step, last_step)
    evidence_steps = sorted({e["step"] for s in sig if s.category == category for e in s.evidence
                             if e.get("step") is not None}) if category else []
    return {
        "category": category,
        "signals": [s.as_dict() for s in sig],
        "first_divergence_step": first_div if not traj["passed"] else None,
        "evidence_step_ids": evidence_steps,
        "milestones": {str(k): v for k, v in milestones_by_step.items()},
        "latent_issues": [s.id for s in sig] if traj["passed"] else [],
    }


def _first_divergence(traj, sig, milestones_by_step, submit_step, last_step) -> int | None:
    cands: list[int] = []
    for s in sig:
        if s.id in ("no_replicate_qc", "unexplained"):
            continue
        if s.id == "unrecovered_error":
            cands.append(getattr(s, "first", last_step))
            continue
        cands += [e["step"] for e in s.evidence if e.get("step") is not None]
    done: set[str] = set()
    for i in sorted(milestones_by_step):
        for m in milestones_by_step[i]:
            if m in PREREQ and not all(p in done for p in PREREQ[m]) and m != "test":
                cands.append(i)
            done.add(m)
    if cands:
        return min(cands)
    return submit_step if submit_step is not None else last_step
