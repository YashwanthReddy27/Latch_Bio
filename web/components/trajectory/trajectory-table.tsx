"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Download, GitCompare } from "lucide-react";
import type { Category, ConfigRow, IndexRow } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/types";
import { CategoryTag, KindBadge, PassChip, buttonClass } from "@/components/ui/primitives";
import { secs, usd } from "@/lib/format";

const PAGE = 50;

type Filters = { config: string; task: string; outcome: string; category: string; kind: string; disagree: string; q: string };
const KEYS: (keyof Filters)[] = ["config", "task", "outcome", "category", "kind", "disagree", "q"];

export function TrajectoryTable({ rows, configs, taskIds }: { rows: IndexRow[]; configs: ConfigRow[]; taskIds: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const filters: Filters = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ""])) as Filters;
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const labelOf = useMemo(() => Object.fromEntries(configs.map((c) => [c.id, c.label])), [configs]);
  const hasJudge = useMemo(() => rows.some((r) => r.judge_category), [rows]);
  const [more, setMore] = useState(() => !!(params.get("kind") || params.get("disagree") || params.get("q")));

  const set = (k: keyof Filters, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    setPage(0);
    router.replace(`/trajectories${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  const filtered = useMemo(() => {
    const q = filters.q.toLowerCase();
    return rows.filter(
      (r) =>
        (!filters.config || r.config_id === filters.config) &&
        (!filters.task || r.task_id === filters.task) &&
        (!filters.outcome || (filters.outcome === "pass" ? r.passed : !r.passed)) &&
        (!filters.category || r.rule_category === filters.category || r.judge_category === filters.category) &&
        (!filters.kind || r.kind === filters.kind) &&
        (!filters.disagree || r.disagree) &&
        (!q || r.id.toLowerCase().includes(q) || (labelOf[r.config_id] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, filters.config, filters.task, filters.outcome, filters.category, filters.kind, filters.disagree, filters.q, labelOf]);

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const active = KEYS.filter((k) => filters[k]).length;

  async function exportJsonl() {
    const ids = filtered.map((r) => r.id);
    setExporting({ done: 0, total: ids.length });
    const out: string[] = new Array(ids.length);
    let done = 0;
    const worker = async (start: number) => {
      for (let i = start; i < ids.length; i += 6) {
        const res = await fetch(`/data/traj/${ids[i]}.json`);
        out[i] = JSON.stringify(await res.json());
        done += 1;
        if (done % 10 === 0 || done === ids.length) setExporting({ done, total: ids.length });
      }
    };
    try {
      await Promise.all(Array.from({ length: 6 }, (_, k) => worker(k)));
      const blob = new Blob([out.join("\n") + "\n"], { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `helix-trace-${ids.length}-trajectories.jsonl`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setExporting(null);
    }
  }

  const toggleSel = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Select label="Config" value={filters.config} onChange={(v) => set("config", v)} options={configs.map((c) => [c.id, c.label])} />
        <Select label="Task" value={filters.task} onChange={(v) => set("task", v)} options={taskIds.map((t) => [t, t])} />
        <Select label="Outcome" value={filters.outcome} onChange={(v) => set("outcome", v)} options={[["pass", "Passed"], ["fail", "Failed"]]} />
        <Select label="Failure category" value={filters.category} onChange={(v) => set("category", v)} options={CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]])} />
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className={`${buttonClass("ghost")} col-span-2 self-end lg:col-span-1`}>
          {more ? "Fewer filters" : "More filters"}
        </button>
      </div>
      {more && (
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Select label="Kind" value={filters.kind} onChange={(v) => set("kind", v)} options={[["REAL", "REAL"], ["SIMULATED", "SIMULATED"], ["BASELINE", "BASELINE"]]} />
        {hasJudge && <Select label="Judge vs rule" value={filters.disagree} onChange={(v) => set("disagree", v)} options={[["1", "Disagreements only"]]} />}
        <label className="col-span-2 grid gap-1 text-2xs font-medium uppercase tracking-[0.06em] text-muted">
          Search
          <input
            type="search"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="id or config"
            className="rounded border border-border-strong bg-surface px-2 py-1.5 text-[13px] normal-case tracking-normal text-ink placeholder:text-muted"
          />
        </label>
      </div>
      )}
      <div className="border-b border-border pt-1" />

      <div className="flex flex-wrap items-center gap-2 py-3">
        <p className="num text-xs text-ink-2" aria-live="polite">
          {filtered.length} of {rows.length} trajectories
          {active > 0 && (
            <button type="button" onClick={() => router.replace("/trajectories", { scroll: false })} className="ml-2 text-accent hover:underline">
              clear filters
            </button>
          )}
        </p>
        <span className="flex-1" />
        <button
          type="button"
          className={buttonClass("secondary")}
          disabled={selected.length !== 2}
          onClick={() => router.push(`/compare?a=${selected[0]}&b=${selected[1]}`)}
          title="Tick two rows to compare them side by side"
        >
          <GitCompare size={13} aria-hidden /> Compare {selected.length}/2
        </button>
        <button type="button" className={buttonClass("primary")} onClick={exportJsonl} disabled={!filtered.length || !!exporting}>
          <Download size={13} aria-hidden />
          {exporting ? `Exporting ${exporting.done}/${exporting.total}` : `Export ${filtered.length} as JSONL`}
        </button>
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[760px] text-[13px]">
          <caption className="sr-only">Trajectories matching the current filters</caption>
          <thead>
            <tr className="border-b border-border-strong text-left text-2xs uppercase tracking-[0.06em] text-muted">
              <th scope="col" className="w-8 py-2 font-medium"><span className="sr-only">Select</span></th>
              <th scope="col" className="py-2 pr-3 font-medium">Config</th>
              <th scope="col" className="py-2 pr-3 font-medium">Task</th>
              <th scope="col" className="py-2 pr-3 font-medium">Result</th>
              <th scope="col" className="py-2 pr-3 font-medium">Rule label</th>
              {hasJudge && <th scope="col" className="py-2 pr-3 font-medium">Judge label</th>}
              <th scope="col" className="py-2 pr-3 text-right font-medium">Div. step</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Steps</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Cost</th>
              <th scope="col" className="py-2 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className="border-b border-border hover:bg-surface-2">
                <td className="py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={() => toggleSel(r.id)}
                    aria-label={`Select ${r.id} for comparison`}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <Link href={`/trajectories/${r.id}`} className="font-medium hover:text-accent hover:underline">
                    {labelOf[r.config_id] ?? r.config_id}
                  </Link>{" "}
                  <span className="num text-xs text-muted">r{r.run_idx}</span>{" "}
                  {r.kind !== "SIMULATED" && <KindBadge kind={r.kind} />}
                </td>
                <td className="num py-1.5 pr-3">{r.task_id}</td>
                <td className="py-1.5 pr-3">
                  <PassChip passed={r.passed} />
                </td>
                <td className="py-1.5 pr-3"><CategoryTag category={r.rule_category} /></td>
                {hasJudge && <td className="py-1.5 pr-3">
                  {r.passed ? <span className="text-muted">—</span> : r.judge_category ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CategoryTag category={r.judge_category as Category} />
                      {r.disagree && <span className="rounded-sm bg-warn-soft px-1 text-[10px] font-medium text-warn">≠</span>}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">pending</span>
                  )}
                </td>}
                <td className="num py-1.5 pr-3 text-right">{r.rule_first_div ?? "—"}</td>
                <td className="num py-1.5 pr-3 text-right">{r.n_steps}</td>
                <td className="num py-1.5 pr-3 text-right">{r.kind === "BASELINE" ? "—" : usd(r.cost_usd)}</td>
                <td className="num py-1.5 text-right">{secs(r.wall_s)}</td>
              </tr>
            ))}
            {!pageRows.length && (
              <tr>
                <td colSpan={hasJudge ? 10 : 9} className="py-8 text-center text-ink-2">
                  No trajectories match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-end gap-2 pt-3 text-xs">
          <button type="button" className={buttonClass()} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="num text-ink-2">
            page {page + 1} / {pages}
          </span>
          <button type="button" className={buttonClass()} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) {
  return (
    <label className="grid gap-1 text-2xs font-medium uppercase tracking-[0.06em] text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border-strong bg-surface px-2 py-1.5 text-[13px] normal-case tracking-normal text-ink"
      >
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
