import Link from "next/link";
import type { Metadata } from "next";
import { getConfigs, getFailures, getIndex, getMeta, getTasks } from "@/lib/data";
import type { Category } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/types";
import { FailureStack } from "@/components/charts/failure-stack";
import { DivergenceHist } from "@/components/charts/divergence-hist";
import { CATEGORY_COLOR, CategoryTag, Note, PageHeader, Section } from "@/components/ui/primitives";
import { PageTabs } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Failure taxonomy" };

const DEFINITIONS: Record<Category, { def: string; example: string }> = {
  problem_interpretation: {
    def: "Answered a different question than the one asked.",
    example: "Ranked depleted genes for a resistance question; compared treatment to day0 instead of vehicle.",
  },
  statistical_reasoning: {
    def: "The numbers are produced by an unsound procedure.",
    example: "No depth normalization, a bottlenecked replicate kept, raw p < 0.1 across 2,000 genes.",
  },
  biological_interpretation: {
    def: "Sound statistics, wrong biological reading.",
    example: "Core-essential ribosome genes reported as drug sensitizers; enrichment by raw overlap.",
  },
  qc_miss: {
    def: "A quality-control metric is missed or mis-computed.",
    example: "Gini on log counts; coverage per gene instead of per sgRNA; bottleneck called a sample swap.",
  },
  execution_error: {
    def: "Tool or code errors the agent never recovered from.",
    example: "Looped on a missing package until the 25-step limit; never submitted.",
  },
  formatting: {
    def: "The analysis may be right, but the answer violates the schema.",
    example: "Returned a list where an object keyed by sample was required.",
  },
};

