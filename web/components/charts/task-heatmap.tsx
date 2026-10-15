import Link from "next/link";
import type { ConfigRow, TaskSpec } from "@/lib/types";
import { KindBadge } from "@/components/ui/primitives";

// 6-step sequential teal; text flips to light ink on the two darkest steps
function step(rate: number): number {
  return Math.min(5, Math.round(rate * 5));
}

export function TaskHeatmap({ configs, tasks }: { configs: ConfigRow[]; tasks: TaskSpec[] }) {
  return (
    <figure>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[720px] border-separate border-spacing-[2px] text-[12px]">
          <caption className="sr-only">Pass rate by configuration (rows) and task (columns). Each cell links to the matching trajectories.</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-1 pr-2 text-left text-2xs font-medium uppercase tracking-[0.06em] text-muted">
                Config \ Task
              </th>
              {tasks.map((t) => (
                <th key={t.id} scope="col" className="pb-1 text-center font-normal">
                  <Link href={`/tasks/${t.id}`} className="num block text-[11px] text-ink-2 hover:text-accent" title={t.title}>
                    {t.id}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.id}>
                <th scope="row" className="whitespace-nowrap pr-3 text-left font-normal">
                  <span className="mr-1.5 text-ink">{c.label}</span>
                  <KindBadge kind={c.kind} />
                </th>
                {tasks.map((t) => {
                  const cell = c.per_task[t.id] ?? { n: 0, pass: 0 };
                  const rate = cell.n ? cell.pass / cell.n : 0;
                  const s = step(rate);
                  return (
                    <td key={t.id} className="p-0">
                      <Link
                        href={`/trajectories?config=${encodeURIComponent(c.id)}&task=${t.id}`}
                        aria-label={`${c.label}, ${t.id} ${t.title}: ${cell.pass} of ${cell.n} passed`}
                        title={`${t.id} ${t.title}: ${cell.pass}/${cell.n} passed`}
                        className="num flex h-8 min-w-[44px] items-center justify-center rounded-[3px] outline-offset-1 hover:ring-1 hover:ring-[var(--text)]"
                        style={{ background: `var(--seq-${s})`, color: s >= 4 ? "var(--surface)" : "var(--text)" }}
                      >
                        {cell.pass}/{cell.n}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span>0%</span>
        <span className="flex" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((s) => (
            <span key={s} className="h-2.5 w-6" style={{ background: `var(--seq-${s})` }} />
          ))}
        </span>
        <span>100% pass</span>
        <span className="ml-3">Cells show passed / runs.</span>
      </figcaption>
    </figure>
  );
}
