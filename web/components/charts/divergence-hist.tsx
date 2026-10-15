"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ConfigRow } from "@/lib/types";

export function DivergenceHist({ hist, configs }: { hist: Record<string, Record<string, number>>; configs: ConfigRow[] }) {
  const [cfg, setCfg] = useState<string>("all");
  const data = useMemo(() => {
    const acc: Record<number, number> = {};
    for (const [cid, h] of Object.entries(hist)) {
      if (cfg !== "all" && cid !== cfg) continue;
      for (const [step, n] of Object.entries(h)) acc[Number(step)] = (acc[Number(step)] ?? 0) + n;
    }
    const max = Math.max(12, ...Object.keys(acc).map(Number));
    return Array.from({ length: max + 1 }, (_, i) => ({ step: i, n: acc[i] ?? 0 }));
  }, [hist, cfg]);
  const total = data.reduce((s, d) => s + d.n, 0);
  const median = useMemo(() => {
    let c = 0;
    for (const d of data) {
      c += d.n;
      if (c >= total / 2) return d.step;
    }
    return null;
  }, [data, total]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Configuration
          <select
            value={cfg}
            onChange={(e) => setCfg(e.target.value)}
            className="rounded border border-border-strong bg-surface px-2 py-1 text-xs text-ink"
          >
            <option value="all">All configurations</option>
            {configs
              .filter((c) => hist[c.id])
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <p className="num text-xs text-muted">
          n = {total} failures · median step {median ?? "—"}
        </p>
      </div>
      <div className="h-[220px] w-full" role="img" aria-label={`Histogram of first-divergence step for ${cfg === "all" ? "all configurations" : cfg}; median step ${median}`}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 20, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="step"
              tickLine={false}
              axisLine={{ stroke: "var(--border-strong)" }}
              interval={1}
              label={{ value: "trajectory step where the agent first diverged", position: "insideBottom", offset: -12, fill: "var(--muted)", fontSize: 11 }}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="num rounded border border-border-strong bg-surface px-2.5 py-1.5 text-xs shadow-sm">
                    step {String(payload[0].payload.step)}: {String(payload[0].value)} failures
                  </div>
                ) : null
              }
            />
            <Bar dataKey="n" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
