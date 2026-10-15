import Link from "next/link";
import type { Metadata } from "next";
import { getConfigs, getMeta } from "@/lib/data";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  const meta = getMeta();
  const hasSim = getConfigs().some((c) => c.kind === "SIMULATED");
  const items: [string, React.ReactNode][] = [
    ["What", "A benchmark of 12 CRISPR-screen analysis tasks, plus a viewer that shows why AI agents fail them."],
    ["Why", "Agents write plausible analyses but misread questions, skip QC and misuse statistics. This shows where each run went wrong."],
    ["How", "Synthetic screen with planted answers → agent runs in a Python sandbox → deterministic grader → failure label."],
    [
      "Honest notes",
      <>
        The data is synthetic.
        {hasSim ? " SIMULATED runs are scripted stand-ins, not models." : ""}
        {meta.n_real ? ` ${meta.n_real} REAL Gemini runs included.` : " No REAL Gemini runs yet."} Not affiliated with LatchBio.
      </>,
    ],
  ];
  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="About" title="Helix Trace" />
      <dl className="divide-y divide-border rounded border border-border bg-surface">
        {items.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[120px_1fr] sm:gap-4">
            <dt className="text-[13px] font-semibold">{k}</dt>
            <dd className="text-[13px] text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[13px] text-ink-2">
        Start with the <Link href="/" className="text-accent hover:underline">Overview</Link>, then{" "}
        <Link href="/failures" className="text-accent hover:underline">Failure taxonomy</Link>. Details are in the repository README.
      </p>
    </div>
  );
}
