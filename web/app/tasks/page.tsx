import Link from "next/link";
import type { Metadata } from "next";
import { getTasks } from "@/lib/data";
import { PageHeader, Section } from "@/components/ui/primitives";
import { pct } from "@/lib/format";
import { TASK_CATEGORY_LABEL } from "@/lib/task-meta";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  const { tasks, inputs } = getTasks();
  const counts = inputs.files["counts.tsv"];
  return (
    <>
      <PageHeader eyebrow="CRISPRScreenBench-mini" title="12 verifiable tasks on one pooled knockout screen">
        <p>
          A seeded synthetic genome-wide-style screen: {counts.genes?.toLocaleString()} genes × 4 sgRNAs plus {counts.non_targeting} non-targeting
          controls, sequenced as plasmid, day 0, two helixin-treated and two vehicle replicates. Planted ground truth: core-essential genes,
          30 treatment-specific hits, guide-efficacy noise, zero-count guides and one bottlenecked replicate. Each task is graded by a
          deterministic checker; tasks are grouped by the failure mode they probe.
        </p>
      </PageHeader>
      <Section title="Tasks" description="Pass rate is pooled over every configuration in the sweep.">
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-border-strong text-left text-2xs uppercase tracking-[0.06em] text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Task</th>
                <th scope="col" className="py-2 pr-3 font-medium">Probes</th>
                <th scope="col" className="py-2 pr-3 font-medium">Difficulty</th>
                <th scope="col" className="py-2 pr-3 font-medium">Trap</th>
                <th scope="col" className="py-2 pr-3 font-medium">Grader</th>
                <th scope="col" className="py-2 text-right font-medium">Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-border align-top last:border-0 hover:bg-surface-2">
                  <td className="py-2 pr-3">
                    <Link href={`/tasks/${t.id}`} className="font-medium hover:text-accent hover:underline">
                      <span className="num text-muted">{t.id}</span> {t.title}
                    </Link>
                    <p className="mt-0.5 max-w-md text-xs text-muted">{t.prompt}</p>
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{TASK_CATEGORY_LABEL[t.category]}</td>
                  <td className="py-2 pr-3 text-ink-2">{t.difficulty}</td>
                  <td className="py-2 pr-3 text-xs text-ink-2">{t.traps.join("; ")}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-muted">{Array.from(new Set(t.grader.checks.map((c) => c.kind))).join(", ")}</td>
                  <td className="num py-2 text-right">{pct(t.pass_rate ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
