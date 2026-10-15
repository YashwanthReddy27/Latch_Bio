import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConfigs, getIndex, getTasks, getTrajectory, listTrajectoryIds } from "@/lib/data";
import { KindBadge, PassChip, buttonClass } from "@/components/ui/primitives";
import { GraderPanel, LabelPanel } from "@/components/trajectory/panels";
import { Timeline } from "@/components/trajectory/timeline";
import { CompareJump } from "@/components/trajectory/compare-jump";
import { compact, secs, usd } from "@/lib/format";

export const dynamicParams = false;

export function generateStaticParams() {
  return listTrajectoryIds().map((id) => ({ id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return { title: params.id.replaceAll("__", " · ") };
}

export default function TrajectoryPage({ params }: { params: { id: string } }) {
  const traj = getTrajectory(params.id);
  if (!traj) notFound();
  const cfg = getConfigs().find((c) => c.id === traj.config_id);
  const task = getTasks().tasks.find((t) => t.id === traj.task_id);
  const siblings = getIndex()
    .filter((r) => r.task_id === traj.task_id && r.id !== traj.id)
    .map((r) => ({ id: r.id, config_id: r.config_id, run_idx: r.run_idx, passed: r.passed }))
    // opposite verdict first: a pass/fail pair on the same task is the most informative diff
    .sort((x, y) => Number(x.passed === traj.passed) - Number(y.passed === traj.passed));
  const configLabels = Object.fromEntries(getConfigs().map((c) => [c.id, c.label]));
  const t = traj.totals;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-muted">
        <Link href="/trajectories" className="hover:text-accent">Trajectories</Link>
        <span className="mx-1.5">/</span>
        <span className="num">{traj.id.replaceAll("__", " · ")}</span>
      </nav>

      <header className="mb-4 rounded border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{cfg?.label ?? traj.config_id}</h1>
          <KindBadge kind={traj.kind} />
          <PassChip passed={traj.passed} />
          <span className="text-xs text-muted">run {traj.run_idx} · {traj.status.replace("_", " ")}</span>
        </div>
        <p className="mt-1 text-[13px] text-ink-2">
          <Link href={`/tasks/${traj.task_id}`} className="font-medium text-ink hover:text-accent">
            <span className="num">{traj.task_id}</span> {task?.title}
          </Link>
          {task && <span className="text-muted">: {task.prompt}</span>}
        </p>
        <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          {[
            ["steps", `${t.n_steps} / 25`],
            ["tokens", traj.kind === "BASELINE" ? "n/a" : compact(t.tokens_in + t.tokens_out + t.tokens_thinking)],
            ["cost", traj.kind === "BASELINE" ? "n/a" : usd(t.cost_usd)],
            ["model time", secs(t.model_latency_s)],
            ["exec time", secs(t.exec_s)],
            ["harness", traj.harness],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-1.5">
              <dt className="text-muted">{k}</dt>
              <dd className="num text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {traj.kind === "SIMULATED" && (
          <p className="mt-2 text-[11.5px] text-muted">
            SIMULATED: the agent&apos;s decisions are scripted with injected mistakes; every code cell was really executed in the sandbox.
            Token, cost and latency figures are estimates.
          </p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-2 min-w-0 lg:order-1">
          <Timeline traj={traj} />
        </div>
        <aside className="order-1 grid content-start gap-3 lg:sticky lg:top-16 lg:order-2 lg:max-h-[calc(100vh-5rem)] lg:overflow-auto">
          <GraderPanel grade={traj.grade} />
          <LabelPanel traj={traj} />
          <section className="rounded border border-border bg-surface px-3 py-2.5" aria-label="Compare">
            <h2 className="text-[13px] font-semibold">Compare on {traj.task_id}</h2>
            <CompareJump current={traj.id} siblings={siblings} configLabels={configLabels} />
            <a href={`/data/traj/${traj.id}.json`} download className={`${buttonClass("ghost")} mt-2 -ml-2.5`}>
              Download raw JSON
            </a>
          </section>
        </aside>
      </div>
    </>
  );
}
