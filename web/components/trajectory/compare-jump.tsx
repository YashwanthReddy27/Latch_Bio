"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/primitives";

export function CompareJump({
  current,
  siblings,
  configLabels,
}: {
  current: string;
  siblings: { id: string; config_id: string; run_idx: number; passed: boolean }[];
  configLabels: Record<string, string>;
}) {
  const router = useRouter();
  // default to the first sibling with the opposite verdict: the most informative diff
  const [other, setOther] = useState(siblings[0]?.id ?? "");
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (other) router.push(`/compare?a=${encodeURIComponent(current)}&b=${encodeURIComponent(other)}`);
      }}
    >
      <label htmlFor="cmp" className="sr-only">
        Trajectory to compare with
      </label>
      <select
        id="cmp"
        value={other}
        onChange={(e) => setOther(e.target.value)}
        className="min-w-0 flex-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs"
      >
        {siblings.map((s) => (
          <option key={s.id} value={s.id}>
            {configLabels[s.config_id] ?? s.config_id} · r{s.run_idx} · {s.passed ? "pass" : "fail"}
          </option>
        ))}
      </select>
      <button type="submit" className={buttonClass("primary")}>
        Side-by-side
      </button>
    </form>
  );
}
