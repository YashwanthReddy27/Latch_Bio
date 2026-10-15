"""Registry of benchmark configurations (model x harness)."""

from __future__ import annotations

from .agents.scripted import Profile, ScriptedAgent

ALL_TASK_MISTAKES = ("execution_error", "format_error")

OFFLINE: dict[str, tuple[dict, Profile]] = {
    "baseline-reference": (
        {"kind": "BASELINE", "model": "scripted", "harness": "reference pipeline",
         "label": "Reference pipeline (scripted)",
         "description": "Deterministic correct analysis: QC, exclude bad replicate, median-of-ratios, NTC z-test, BH-FDR."},
        Profile(),
    ),
    "baseline-naive": (
        {"kind": "BASELINE", "model": "scripted", "harness": "naive pipeline",
         "label": "Naive pipeline (scripted)",
         "description": "Deterministic flawed analysis: skips replicate QC, raw counts, compares to day0, no FDR, overlap-based pathways."},
        Profile(fixed_mistakes=("keep_bad_replicate", "skip_normalization", "compare_to_day0", "no_fdr_correction",
                                "zero_any_sample", "gini_on_log", "misread_bad_replicate", "pathway_by_overlap")),
    ),
    "sim-a-careful": (
        {"kind": "SIMULATED", "model": "sim-A (frontier-like)", "harness": "react + QC-first prompt",
         "label": "sim-A · careful", "description": "SIMULATED: low error rates, thorough QC, verbose and expensive."},
        Profile(mistake_rates={"flip_direction": 0.05, "compare_to_day0": 0.06, "keep_bad_replicate": 0.05,
                               "skip_normalization": 0.05, "no_fdr_correction": 0.06, "essentials_as_hits": 0.12,
                               "pathway_by_overlap": 0.08, "gini_on_log": 0.05, "per_gene_coverage": 0.03,
                               "zero_any_sample": 0.05, "misread_bad_replicate": 0.1,
                               "execution_error": 0.02, "format_error": 0.02},
                explore_p=0.7, plot_p=0.5, transient_error_p=0.2, skip_intro_p=0.0,
                price_in=2.5, price_out=12.0, thinking=(300, 1400), verbosity=1.4, tok_per_s=90, ttft_s=1.2),
    ),
    "sim-b-fast": (
        {"kind": "SIMULATED", "model": "sim-B (frontier-like)", "harness": "react, minimal prompt",
         "label": "sim-B · fast", "description": "SIMULATED: same capability tier as sim-A but skips QC and rushes interpretation."},
        Profile(mistake_rates={"flip_direction": 0.15, "compare_to_day0": 0.15, "keep_bad_replicate": 0.45,
                               "skip_normalization": 0.1, "no_fdr_correction": 0.2, "essentials_as_hits": 0.3,
                               "pathway_by_overlap": 0.15, "gini_on_log": 0.15, "per_gene_coverage": 0.15,
                               "zero_any_sample": 0.2, "misread_bad_replicate": 0.35,
                               "execution_error": 0.03, "format_error": 0.04},
                explore_p=0.2, plot_p=0.1, transient_error_p=0.15, skip_intro_p=0.6,
                price_in=2.5, price_out=12.0, thinking=(80, 400), verbosity=0.9, tok_per_s=140, ttft_s=0.7),
    ),
    "sim-c-mid": (
        {"kind": "SIMULATED", "model": "sim-C (mid-tier-like)", "harness": "react + QC-first prompt",
         "label": "sim-C · mid-tier", "description": "SIMULATED: cheaper model; most errors are statistical (normalization, FDR, replicates)."},
        Profile(mistake_rates={"flip_direction": 0.15, "compare_to_day0": 0.25, "keep_bad_replicate": 0.4,
                               "skip_normalization": 0.45, "no_fdr_correction": 0.45, "essentials_as_hits": 0.3,
                               "pathway_by_overlap": 0.25, "gini_on_log": 0.25, "per_gene_coverage": 0.2,
                               "zero_any_sample": 0.25, "misread_bad_replicate": 0.4,
                               "execution_error": 0.06, "format_error": 0.05},
                explore_p=0.5, plot_p=0.3, transient_error_p=0.3, skip_intro_p=0.3,
                price_in=0.6, price_out=2.4, thinking=(100, 600), verbosity=1.1, tok_per_s=180, ttft_s=0.5),
    ),
    "sim-d-small": (
        {"kind": "SIMULATED", "model": "sim-D (small-model-like)", "harness": "react, minimal prompt",
         "label": "sim-D · small", "description": "SIMULATED: small cheap model; frequent tool errors, schema slips and direction mistakes."},
        Profile(mistake_rates={"flip_direction": 0.35, "compare_to_day0": 0.35, "keep_bad_replicate": 0.55,
                               "skip_normalization": 0.4, "no_fdr_correction": 0.5, "essentials_as_hits": 0.45,
                               "pathway_by_overlap": 0.4, "gini_on_log": 0.3, "per_gene_coverage": 0.3,
                               "zero_any_sample": 0.35, "misread_bad_replicate": 0.5,
                               "execution_error": 0.15, "format_error": 0.12},
                explore_p=0.3, plot_p=0.05, transient_error_p=0.45, skip_intro_p=0.5,
                price_in=0.1, price_out=0.4, thinking=(0, 0), verbosity=0.8, tok_per_s=260, ttft_s=0.3),
    ),
}


def make_agent(config_id: str, prompt_variant: str = "minimal"):
    if config_id in OFFLINE:
        meta, profile = OFFLINE[config_id]
        return ScriptedAgent({"id": config_id, **meta}, profile)
    if config_id == "gemini" or config_id.startswith("gemini"):
        from .agents.gemini import GeminiAgent, config_for

        return GeminiAgent(config_for(prompt_variant), prompt_variant)
    raise SystemExit(f"unknown --model '{config_id}'. Options: {', '.join(OFFLINE)}, gemini")


def config_meta(config_id: str) -> dict:
    meta, _ = OFFLINE[config_id]
    return {"id": config_id, **meta}
