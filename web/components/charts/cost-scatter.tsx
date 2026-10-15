"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, LabelList } from "recharts";
import type { ConfigRow, Kind } from "@/lib/types";
import { pct, usd } from "@/lib/format";

interface Pt {
  id: string;
  label: string;
  kind: Kind;
  cost: number;
  rate: number;
  lo: number;
  hi: number;
}

function Marker(props: { cx?: number; cy?: number; payload?: Pt }) {
  const { cx = 0, cy = 0, payload } = props;
  const kind = payload?.kind;
  // identity of the config is carried by its direct label; shape carries REAL vs SIMULATED
  if (kind === "REAL") {
    return <circle cx={cx} cy={cy} r={6} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={5.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />;
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload: Pt }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded border border-border-strong bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-ink">{p.label}</p>
      <p className="mt-0.5 text-muted">{p.kind}</p>
      <dl className="num mt-1.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-ink-2">
        <dt className="text-muted">pass</dt>
        <dd>
          {pct(p.rate)} <span className="text-muted">({pct(p.lo)}–{pct(p.hi)})</span>
        </dd>
        <dt className="text-muted">cost/run</dt>
        <dd>{usd(p.cost)}</dd>
      </dl>
    </div>
  );
}

export function CostScatter({ configs }: { configs: ConfigRow[] }) {
  const pts: Pt[] = configs
    .filter((c) => c.kind !== "BASELINE")
    .map((c) => ({ id: c.id, label: c.label, kind: c.kind, cost: c.mean_cost, rate: c.pass_rate, lo: c.ci[0], hi: c.ci[1] }));
  const baselines = configs.filter((c) => c.kind === "BASELINE");
  const costs = pts.map((p) => p.cost).filter((x) => x > 0);
  const min = costs.length ? Math.min(...costs) : 0.0001;
  const max = costs.length ? Math.max(...costs) : 1;
  const domain: [number, number] = [Math.pow(10, Math.floor(Math.log10(min))), Math.pow(10, Math.ceil(Math.log10(max)))];

  return (
    <figure>
      <div className="h-[300px] w-full" role="img" aria-label="Scatter plot of mean cost per run against pass rate for each non-baseline configuration">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 4 }}>
            <CartesianGrid strokeDasharray="0" vertical={false} />
            <XAxis
              type="number"
              dataKey="cost"
              scale="log"
              domain={domain}
              tickFormatter={(v: number) => usd(v)}
              tickLine={false}
              axisLine={{ stroke: "var(--border-strong)" }}
              label={{ value: "mean cost per run (USD, log scale)", position: "insideBottom", offset: -16, fill: "var(--muted)", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="rate"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v: number) => pct(v)}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            {baselines.map((b) => (
              <ReferenceLine
                key={b.id}
                y={b.pass_rate}
                stroke="var(--border-strong)"
                strokeDasharray="4 4"
                label={{ value: `${b.label} · ${pct(b.pass_rate)}`, position: "insideTopRight", fill: "var(--muted)", fontSize: 10 }}
              />
            ))}
            <Tooltip content={<Tip />} cursor={false} />
            <Scatter data={pts} shape={<Marker />} isAnimationActive={false}>
              <LabelList
                dataKey="label"
                content={(p) => {
                  const { x = 0, y = 0, value } = p as { x?: number; y?: number; value?: string };
                  return (
                    <text x={Number(x) + 16} y={Number(y) + 9} fill="var(--text-2)" fontSize={11} style={{ whiteSpace: "pre" }}>
                      {String(value)}
                    </text>
                  );
                }}
              />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill="var(--accent)" />
          </svg>
          REAL run
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
          </svg>
          SIMULATED config
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line x1="0" y1="4" x2="18" y2="4" stroke="var(--border-strong)" strokeDasharray="4 3" />
          </svg>
          scripted baseline (no token cost)
        </span>
      </figcaption>
    </figure>
  );
}