export default function FailuresPage() {
  const failures = getFailures();
  const configs = getConfigs();
  const meta = getMeta();
  const index = getIndex();
  const { tasks } = getTasks();
  const judgeAvailable = meta.judge.n_labeled > 0;
  const gold = failures.agreement.gold;
  const totalFail = configs.reduce((s, c) => s + (c.n - c.n_pass), 0);
  const catTotals = CATEGORIES.map((k) => ({ k, n: configs.reduce((s, c) => s + (c.failures[k] ?? 0), 0) }));
  const disagreeRows = index.filter((r) => r.disagree);
  const labelOf = Object.fromEntries(configs.map((c) => [c.id, c.label]));

  return (
    <>
      <PageHeader eyebrow="Failure taxonomy" title="Why agents fail">
        <p>
          Each failed run gets one root-cause label from rules{judgeAvailable ? " and from a Gemini judge" : ""}, plus the step where it
          first went wrong.
        </p>
      </PageHeader>

      <PageTabs
        label="Failure taxonomy views"
        items={[
          {
            value: "summary",
            label: "Summary",
            hint: "what goes wrong",
            content: (
              <>
      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {catTotals.map(({ k, n }) => (
          <div key={k} className="bg-surface px-3 py-3">
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: CATEGORY_COLOR[k] }} />
              <span className="text-xs font-medium">{CATEGORY_LABEL[k]}</span>
            </div>
            <p className="num mt-1.5 text-xl font-medium">
              {n} <span className="text-xs font-normal text-muted">/ {totalFail}</span>
            </p>
            <p className="mt-1 text-xs leading-snug text-ink-2">{DEFINITIONS[k].def}</p>
          </div>
        ))}
      </div>

                <div className="grid gap-4">
        <Section id="by-config" title="Failure categories per configuration" description="Configs with similar pass rates can fail for different reasons.">
          <FailureStack configs={configs} judgeAvailable={judgeAvailable} />
        </Section>

</div>
              </>
            ),
          },
          {
            value: "where",
            label: "Where it goes wrong",
            hint: "step and task",
            content: (
              <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            id="divergence"
            title="First divergence step"
            description="The step (0-based) where a run first departed from the reference pipeline."
          >
            <DivergenceHist hist={failures.first_divergence} configs={configs} />
            <table className="mt-3 w-full text-[13px]">
              <caption className="sr-only">Mean first divergence step per configuration</caption>
              <tbody>
                {configs
                  .filter((c) => c.mean_first_div !== null)
                  .map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-2">{c.label}</th>
                      <td className="num py-1.5 text-right">mean step {c.mean_first_div?.toFixed(1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Section>

          <Section id="by-task" title="Failures by task" description="Which tasks trigger which failure mode.">
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[460px] text-[12px]">
                <thead>
                  <tr className="border-b border-border-strong text-2xs uppercase tracking-[0.06em] text-muted">
                    <th scope="col" className="py-1.5 text-left font-medium">Task</th>
                    {CATEGORIES.map((k) => (
                      <th key={k} scope="col" className="py-1.5 text-center font-medium" title={CATEGORY_LABEL[k]}>
                        <span aria-hidden className="mx-auto block h-2.5 w-2.5 rounded-[2px]" style={{ background: CATEGORY_COLOR[k] }} />
                        <span className="sr-only">{CATEGORY_LABEL[k]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <th scope="row" className="py-1.5 text-left font-normal">
                        <Link href={`/tasks/${t.id}`} className="hover:text-accent">
                          <span className="num text-muted">{t.id}</span> {t.title}
                        </Link>
                      </th>
                      {CATEGORIES.map((k) => {
                        const n = failures.by_task[t.id]?.[k] ?? 0;
                        return (
                          <td key={k} className={`num py-1.5 text-center ${n ? "text-ink" : "text-border-strong"}`}>
                            {n ? (
                              <Link href={`/trajectories?task=${t.id}&category=${k}`} className="hover:text-accent hover:underline">
                                {n}
                              </Link>
                            ) : (
                              "·"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

              </div>
            ),
          },
          {
            value: "trust",
            label: "Label quality",
            hint: "judge vs rules vs gold",
            content: (
              <div className="grid gap-4">
        <Section
          id="disagreement"
          title="Judge / rule disagreement"
          description="Where the Gemini judge and the rules disagree, both labels are shown and the run is flagged."
        >
          {judgeAvailable ? (
            disagreeRows.length ? (
              <DisagreeTable rows={disagreeRows} labelOf={labelOf} />
            ) : (
              <p className="text-[13px] text-ink-2">The judge and the rules agree on every labeled failure.</p>
            )
          ) : (
            <div className="grid gap-3">
              <Note tone="warn">
                No judge labels in this export yet, so there is nothing to disagree with. Run{" "}
                <code className="font-mono">python -m bench.judge</code> with <code className="font-mono">GEMINI_API_KEY</code> set, then{" "}
                <code className="font-mono">python -m bench.export</code>. On the{" "}
                <Link href="/live" className="text-accent hover:underline">Live run</Link> page the judge runs per failure when a key is configured.
              </Note>
              <p className="text-[13px] text-ink-2">
                Meanwhile, a related ambiguity is visible: {failures.multi_fault.length} SIMULATED failures had more than one injected
                fault, and the rules must pick a single root cause. These are the runs a judge is most likely to label differently.
              </p>
              <MultiFaultTable rows={failures.multi_fault} labelOf={labelOf} />
            </div>
          )}
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section id="signals" title="Rule signals" description="'Latent' = fired on a run that still passed.">
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[420px] text-[12px]">
                <thead>
                  <tr className="border-b border-border-strong text-2xs uppercase tracking-[0.06em] text-muted">
                    <th scope="col" className="py-1.5 text-left font-medium">Signal</th>
                    <th scope="col" className="py-1.5 text-left font-medium">Category</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Failed</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Latent</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.signals.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0 align-top">
                      <td className="py-1.5 pr-2">
                        <Link href={`/trajectories/${s.example_id}`} className="font-mono text-[11.5px] hover:text-accent hover:underline" title={s.example}>
                          {s.id}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-2">
                        <CategoryTag category={s.category} />
                      </td>
                      <td className="num py-1.5 text-right">{s.n_fail}</td>
                      <td className="num py-1.5 text-right text-muted">{s.n_latent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="gold" title="Gold set" description={`${gold.n} hand-labeled failures used to score both labelers.`}>
            <div className="-mx-4 max-h-[420px] overflow-auto px-4">
              <table className="w-full min-w-[520px] text-[12px]">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border-strong text-2xs uppercase tracking-[0.06em] text-muted">
                    <th scope="col" className="py-1.5 text-left font-medium">Run</th>
                    <th scope="col" className="py-1.5 text-left font-medium">Gold</th>
                    <th scope="col" className="py-1.5 text-left font-medium">Rule</th>
                    <th scope="col" className="py-1.5 text-left font-medium">Judge</th>
                    <th scope="col" className="py-1.5 text-right font-medium" title="first divergence step: gold / rule / judge">Div. step</th>
                  </tr>
                </thead>
                <tbody>
                  {gold.rows.map((g) => (
                    <tr key={g.id} className="border-b border-border last:border-0 align-top">
                      <td className="py-1.5 pr-2">
                        <Link href={`/trajectories/${g.id}`} className="num text-[11.5px] hover:text-accent hover:underline" title={g.rationale}>
                          {g.id.split("__").slice(0, 1)}<span className="text-muted"> · {g.id.split("__").slice(1).join(" · ")}</span>
                        </Link>
                      </td>
                      <td className="py-1.5 pr-2"><CategoryTag category={g.gold} /></td>
                      <td className="py-1.5 pr-2">
                        <Verdict ok={g.rule === g.gold}><CategoryTag category={g.rule} muted={g.rule === g.gold} /></Verdict>
                      </td>
                      <td className="py-1.5 pr-2">
                        {g.judge ? <Verdict ok={g.judge === g.gold}><CategoryTag category={g.judge} muted={g.judge === g.gold} /></Verdict> : <span className="text-muted">pending</span>}
                      </td>
                      <td className="num whitespace-nowrap py-1.5 text-right">
                        {g.gold_first_div ?? "—"} / {g.rule_first_div ?? "—"} / {g.judge_first_div ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      {!ok && <span className="rounded-sm bg-fail-soft px-1 text-[10px] font-medium text-fail">≠ gold</span>}
    </span>
  );
}

function DisagreeTable({ rows, labelOf }: { rows: ReturnType<typeof getIndex>; labelOf: Record<string, string> }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-border-strong text-2xs uppercase tracking-[0.06em] text-muted">
            <th scope="col" className="py-1.5 text-left font-medium">Run</th>
            <th scope="col" className="py-1.5 text-left font-medium">Rule label</th>
            <th scope="col" className="py-1.5 text-left font-medium">Judge label</th>
            <th scope="col" className="py-1.5 text-right font-medium">Divergence step (rule / judge)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="py-1.5">
                <Link href={`/trajectories/${r.id}`} className="hover:text-accent hover:underline">
                  {labelOf[r.config_id]} <span className="num text-muted">· {r.task_id} · r{r.run_idx}</span>
                </Link>
              </td>
              <td className="py-1.5"><CategoryTag category={r.rule_category} /></td>
              <td className="py-1.5"><CategoryTag category={r.judge_category} /></td>
              <td className="num py-1.5 text-right">{r.rule_first_div ?? "—"} / {r.judge_first_div ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MultiFaultTable({ rows, labelOf }: { rows: ReturnType<typeof getFailures>["multi_fault"]; labelOf: Record<string, string> }) {
  return (
    <div className="-mx-4 max-h-[320px] overflow-auto px-4">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border-strong text-2xs uppercase tracking-[0.06em] text-muted">
            <th scope="col" className="py-1.5 text-left font-medium">Run</th>
            <th scope="col" className="py-1.5 text-left font-medium">Injected fault categories</th>
            <th scope="col" className="py-1.5 text-left font-medium">Rule picked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 align-top">
              <td className="py-1.5">
                <Link href={`/trajectories/${r.id}`} className="hover:text-accent hover:underline">
                  {labelOf[r.config_id]} <span className="num text-muted">· {r.task_id}</span>
                </Link>
              </td>
              <td className="py-1.5">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {r.injected.map((c) => (
                    <CategoryTag key={c} category={c as Category} />
                  ))}
                </div>
              </td>
              <td className="py-1.5"><CategoryTag category={r.rule} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
