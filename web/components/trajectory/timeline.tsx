"use client";

import type { Trajectory } from "@/lib/types";
import { StepCard, type StepMarks } from "./step-card";

/** Per-step marks (evidence lines, divergence flags) derived from a trajectory's labels. */
export function stepMarks(traj: Trajectory): Record<number, StepMarks> {
  const marks: Record<number, StepMarks> = {};
  const get = (i: number) => (marks[i] ??= {});
  const { rule, judge } = traj.labels;
  if (!traj.passed) {
    for (const s of rule.signals) {
      if (s.category !== rule.category || s.id === "no_replicate_qc") continue;
      for (const e of s.evidence) {
        if (e.step === null) continue;
        const m = get(e.step);
        m.evidenceCategory = s.category;
        m.evidenceLines = Array.from(new Set([...(m.evidenceLines ?? []), ...e.lines]));
      }
    }
    if (rule.first_divergence_step !== null) get(rule.first_divergence_step).ruleDivergence = true;
    if (judge) {
      get(judge.first_divergence_step).judgeDivergence = true;
      for (const i of judge.evidence_step_ids) get(i).judgeEvidence = true;
    }
  }
  return marks;
}

export function Timeline({ traj, anchorPrefix = "step", compact }: { traj: Trajectory; anchorPrefix?: string; compact?: boolean }) {
  const marks = stepMarks(traj);
  return (
    <ol className="grid gap-2.5" aria-label="Trajectory steps">
      {traj.steps.map((s) => (
        <li key={s.i}>
          <StepCard step={s} marks={marks[s.i]} anchorPrefix={anchorPrefix} compact={compact} />
        </li>
      ))}
      {traj.status !== "submitted" && (
        <li className="rounded border border-dashed border-fail px-3 py-2 text-[12.5px] text-fail">
          Run ended without a valid answer ({traj.status.replace("_", " ")}).
        </li>
      )}
    </ol>
  );
}
