import Link from "next/link";
import { getConfigs, getFailures, getMeta, getTasks } from "@/lib/data";
import { Leaderboard } from "@/components/charts/leaderboard";
import { CostScatter } from "@/components/charts/cost-scatter";
import { TaskHeatmap } from "@/components/charts/task-heatmap";
import { PageTabs } from "@/components/ui/tabs";
import { ButtonLink, Note, PageHeader, Stat } from "@/components/ui/primitives";
import { compact, pct, secs, usd } from "@/lib/format";

export default function OverviewPage() {
  const meta = getMeta();
  const configs = getConfigs();
  const { tasks } = getTasks();
  const failures = getFailures();
  const gold = failures.agreement.gold;
  const rvi = failures.agreement.rule_vs_injected;
  const jvr = failures.agreement.judge_vs_rule;
  const nReal = configs.filter((c) => c.kind === "REAL").length;
  const models = configs.filter((c) => c.kind !== "BASELINE");
  const best = [...models].sort((a, b) => b.pass_rate - a.pass_rate)[0];
  const labelAcc = gold.judge_n ? gold.judge_correct / gold.judge_n : gold.n ? gold.rule_correct / gold.n : null;

  return (
    <>
      <PageHeader eyebrow="Overview" title="CRISPRScreenBench-mini">
        <p>
          How well do AI agents analyze a pooled CRISPR screen, and why do they fail?{" "}
          <Link href="/failures" className="text-accent hover:underline">
            See the failure taxonomy →
          </Link>
        </p>
      </PageHeader>

      {nReal === 0 && (
        <div className="mb-4">
          <Note tone="warn">Model rows are SIMULATED until real Gemini runs are added.</Note>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Runs" value={meta.n_trajectories} sub={`${meta.n_configs} configs · ${meta.n_tasks} tasks`} />
        <Stat label="Best model config" value={best ? pct(best.pass_rate) : "—"} sub={best?.label ?? "no model runs"} />
        <Stat label="Failed runs" value={meta.n_failures} sub={`${pct(meta.n_failures / meta.n_trajectories)} of all runs`} />
        <Stat
          label={gold.judge_n ? "Judge accuracy" : "Label accuracy"}
          value={labelAcc === null ? "—" : pct(labelAcc)}
          sub={gold.n ? `vs ${gold.n} hand-labeled failures` : "no gold set"}
        />
      </div>

      <PageTabs
        label="Overview views"
        items={[
          {
            value: "leaderboard",
            label: "Leaderboard",
            hint: "pass rate per config",
            content: (
              <Panel
                note="Wilson 95% intervals. Overlapping intervals are not a ranking."
                action={<ButtonLink href="/trajectories">All runs</ButtonLink>}
              >
                <Leaderboard configs={configs} />
              </Panel>
            ),
          },
          {
            value: "tasks",
            label: "By task",
            hint: "where configs differ",
            content: (
              <Panel note="QC tasks (T01–T04) are easy. Direction, baseline and essential-gene traps (T08–T12) separate configs.">
                <TaskHeatmap configs={configs} tasks={tasks} />
              </Panel>
            ),
          },
          {
            value: "cost",
            label: "Cost",
            hint: "price vs accuracy",
            content: (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Panel note="Mean cost per run, log scale. Dashed lines are the scripted baselines.">
                  <CostScatter configs={configs} />
                </Panel>
                <Panel note="Per-run averages.">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border-strong text-left text-2xs uppercase tracking-[0.06em] text-muted">
                        <th scope="col" className="py-1.5 font-medium">Config</th>
                        <th scope="col" className="py-1.5 text-right font-medium">Cost</th>
                        <th scope="col" className="py-1.5 text-right font-medium">Tokens</th>
                        <th scope="col" className="py-1.5 text-right font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((c) => (
                        <tr key={c.id} className="border-b border-border last:border-0">
                          <th scope="row" className="py-1.5 text-left font-normal">{c.label}</th>
                          <td className="num py-1.5 text-right">{usd(c.mean_cost)}</td>
                          <td className="num py-1.5 text-right">{compact(c.mean_tokens)}</td>
                          <td className="num py-1.5 text-right">{secs(c.mean_wall_s)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              </div>
            ),
          },
          {
            value: "trust",
            label: "Label quality",
            hint: "can the labels be trusted?",
            content: (
              <Panel note="Rule labels and the LLM judge are both scored against a hand-labeled gold set.">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="Rules vs gold"
                    value={gold.n ? `${gold.rule_correct}/${gold.n}` : "—"}
                    sub={`divergence step ±1: ${gold.rule_div_within1}/${gold.n}`}
                  />
                  <Stat
                    label="Gemini judge vs gold"
                    value={gold.judge_n ? `${gold.judge_correct}/${gold.judge_n}` : "pending"}
                    sub={gold.judge_n ? meta.judge.models.join(", ") : "needs a Gemini key"}
                    tone={gold.judge_n ? undefined : "warn"}
                  />
                  {rvi.n ? (
                    <Stat label="Rules vs injected fault" value={`${rvi.agree}/${rvi.n}`} sub="sanity check (SIMULATED)" />
                  ) : (
                    <Stat label="Judge vs rules" value={jvr.n ? `${jvr.agree}/${jvr.n}` : "pending"} sub="all failed runs" />
                  )}
                </div>
                <p className="mt-3 text-xs text-muted">
                  Disagreements are listed in{" "}
                  <Link href="/failures#trust" className="text-accent hover:underline">
                    Failure taxonomy → Label quality
                  </Link>
                  .
                </p>
              </Panel>
            ),
          },
        ]}
      />
    </>
  );
}

function Panel({ note, action, children }: { note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded border border-border bg-surface p-4">
      {(note || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {note && <p className="text-xs text-muted">{note}</p>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
