import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConfigs, getTasks } from "@/lib/data";
import { ButtonLink, KindBadge, PageHeader, Section } from "@/components/ui/primitives";
import { CodeBlock } from "@/components/trajectory/code-block";
import { PassRateBar } from "@/components/charts/leaderboard";
import { TASK_CATEGORY_LABEL, describeCheck } from "@/lib/task-meta";
import { PageTabs } from "@/components/ui/tabs";

export const dynamicParams = false;

export function generateStaticParams() {
  return getTasks().tasks.map((t) => ({ id: t.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const t = getTasks().tasks.find((x) => x.id === params.id);
  return { title: t ? `${t.id} ${t.title}` : "Task" };
}

const MILESTONE_LABEL: Record<string, string> = {
  load: "load counts",
  qc_coverage: "coverage, zeros, Gini",
  qc_replicates: "replicate correlation",
  exclude_bad: "exclude failed sample",
  normalize: "depth normalization",
  lfc: "fold change vs vehicle",
  test: "gene-level test vs NTC null",
  fdr: "Benjamini-Hochberg FDR",
  interpret: "interpret direction / biology",
  submit: "submit JSON",
};

export default function TaskPage({ params }: { params: { id: string } }) {
  const { tasks, inputs } = getTasks();
  const task = tasks.find((t) => t.id === params.id);
  if (!task) notFound();
  const configs = getConfigs();
  const idx = tasks.findIndex((t) => t.id === task.id);
  const prev = tasks[idx - 1];
  const next = tasks[idx + 1];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-x-3 text-xs text-muted">
        <Link href="/tasks" className="hover:text-accent">Tasks</Link>
        <span>/</span>
        <span className="num">{task.id}</span>
        <span className="flex-1" />
        {prev && <Link href={`/tasks/${prev.id}`} className="hover:text-accent">← {prev.id}</Link>}
        {next && <Link href={`/tasks/${next.id}`} className="hover:text-accent">{next.id} →</Link>}
      </nav>
      <PageHeader eyebrow={`${task.id} · ${TASK_CATEGORY_LABEL[task.category]} · ${task.difficulty}`} title={task.title}>
        <p className="text-[14px] text-ink">{task.prompt}</p>
        <p className="mt-1 text-xs text-muted">{task.context}</p>
      </PageHeader>

      <PageTabs
        label="Task views"
        items={[
          {
            value: "grading",
            label: "How it's graded",
            content: (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="grid content-start gap-4">
          <Section title="How it is graded" description="Deterministic: no LLM, no randomness, same answer → same verdict.">
            <p className="text-[13px] text-ink-2">{task.grader_plain}</p>
            <ol className="mt-3 grid gap-2">
              {task.grader.checks.map((c, i) => (
                <li key={c.id} className="rounded border border-border px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-xs text-muted">check {i + 1}</span>
                    <span className="font-medium">{c.label ?? c.id}</span>
                    <span className="font-mono text-[11px] text-muted">
                      {c.kind}
                      {c.path ? ` @ ${c.path}` : ""}
                    </span>
                  </div>
                  <p className="mt-0.5 text-ink-2">Passes if the answer is {describeCheck(c)}.</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted">
              Before any check runs, the answer must match the JSON schema below; otherwise the run fails as a formatting error.
            </p>
          </Section>

                </div>
                <div className="grid content-start gap-4">
          <Section title="Reference pipeline milestones" description="Used to align trajectories and find the first divergence step.">
            <ol className="flex flex-wrap gap-1.5 text-xs">
              {task.milestones.map((m, i) => (
                <li key={m} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden className="text-muted">→</span>}
                  <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5">
                    <span className="font-mono text-[11px]">{m}</span> <span className="text-muted">{MILESTONE_LABEL[m]}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
                </div>
              </div>
            ),
          },
          {
            value: "data",
            label: "Data and truth",
            content: (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid content-start gap-4">
          <Section title="Inputs" description="Files copied into the agent's sandbox workspace.">
            <ul className="grid gap-1 text-[13px]">
              {task.inputs.map((f) => {
                const info = inputs.files[f];
                return (
                  <li key={f} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-1 last:border-0">
                    <a
                      href={f === "candidates.json" ? `/tasks/T10/${f}` : `/tasks/screen/${f}`}
                      className="font-mono text-[12px] text-accent hover:underline"
                      download
                    >
                      {f}
                    </a>
                    <span className="num text-xs text-muted">
                      {info?.rows ? `${info.rows.toLocaleString()} rows · ` : ""}
                      {info?.gene_sets ? `${info.gene_sets} gene sets · ` : ""}
                      {info ? `${(info.bytes / 1024).toFixed(1)} KB` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mb-1 mt-3 text-2xs font-medium uppercase tracking-[0.06em] text-muted">counts.tsv preview</p>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="num w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    {Object.keys(inputs.counts_preview[0]).map((k) => (
                      <th key={k} scope="col" className="py-1 pr-2 font-medium">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inputs.counts_preview.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {Object.values(r).map((v, j) => (
                        <td key={j} className="py-1 pr-2">{String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

                </div>
                <div className="grid content-start gap-4">
          <Section title="Planted ground truth" description="Hidden from agents; known to the grader.">
            {Object.keys(task.ground_truth).length ? (
              <dl className="grid gap-2 text-[13px]">
                {Object.entries(task.ground_truth).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{k.replaceAll("_", " ")}</dt>
                    <dd className="mt-0.5 font-mono text-[12px] leading-relaxed text-ink">
                      {Array.isArray(v)
                        ? v.join(", ")
                        : typeof v === "object" && v
                          ? Object.entries(v as Record<string, string>).map(([g, c]) => (
                              <span key={g} className="mr-2 inline-block">
                                {g}
                                <span className="text-muted">:{String(c).replace("treatment_specific", "trt").replace("core_essential", "ess")}</span>
                              </span>
                            ))
                          : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[13px] text-ink-2">Values are computed from the data by the reference pipeline (see reference answer).</p>
            )}
          </Section>

          <Section title="Answer schema and reference answer">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-2xs font-medium uppercase tracking-[0.06em] text-muted">Schema</p>
                <CodeBlock code={JSON.stringify(task.answer_schema, null, 1)} language="json" maxHeight={280} label="Answer schema" />
              </div>
              <div>
                <p className="mb-1 text-2xs font-medium uppercase tracking-[0.06em] text-muted">Reference answer (scripted pipeline)</p>
                <CodeBlock code={JSON.stringify(task.reference_answer, null, 1)} language="json" maxHeight={280} label="Reference answer" />
              </div>
            </div>
          </Section>

                </div>
              </div>
            ),
          },
          {
            value: "results",
            label: "Results",
            content: (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Section title="Pass rate on this task" actions={<ButtonLink href={`/trajectories?task=${task.id}`}>Trajectories</ButtonLink>}>
            <ul className="grid gap-2">
              {configs.map((c) => {
                const cell = c.per_task[task.id];
                const rate = cell?.n ? cell.pass / cell.n : 0;
                return (
                  <li key={c.id}>
                    <div className="mb-0.5 flex items-center gap-1.5 text-xs">
                      <Link href={`/trajectories?config=${c.id}&task=${task.id}`} className="hover:text-accent">{c.label}</Link>
                      <KindBadge kind={c.kind} />
                      <span className="num ml-auto text-muted">{cell?.pass}/{cell?.n}</span>
                    </div>
                    <PassRateBar rate={rate} ci={wilson(cell?.pass ?? 0, cell?.n ?? 0)} />
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Live">
            <p className="text-[13px] text-ink-2">Watch an agent attempt this task in your browser.</p>
            <ButtonLink href={`/live?task=${task.id}`} variant="primary" className="mt-2">
              Open in Live run
            </ButtonLink>
          </Section>
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
