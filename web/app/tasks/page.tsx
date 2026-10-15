import Link from "next/link";
import type { Metadata } from "next";
import { getTasks } from "@/lib/data";
import type { TaskSpec } from "@/lib/types";
import { PageHeader } from "@/components/ui/primitives";
import { pct } from "@/lib/format";
import { TASK_CATEGORY_LABEL } from "@/lib/task-meta";

export const metadata: Metadata = { title: "Tasks" };

const GROUPS: { key: TaskSpec["category"]; blurb: string }[] = [
  { key: "qc", blurb: "Is the data usable?" },
  { key: "statistical_reasoning", blurb: "Are the numbers computed soundly?" },
  { key: "problem_interpretation", blurb: "Did the agent answer the question asked?" },
  { key: "biological_interpretation", blurb: "Is the biology read correctly?" },
];

export default function TasksPage() {
  const { tasks } = getTasks();
  return (
    <>
      <PageHeader eyebrow="Tasks" title="12 tasks, one CRISPR screen">
        <p>A synthetic pooled knockout screen with planted answers. Each task has a deterministic grader.</p>
      </PageHeader>
      <div className="grid gap-6 md:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <h2 id={`g-${g.key}`} className="text-[13px] font-semibold">
              {TASK_CATEGORY_LABEL[g.key]}
            </h2>
            <p className="mb-2 text-xs text-muted">{g.blurb}</p>
            <ul className="grid gap-2">
              {tasks
                .filter((t) => t.category === g.key)
                .map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/tasks/${t.id}`}
                      className="flex items-center gap-3 rounded border border-border bg-surface px-3 py-2.5 hover:border-accent"
                    >
                      <span className="num w-8 text-xs text-muted">{t.id}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{t.title}</span>
                        <span className="text-xs text-muted">{t.difficulty}</span>
                      </span>
                      <span className="w-20 shrink-0" aria-label={`pass rate ${pct(t.pass_rate ?? 0)}`}>
                        <span className="num block text-right text-xs">{pct(t.pass_rate ?? 0)}</span>
                        <span className="mt-1 block h-1 rounded-full bg-surface-3">
                          <span className="block h-1 rounded-full bg-accent" style={{ width: `${(t.pass_rate ?? 0) * 100}%` }} />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
