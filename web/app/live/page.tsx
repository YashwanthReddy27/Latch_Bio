import { Suspense } from "react";
import type { Metadata } from "next";
import { getConfigs, getReplays, getTasks } from "@/lib/data";
import { PageHeader } from "@/components/ui/primitives";
import { LiveRunner } from "@/components/live/live-runner";

export const metadata: Metadata = { title: "Live run" };

export default function LivePage() {
  const { tasks } = getTasks();
  return (
    <>
      <PageHeader eyebrow="Live run" title="Watch an agent analyze the screen">
        <p>
          Gemini plans each step through a server route (the API key never reaches the browser). Code runs in a Pyodide sandbox in your
          browser, the TypeScript port of the deterministic grader scores the answer, and failed runs go to the Gemini judge.
        </p>
      </PageHeader>
      <Suspense fallback={<p className="text-ink-2">Loading…</p>}>
        <LiveRunner tasks={tasks} configs={getConfigs()} replays={getReplays()} />
      </Suspense>
    </>
  );
}
