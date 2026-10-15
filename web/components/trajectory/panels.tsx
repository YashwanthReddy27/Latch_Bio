import Link from "next/link";
import { AlertTriangle, Check, X } from "lucide-react";
import type { GradeResult, JudgeLabel, RuleLabel, Trajectory } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";
import { CategoryTag, PassChip } from "@/components/ui/primitives";
import { cn } from "@/lib/format";

export function GraderPanel({ grade, title = "Deterministic grader" }: { grade: GradeResult; title?: string }) {
  return (
    <section className="rounded border border-border bg-surface" aria-label="Grader result">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <PassChip passed={grade.passed} label={grade.passed ? "Pass" : `Fail · score ${grade.score}`} />
      </header>
      <div className="px-3 py-2.5">
        {grade.error ? (
          <p className="flex items-start gap-1.5 text-[13px] text-fail">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            {grade.error}
          </p>
        ) : (
          <ul className="grid gap-2.5">
            {grade.checks.map((c) => (
              <li key={c.id} className="text-[12.5px]">
                <div className="flex items-center gap-1.5">
                  {c.passed ? <Check size={14} className="text-pass" aria-label="passed" /> : <X size={14} className="text-fail" aria-label="failed" />}
                  <span className="font-medium">{c.label}</span>
                  <span className="font-mono text-[10.5px] text-muted">{c.kind}</span>
                </div>
                <dl className="ml-5 mt-1 grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5">
                  <dt className="text-muted">expected</dt>
                  <dd className="num break-words text-ink-2">{c.expected}</dd>
                  <dt className="text-muted">actual</dt>
                  <dd className={cn("num break-words", c.passed ? "text-ink-2" : "text-fail")}>{c.actual}</dd>
                  <dt className="text-muted">detail</dt>
                  <dd className="num break-words text-muted">{c.detail}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function LabelPanel({ traj, stepHref = (i: number) => `#step-${i}` }: { traj: Trajectory; stepHref?: (i: number) => string }) {
  const { rule, judge, disagree } = traj.labels;
  if (traj.passed) {
    return (
      <section className="rounded border border-border bg-surface" aria-label="Failure label">
        <header className="border-b border-border px-3 py-2">
          <h2 className="text-[13px] font-semibold">Failure label</h2>
        </header>
        <div className="px-3 py-2.5 text-[12.5px] text-ink-2">
          Passed: no failure label.
          {rule.latent_issues.length > 0 && (
            <p className="mt-1.5 text-warn">
              Latent issues (fired on a passing run): <span className="font-mono">{rule.latent_issues.join(", ")}</span>
            </p>
          )}
        </div>
      </section>
    );
  }
  return (
    <section className="rounded border border-border bg-surface" aria-label="Failure label">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-[13px] font-semibold">Failure label</h2>
        {disagree && <span className="rounded-sm bg-warn-soft px-1.5 py-px text-[10.5px] font-medium text-warn">judge / rule disagreement</span>}
      </header>
      <div className="grid gap-3 px-3 py-2.5 text-[12.5px]">
        <RuleBlock rule={rule} stepHref={stepHref} />
        <JudgeBlock judge={judge} stepHref={stepHref} />
        {traj.injected && traj.kind !== "REAL" && (
          <div className="rounded border border-dashed border-border-strong px-2.5 py-2">
            <p className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">Ground truth: injected fault(s)</p>
            {traj.injected.mistakes.length ? (
              <ul className="mt-1 grid gap-1 text-ink-2">
                {traj.injected.mistakes.map((m, k) => (
                  <li key={m}>
                    <span className="font-mono text-[11px]">{m}</span>: {traj.injected?.descriptions[k]}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-ink-2">None injected: this failure arose from the agent&apos;s own transient errors.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function RuleBlock({ rule, stepHref }: { rule: RuleLabel; stepHref: (i: number) => string }) {
  const decisive = rule.signals.filter((s) => s.category === rule.category && s.id !== "no_replicate_qc");
  const other = rule.signals.filter((s) => !decisive.includes(s));
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">Rule-based</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <CategoryTag category={rule.category} />
        {rule.first_divergence_step !== null && (
          <a href={stepHref(rule.first_divergence_step)} className="num text-xs text-accent hover:underline">
            first divergence: step {rule.first_divergence_step}
          </a>
        )}
      </div>
      <ul className="mt-1.5 grid gap-1">
        {decisive.map((s) => (
          <li key={s.id} className="text-ink-2">
            <span className="font-mono text-[11px] text-ink">{s.id}</span> {s.message}
            <StepLinks steps={s.evidence.map((e) => e.step)} stepHref={stepHref} />
          </li>
        ))}
        {other.map((s) => (
          <li key={s.id} className="text-muted">
            <span className="font-mono text-[11px]">{s.id}</span> ({CATEGORY_LABEL[s.category]}) {s.message}
            <StepLinks steps={s.evidence.map((e) => e.step)} stepHref={stepHref} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function JudgeBlock({ judge, stepHref }: { judge: JudgeLabel | null; stepHref: (i: number) => string }) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">LLM judge{judge ? ` · ${judge.model}` : ""}</p>
      {judge ? (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <CategoryTag category={judge.category} />
            <a href={stepHref(judge.first_divergence_step)} className="num text-xs text-accent hover:underline">
              first divergence: step {judge.first_divergence_step}
            </a>
          </div>
          <p className="mt-1 text-ink-2">{judge.explanation}</p>
          <StepLinks steps={judge.evidence_step_ids} stepHref={stepHref} prefix="cited steps" />
        </>
      ) : (
        <p className="mt-1 text-muted">Not judged yet (no cached judge output for this run).</p>
      )}
    </div>
  );
}

function StepLinks({ steps, stepHref, prefix }: { steps: (number | null)[]; stepHref: (i: number) => string; prefix?: string }) {
  const ids = Array.from(new Set(steps.filter((s): s is number => s !== null)));
  if (!ids.length) return null;
  return (
    <span className="ml-1 text-xs text-muted">
      {prefix ? `${prefix}: ` : "("}
      {ids.map((i, k) => (
        <span key={i}>
          {k > 0 && ", "}
          <a href={stepHref(i)} className="num text-accent hover:underline">
            #{i}
          </a>
        </span>
      ))}
      {prefix ? "" : ")"}
    </span>
  );
}

export function TrajectoryLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link href={`/trajectories/${id}`} className="hover:text-accent hover:underline">
      {children}
    </Link>
  );
}
