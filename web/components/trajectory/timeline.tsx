"use client";

import { useState } from "react";
import type { Trajectory } from "@/lib/types";
import { CATEGORY_COLOR } from "@/components/ui/primitives";
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

type Mode = "key" | "all" | "none";

export function Timeline({ traj, anchorPrefix = "step", compact }: { traj: Trajectory; anchorPrefix?: string; compact?: boolean }) {
  const marks = stepMarks(traj);
  const [mode, setMode] = useState<Mode>("key");
  const isKey = (i: number) => {
    const m = marks[i];
    const s = traj.steps[i];
    return !!(m?.evidenceCategory || m?.ruleDivergence || m?.judgeDivergence || m?.judgeEvidence) || s?.tool === "submit_answer" || (s?.images?.length ?? 0) > 0;
  };
  const opts: { v: Mode; l: string }[] = [
    { v: "key", l: "Key steps" },
    { v: "all", l: "Expand all" },
    { v: "none", l: "Collapse all" },
  ];
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {traj.steps.length} steps. {mode === "key" ? "Flagged steps are open; the rest are summarized." : ""}
        </p>
        <div role="radiogroup" aria-label="Step detail" className="flex rounded border border-border bg-surface p-0.5">
          {opts.map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={mode === o.v}
              onClick={() => setMode(o.v)}
              className={`rounded-[3px] px-2 py-0.5 text-xs ${mode === o.v ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:text-ink"}`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <ol className="grid gap-2" aria-label="Trajectory steps">
        {traj.steps.map((s) => (
          <li key={`${mode}-${s.i}`}>
            <StepCard
              step={s}
              marks={marks[s.i]}
              anchorPrefix={anchorPrefix}
              compact={compact}
              defaultOpen={mode === "all" || (mode === "key" && isKey(s.i))}
            />
          </li>
        ))}
        {traj.status !== "submitted" && (
          <li className="rounded border border-dashed border-fail px-3 py-2 text-[12.5px] text-fail">
            Run ended without a valid answer ({traj.status.replace("_", " ")}).
          </li>
        )}
      </ol>
    </div>
  );
}

/** Compact clickable list of steps for the sidebar. */
export function StepIndex({ traj }: { traj: Trajectory }) {
  const marks = stepMarks(traj);
  return (
    <nav aria-label="Step index">
      <ol className="grid gap-px text-[12px]">
        {traj.steps.map((s) => {
          const m = marks[s.i];
          const err = !!s.output?.error;
          return (
            <li key={s.i}>
              <a
                href={`#step-${s.i}`}
                className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-surface-2"
              >
                <span className="num w-6 text-right text-muted">{s.i}</span>
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: m?.evidenceCategory
                      ? CATEGORY_COLOR[m.evidenceCategory]
                      : err
                        ? "var(--fail)"
                        : "var(--border-strong)",
                  }}
                />
                <span className="truncate text-ink-2">
                  {s.milestones?.length ? s.milestones.join(", ") : s.tool === "run_python" ? (err ? "error" : "explore") : s.tool}
                </span>
                {m?.ruleDivergence && <span className="ml-auto shrink-0 text-[10px] font-medium text-fail">diverged</span>}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
