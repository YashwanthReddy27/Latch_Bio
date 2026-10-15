import { Suspense } from "react";
import type { Metadata } from "next";
import { getConfigs } from "@/lib/data";
import { PageHeader } from "@/components/ui/primitives";
import { CompareView } from "@/components/trajectory/compare-view";

export const metadata: Metadata = { title: "Compare trajectories" };

export default function ComparePage() {
  const labels = Object.fromEntries(getConfigs().map((c) => [c.id, c.label]));
  return (
    <>
      <PageHeader eyebrow="Compare" title="Side-by-side trajectories">
        <p>Steps are aligned by pipeline stage, so skipped or different stages stand out.</p>
      </PageHeader>
      <Suspense fallback={<p className="text-ink-2">Loading…</p>}>
        <CompareView labels={labels} />
      </Suspense>
    </>
  );
}
