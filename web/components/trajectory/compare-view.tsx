"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Step, Trajectory } from "@/lib/types";
import { StepCard } from "./step-card";
import { stepMarks } from "./timeline";
import { GraderPanel } from "./panels";
import { CategoryTag, KindBadge, PassChip } from "@/components/ui/primitives";

const ORDER = ["read_design", "load", "qc_coverage", "qc_replicates", "exclude_bad", "normalize", "lfc", "test", "fdr", "interpret", "submit"];
const MILESTONE_LABEL: Record<string, string> = {
  read_design: "Read design",
  load: "Load data",
  qc_coverage: "QC: coverage / Gini",
  qc_replicates: "QC: replicate agreement",
  exclude_bad: "Sample exclusion",
  normalize: "Normalization",
  lfc: "Fold changes",
  test: "Statistical test",
  fdr: "Multiple testing",
  interpret: "Interpretation",
  submit: "Submit",
  other: "Other steps (exploration, errors, retries)",
};

function bucket(steps: Step[]): Record<string, Step[]> {
  const out: Record<string, Step[]> = {};
  for (const s of steps) {
    const ms = s.milestones?.length ? s.milestones : ["other"];
    // file the step under its LAST pipeline milestone (cells often do several)
    const key = [...ms].sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0];
    (out[key] ??= []).push(s);
  }
  return out;
}

function codeOf(steps: Step[] | undefined) {
  return (steps ?? []).map((s) => String(s.args.code ?? s.args.answer_json ?? "")).join("\n");
}

export function CompareView({ labels }: { labels: Record<string, string> }) {
  const params = useSearchParams();
  const a = params.get("a");
  const b = params.get("b");
  const [data, setData] = useState<[Trajectory, Trajectory] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!a || !b) return;
    setData(null);
    setError(null);
    Promise.all([a, b].map((id) => fetch(`/data/traj/${encodeURIComponent(id)}.json`).then((r) => (r.ok ? r.json() : Promise.reject(id)))))
      .then(([x, y]) => setData([x, y]))
      .catch((id) => setError(`Could not load trajectory ${id}`));
  }, [a, b]);

  if (!a || !b) {
    return (
      <p className="text-ink-2">
        Pick two runs on the{" "}
        <Link href="/trajectories" className="text-accent hover:underline">
          Trajectories
        </Link>{" "}
        page (tick two rows), or use “Side-by-side” on any trajectory.
      </p>
    );
  }
  if (error) return <p className="text-fail">{error}</p>;
  if (!data) return <p className="text-ink-2" aria-live="polite">Loading both trajectories…</p>;

  const [ta, tb] = data;
  const ba = bucket(ta.steps);
  const bb = bucket(tb.steps);
  const keys = [...ORDER, "other"].filter((k) => ba[k] || bb[k]);
  const ma = stepMarks(ta);
  const mb = stepMarks(tb);
  const differ = keys.filter((k) => codeOf(ba[k]) !== codeOf(bb[k])).length;

  return (
    <div>
      {ta.task_id !== tb.task_id && (
        <p className="mb-3 rounded border border-warn bg-warn-soft px-3 py-2 text-xs">
          These runs are on different tasks ({ta.task_id} vs {tb.task_id}); the diff is less meaningful.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {[ta, tb].map((t, k) => (
          <div key={t.id} className="rounded border border-border bg-surface px-3 py-2.5">
            <p className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">{k === 0 ? "A" : "B"}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <Link href={`/trajectories/${t.id}`} className="font-medium hover:text-accent hover:underline">
                {labels[t.config_id] ?? t.config_id}
              </Link>
              <span className="num text-xs text-muted">{t.task_id} · r{t.run_idx}</span>
              <KindBadge kind={t.kind} />
              <PassChip passed={t.passed} />
            </div>
            {!t.passed && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <CategoryTag category={t.labels.rule.category} />
                <span className="num text-muted">first divergence: step {t.labels.rule.first_divergence_step}</span>
              </p>
            )}
            <div className="mt-2">
              <GraderPanel grade={t.grade} title="Grader" />
            </div>
          </div>
        ))}
      </div>

      <p className="num my-3 text-xs text-ink-2">
        {keys.length} pipeline stages · {differ} differ in code
      </p>

      <div className="grid gap-3">
        {keys.map((k) => {
          const same = codeOf(ba[k]) === codeOf(bb[k]);
          return (
            <section key={k} aria-label={MILESTONE_LABEL[k]} className="rounded border border-border">
              <header className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
                <h3 className="text-xs font-semibold">{MILESTONE_LABEL[k] ?? k}</h3>
                {same ? (
                  <span className="text-[10.5px] text-muted">identical code</span>
                ) : (
                  <span className="rounded-sm bg-warn-soft px-1.5 text-[10.5px] font-medium text-warn">differs</span>
                )}
              </header>
              <div className="grid gap-2 p-2 md:grid-cols-2">
                {[
                  { steps: ba[k], marks: ma, p: "a" },
                  { steps: bb[k], marks: mb, p: "b" },
                ].map(({ steps, marks, p }) => (
                  <div key={p} className="grid content-start gap-2">
                    <p className="text-2xs font-medium uppercase tracking-[0.06em] text-muted md:hidden">{p.toUpperCase()}</p>
                    {steps?.length ? (
                      steps.map((s) => <StepCard key={s.i} step={s} marks={marks[s.i]} compact anchorPrefix={`${p}-step`} defaultOpen={!!marks[s.i]?.evidenceCategory} />)
                    ) : (
                      <p className="rounded border border-dashed border-border-strong px-3 py-3 text-xs text-muted">
                        No step at this stage{k === "qc_replicates" || k === "exclude_bad" || k === "normalize" || k === "fdr" ? ": skipped" : ""}.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
