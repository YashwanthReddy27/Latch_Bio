import Link from "next/link";
import { getConfigs, getFailures, getMeta, getTasks } from "@/lib/data";
import { Leaderboard } from "@/components/charts/leaderboard";
import { CostScatter } from "@/components/charts/cost-scatter";
import { TaskHeatmap } from "@/components/charts/task-heatmap";
import { ButtonLink, Note, PageHeader, Section, Stat } from "@/components/ui/primitives";
import { pct } from "@/lib/format";

export default function OverviewPage() {
  const meta = getMeta();
  const configs = getConfigs();
  const { tasks } = getTasks();
  const failures = getFailures();
  const gold = failures.agreement.gold;
  const rvi = failures.agreement.rule_vs_injected;
  const jvr = failures.agreement.judge_vs_rule;
  const nSim = configs.filter((c) => c.kind === "SIMULATED").length;
  const nBase = configs.filter((c) => c.kind === "BASELINE").length;
  const nReal = configs.filter((c) => c.kind === "REAL").length;

  return (
    <>
      <PageHeader eyebrow="Overview" title="CRISPRScreenBench-mini sweep">
        <p>
          {meta.n_trajectories} agent trajectories on {meta.n_tasks} verifiable pooled-CRISPR-screen analysis tasks, scored by
          deterministic graders. {nBase} scripted baselines, {nSim} SIMULATED configs
          {nReal ? `, ${nReal} REAL Gemini configs` : ""}. Every failure is labeled by rules
          {meta.judge.n_labeled ? " and an LLM judge" : ""}; see{" "}
          <Link href="/failures" className="text-accent underline-offset-2 hover:underline">
            why agents fail
          </Link>
          .
        </p>
      </PageHeader>

      {nReal === 0 && (
        <div className="mb-4">
          <Note tone="warn">
            No REAL runs in this export yet. Model rows are SIMULATED (scripted pipelines with injected mistakes at controlled
            rates, executed for real in the sandbox). Run <code className="font-mono">python -m bench.run --model gemini</code> with
            a Gemini key to add REAL rows.
          </Note>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Trajectories" value={meta.n_trajectories} sub={`${meta.n_configs} configs × ${meta.n_tasks} tasks`} />
        <Stat label="Failures labeled" value={meta.n_failures} sub={`${pct(meta.n_failures / meta.n_trajectories)} of runs`} />
        <Stat
          label="Rule label ↔ injected fault"
          value={rvi.n ? pct(rvi.agree / rvi.n) : "—"}
          sub={`${rvi.agree}/${rvi.n} SIMULATED failures`}
        />
        <Stat
          label="Judge accuracy (gold)"
          value={gold.judge_n ? pct(gold.judge_correct / gold.judge_n) : "pending"}
          sub={gold.judge_n ? `${gold.judge_correct}/${gold.judge_n} hand-labeled failures` : "judge not yet run on gold set"}
          tone={gold.judge_n ? undefined : "warn"}
        />
        <Stat
          label="Rule accuracy (gold)"
          value={gold.n ? pct(gold.rule_correct / gold.n) : "—"}
          sub={gold.n ? `${gold.rule_correct}/${gold.n} · judge↔rule ${jvr.n ? pct(jvr.agree / jvr.n) : "n/a"}` : "no gold labels"}
        />
      </div>

      <div className="grid gap-4">
        <Section
          id="leaderboard"
          title="Leaderboard"
          description="Pass rate with Wilson 95% interval. With 36–60 runs per config the intervals are wide; overlapping bars are not a ranking."
          actions={<ButtonLink href="/trajectories">All trajectories</ButtonLink>}
        >
          <Leaderboard configs={configs} />
        </Section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <Section id="cost" title="Cost vs pass rate" description="Mean USD per trajectory on a log axis. Baselines are scripted (no tokens) and drawn as reference lines.">
            <CostScatter configs={configs} />
          </Section>
          <Section id="judge" title="Can the failure labels be trusted?" description="Two independent labelers plus a gold set. Disagreements are surfaced, not hidden.">
            <JudgeAgreement gold={gold} rvi={rvi} jvr={jvr} judgeModels={meta.judge.models} />
          </Section>
        </div>

        <Section
          id="heatmap"
          title="Pass rate by task"
          description="Rows are configurations, columns are tasks. QC tasks (T01–T04) are easy; direction, baseline and essential-gene traps (T08–T12) separate configs."
        >
          <TaskHeatmap configs={configs} tasks={tasks} />
        </Section>
      </div>
    </>
  );
}

function JudgeAgreement({
  gold,
  rvi,
  jvr,
  judgeModels,
}: {
  gold: ReturnType<typeof getFailures>["agreement"]["gold"];
  rvi: { n: number; agree: number };
  jvr: { n: number; agree: number };
  judgeModels: string[];
}) {
  const rows = [
    {
      k: "Rule labels vs injected fault",
      v: rvi.n ? `${rvi.agree}/${rvi.n}` : "—",
      note: "Sanity check only: the rules were written knowing the mistake catalog.",
    },
    {
      k: "Rule labels vs gold",
      v: gold.n ? `${gold.rule_correct}/${gold.n}` : "—",
      note: `First-divergence step within ±1 of gold in ${gold.rule_div_within1}/${gold.n}.`,
    },
    {
      k: "Gemini judge vs gold",
      v: gold.judge_n ? `${gold.judge_correct}/${gold.judge_n}` : "pending",
      note: gold.judge_n ? `Judge: ${judgeModels.join(", ")}` : "Run python -m bench.judge with GEMINI_API_KEY to fill this in.",
    },
    {
      k: "Judge vs rule (all failures)",
      v: jvr.n ? `${jvr.agree}/${jvr.n}` : "pending",
      note: "Every disagreement is flagged in the Failure taxonomy view.",
    },
  ];
  return (
    <div>
      <dl className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.k} className="grid grid-cols-[1fr_auto] gap-x-4 py-2.5 first:pt-0">
            <dt className="text-[13px] text-ink">{r.k}</dt>
            <dd className="num text-right text-[15px] font-medium">{r.v}</dd>
            <p className="col-span-2 mt-0.5 text-xs text-muted">{r.note}</p>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">
        Gold set: {gold.n} failures, {gold.labeler || "hand-labeled"}.{" "}
        <Link href="/failures#gold" className="text-accent hover:underline">
          Inspect gold rows
        </Link>
      </p>
    </div>
  );
}
