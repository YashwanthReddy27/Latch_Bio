"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Category, ConfigRow } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/types";
import { CATEGORY_COLOR, buttonClass } from "@/components/ui/primitives";
import { pct } from "@/lib/format";

type Source = "rule" | "judge";
type Mode = "count" | "share";

interface Row {
  id: string;
  label: string;
  total: number;
  [k: string]: string | number;
}

function Tip({ active, payload, label, mode }: { active?: boolean; payload?: { dataKey: string; value: number; payload: Row }[]; label?: string; mode: Mode }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded border border-border-strong bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{label}</p>
      <table className="num">
        <tbody>
          {[...payload].reverse().map((p) => {
            const n = row[`${p.dataKey}__n`] as number;
            return (
              <tr key={p.dataKey}>
                <td className="pr-2">
                  <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: CATEGORY_COLOR[p.dataKey as Category] }} />
                </td>
                <td className="pr-3 font-sans text-ink-2">{CATEGORY_LABEL[p.dataKey as Category]}</td>
                <td className="text-right">{mode === "share" ? pct(p.value) : n}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-muted">{row.total} failures</p>
    </div>
  );
}

export function FailureStack({ configs, judgeAvailable }: { configs: ConfigRow[]; judgeAvailable: boolean }) {
  const [source, setSource] = useState<Source>("rule");
  const [mode, setMode] = useState<Mode>("count");
  const [asTable, setAsTable] = useState(false);

  const rows: Row[] = configs.map((c) => {
    const f = source === "rule" ? c.failures : c.judge_failures;
    const total = CATEGORIES.reduce((s, k) => s + (f[k] ?? 0), 0);
    const row: Row = { id: c.id, label: c.label, total };
    for (const k of CATEGORIES) {
      row[`${k}__n`] = f[k] ?? 0;
      row[k] = mode === "share" ? (total ? (f[k] ?? 0) / total : 0) : f[k] ?? 0;
    }
    return row;
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Label source" className="flex rounded border border-border p-0.5">
          {(["rule", "judge"] as Source[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={source === s}
              disabled={s === "judge" && !judgeAvailable}
              title={s === "judge" && !judgeAvailable ? "No judge labels in this export yet" : undefined}
              onClick={() => setSource(s)}
              className={`rounded-[3px] px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-45 ${source === s ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:text-ink"}`}
            >
              {s === "rule" ? "Rule-based labels" : "Gemini judge labels"}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Scale" className="flex rounded border border-border p-0.5">
          {(["count", "share"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-[3px] px-2.5 py-1 text-xs ${mode === m ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:text-ink"}`}
            >
              {m === "count" ? "Count" : "Share of failures"}
            </button>
          ))}
        </div>
        <button type="button" className={buttonClass("ghost")} onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>

      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
        {CATEGORIES.map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: CATEGORY_COLOR[k] }} />
            {CATEGORY_LABEL[k]}
          </li>
        ))}
      </ul>

      {asTable ? (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-border-strong text-2xs uppercase tracking-[0.06em] text-muted">
                <th scope="col" className="py-2 text-left font-medium">Config</th>
                {CATEGORIES.map((k) => (
                  <th key={k} scope="col" className="py-2 text-right font-medium">{CATEGORY_LABEL[k]}</th>
                ))}
                <th scope="col" className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <th scope="row" className="py-1.5 text-left font-normal">{r.label}</th>
                  {CATEGORIES.map((k) => (
                    <td key={k} className="num py-1.5 text-right">{mode === "share" ? pct(r[k] as number) : (r[`${k}__n`] as number)}</td>
                  ))}
                  <td className="num py-1.5 text-right font-medium">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-[300px] w-full" role="img" aria-label={`Stacked bars of failure categories per configuration (${source} labels). Use "Show as table" for exact values.`}>
          <ResponsiveContainer>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                domain={mode === "share" ? [0, 1] : [0, "auto"]}
                tickFormatter={(v: number) => (mode === "share" ? pct(v) : String(v))}
                tickLine={false}
                axisLine={{ stroke: "var(--border-strong)" }}
                allowDecimals={false}
              />
              <YAxis type="category" dataKey="label" width={140} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--text-2)" }} />
              <Tooltip content={<Tip mode={mode} />} cursor={{ fill: "var(--surface-2)" }} />
              {CATEGORIES.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="f"
                  fill={CATEGORY_COLOR[k]}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                  radius={i === CATEGORIES.length - 1 ? [0, 3, 3, 0] : 0}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
