"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Category, ConfigRow } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { pct, usd } from "@/lib/format";
import { CategoryTag, KindBadge } from "@/components/ui/primitives";

type SortKey = "pass_rate" | "mean_cost" | "mean_tokens" | "mean_steps" | "mean_wall_s" | "n";

const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: "pass_rate", label: "Pass rate (95% CI)", title: "Share of runs whose answer passed the deterministic grader. Wilson score interval." },
  { key: "n", label: "Runs", title: "Trajectories in the sweep (12 tasks × runs per task)" },
  { key: "mean_cost", label: "Mean cost", title: "Mean USD per trajectory. SIMULATED costs are estimated from text length and a price table." },
];

function topFailure(c: ConfigRow): Category | null {
  let best: Category | null = null;
  for (const k of CATEGORIES) if ((c.failures[k] ?? 0) > 0 && (!best || c.failures[k] > c.failures[best])) best = k;
  return best;
}

export function Leaderboard({ configs }: { configs: ConfigRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "pass_rate", desc: true });
  const rows = useMemo(
    () => [...configs].sort((a, b) => (sort.desc ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key])),
    [configs, sort],
  );
  const toggle = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[600px] border-collapse text-left text-[13px]">
        <caption className="sr-only">Leaderboard of model × harness configurations; click a column header to sort.</caption>
        <thead>
          <tr className="border-b border-border-strong text-2xs uppercase tracking-[0.06em] text-muted">
            <th scope="col" className="w-8 py-2 pr-2 font-medium">#</th>
            <th scope="col" className="py-2 pr-3 font-medium">Configuration</th>
            {COLS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`py-2 pr-3 font-medium ${c.key === "pass_rate" ? "w-[230px]" : "text-right"}`}
                aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}
              >
                <button type="button" onClick={() => toggle(c.key)} title={c.title} className="inline-flex items-center gap-1 uppercase hover:text-ink">
                  {c.label}
                  {sort.key === c.key && (sort.desc ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden />)}
                </button>
              </th>
            ))}
            <th scope="col" className="py-2 font-medium">Top failure</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-2">
              <td className="num py-2.5 pr-2 text-muted">{i + 1}</td>
              <td className="py-2.5 pr-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/trajectories?config=${encodeURIComponent(c.id)}`} className="font-medium hover:text-accent hover:underline">
                    {c.label}
                  </Link>
                  <KindBadge kind={c.kind} />
                </div>
                <p className="mt-0.5 text-xs text-muted">{c.harness}</p>
              </td>
              <td className="py-2.5 pr-3">
                <PassRateBar rate={c.pass_rate} ci={c.ci} />
              </td>
              <td className="num py-2.5 pr-3 text-right text-ink-2">{c.n}</td>
              <td className="num py-2.5 pr-3 text-right">{c.kind === "BASELINE" ? <span className="text-muted">n/a</span> : usd(c.mean_cost)}</td>
              <td className="py-2.5">{c.n_pass === c.n ? <span className="text-xs text-muted">none</span> : <CategoryTag category={topFailure(c)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PassRateBar({ rate, ci }: { rate: number; ci: [number, number] }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="num w-10 text-right font-medium">{pct(rate)}</span>
      <div className="relative h-3 flex-1" aria-hidden>
        <div className="absolute inset-y-[5px] left-0 right-0 rounded-full bg-surface-3" />
        <div className="absolute inset-y-[5px] left-0 rounded-full bg-accent" style={{ width: `${rate * 100}%` }} />
        <div
          className="absolute inset-y-0 border-x border-ink-2"
          style={{ left: `${ci[0] * 100}%`, width: `${Math.max(0.5, (ci[1] - ci[0]) * 100)}%` }}
        />
        <div className="absolute top-1/2 h-px bg-ink-2" style={{ left: `${ci[0] * 100}%`, width: `${(ci[1] - ci[0]) * 100}%` }} />
      </div>
      <span className="num w-[74px] text-[11px] text-muted">
        {pct(ci[0])}–{pct(ci[1])}
      </span>
    </div>
  );
}
