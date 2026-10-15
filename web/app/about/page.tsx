import Link from "next/link";
import type { Metadata } from "next";
import { getConfigs, getMeta } from "@/lib/data";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  const meta = getMeta();
  const hasSim = getConfigs().some((c) => c.kind === "SIMULATED");
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="About" title="Helix Trace in one page" />

      <div className="grid gap-6 text-[14px] leading-relaxed text-ink-2">
        <section>
          <h2 className="mb-1.5 text-[15px] font-semibold text-ink">What it is</h2>
          <p>
            An agent-trajectory explorer plus a small benchmark. <strong className="font-medium text-ink">CRISPRScreenBench-mini</strong> is 12
            verifiable tasks on a seeded synthetic pooled CRISPR knockout screen (QC, statistics, problem interpretation, biology), each graded
            by a deterministic checker. <strong className="font-medium text-ink">Helix Trace</strong> is the UI for asking <em>why</em> an agent failed:
            leaderboard, failure taxonomy, step-by-step trajectories, diffs, and a live runner.
          </p>
        </section>

        <section>
          <h2 className="mb-1.5 text-[15px] font-semibold text-ink">Why it matters</h2>
          <p>
            Bio-analysis benchmarks like LatchBio&apos;s scBench and SpatialBench report that agents produce plausible analyses yet fail on problem
            interpretation, statistical reasoning and biological interpretation. A pass rate says <em>that</em> they fail; this tool shows{" "}
            <em>where</em> each run first went wrong, with evidence lines, and checks the labels against an injected-fault ground truth and a gold
            set instead of trusting an LLM judge blindly. Pooled CRISPR screens are a domain those benchmarks don&apos;t cover yet.
          </p>
        </section>

        <section>
          <h2 className="mb-1.5 text-[15px] font-semibold text-ink">How it works</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <span className="text-ink">Data.</span> numpy generates 2,000 genes × 4 sgRNAs with negative-binomial counts, planted essential genes, 30
              drug hits, guide noise, zero-count guides and one bottlenecked replicate.
            </li>
            <li>
              <span className="text-ink">Graders.</span> Declarative checks (tolerances, set overlap, exact categories), implemented in Python and
              TypeScript and held to identical verdicts by a shared fixture file.
            </li>
            <li>
              <span className="text-ink">Harness.</span> A 25-step agent loop with a sandboxed Python tool. Scripted baselines
              {hasSim
                ? ", SIMULATED configs (the correct pipeline with mistakes injected at controlled rates, all code really executed) and REAL Gemini runs."
                : " and REAL Gemini runs."}
            </li>
            <li>
              <span className="text-ink">Labels.</span> Rule-based signals plus an optional Gemini judge with a structured-output schema; both are
              cached to JSON so this site needs no backend.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="mb-1.5 text-[15px] font-semibold text-ink">What is real here</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>The screen data is synthetic. Gene symbols and pathway biology are realistic (MMR loss → resistance to an alkylator), but the numbers are planted.</li>
            {hasSim && <li>SIMULATED configs are not models. Their decisions are scripted; their tokens and costs are estimates.</li>}
            <li>
              {meta.n_real
                ? `${meta.n_real} REAL runs (${meta.real_models.join(", ")}) are included.`
                : "No REAL Gemini runs are in this export yet; the harness and judge are wired and run with one command once a key is set."}
            </li>
            <li>The gold labels were drafted by an AI assistant, blind to the rule output, and still need human review.</li>
          </ul>
        </section>

        <section className="rounded border border-border bg-surface px-4 py-3 text-[13px]">
          <p>
            Start at the{" "}
            <Link href="/" className="text-accent hover:underline">Overview</Link>, then{" "}
            <Link href="/failures" className="text-accent hover:underline">Failure taxonomy</Link>, or open the{" "}
            <Link href="/live" className="text-accent hover:underline">Live run</Link>. The full README in the repository covers adding tasks, running
            the harness, regenerating data and deployment.
          </p>
          <p className="mt-2 text-xs text-muted">
            Synthetic screen data and simulated agent runs for demonstration. Not affiliated with LatchBio.
          </p>
        </section>
      </div>
    </div>
  );
}
