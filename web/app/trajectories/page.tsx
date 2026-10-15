import { Suspense } from "react";
import type { Metadata } from "next";
import { getConfigs, getIndex, getTasks } from "@/lib/data";
import { PageHeader, Section } from "@/components/ui/primitives";
import { TrajectoryTable } from "@/components/trajectory/trajectory-table";

export const metadata: Metadata = { title: "Trajectories" };

export default function TrajectoriesPage() {
  const rows = getIndex();
  const configs = getConfigs();
  const taskIds = getTasks().tasks.map((t) => t.id);
  return (
    <>
      <PageHeader eyebrow="Trajectories" title="Every run, step by step">
        <p>Open a run to see its steps and why it failed. Tick two to compare.</p>
      </PageHeader>
      <Section title="Runs">
        <Suspense fallback={<p className="text-ink-2">Loading table…</p>}>
          <TrajectoryTable rows={rows} configs={configs} taskIds={taskIds} />
        </Suspense>
      </Section>
    </>
  );
}
