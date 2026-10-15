"use client";

import { useState } from "react";
import { AlertTriangle, FileText, FolderOpen, Send, SquareTerminal } from "lucide-react";
import type { Category, Step } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";
import { CATEGORY_COLOR } from "@/components/ui/primitives";
import { CodeBlock } from "./code-block";
import { cn, secs } from "@/lib/format";

const TOOL_ICON: Record<string, typeof SquareTerminal> = {
  run_python: SquareTerminal,
  list_files: FolderOpen,
  read_file: FileText,
  submit_answer: Send,
};

export interface StepMarks {
  evidenceLines?: number[];
  evidenceCategory?: Category | null;
  ruleDivergence?: boolean;
  judgeDivergence?: boolean;
  judgeEvidence?: boolean;
}

function Output({ text, error, truncated }: { text: string; error?: boolean; truncated?: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = text.replace(/\n$/, "").split("\n");
  const LIMIT = 14;
  const long = lines.length > LIMIT;
  const shown = open || !long ? lines : lines.slice(0, LIMIT);
  return (
    <div>
      <pre
        tabIndex={0}
        className={cn(
          "overflow-x-auto rounded border px-3 py-2 font-mono text-[11.5px] leading-[1.5]",
          error ? "border-fail bg-fail-soft text-ink" : "border-border bg-surface-2 text-ink-2",
        )}
      >
        {shown.join("\n")}
        {long && !open && "\n…"}
      </pre>
      <div className="mt-1 flex gap-3 text-[11px] text-muted">
        {long && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-accent hover:underline">
            {open ? "Collapse output" : `Show all ${lines.length} lines`}
          </button>
        )}
        {truncated && <span>Output was truncated by the sandbox before the agent saw it.</span>}
      </div>
    </div>
  );
}

export function StepCard({
  step,
  marks = {},
  imageBase = "/data/",
  compact = false,
  anchorPrefix = "step",
}: {
  step: Step;
  marks?: StepMarks;
  imageBase?: string;
  compact?: boolean;
  anchorPrefix?: string;
}) {
  const Icon = TOOL_ICON[step.tool] ?? AlertTriangle;
  const out = step.output ?? {};
  const code = step.tool === "run_python" ? String(step.args.code ?? "") : "";
  const isEvidence = !!marks.evidenceCategory;
  const borderColor = isEvidence ? CATEGORY_COLOR[marks.evidenceCategory as Category] : undefined;

  return (
    <article
      id={`${anchorPrefix}-${step.i}`}
      className={cn("relative scroll-mt-20 rounded border bg-surface", isEvidence ? "border-l-[3px]" : "border-border")}
      style={isEvidence ? { borderColor: "var(--border)", borderLeftColor: borderColor } : undefined}
      aria-label={`Step ${step.i}: ${step.tool}`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1.5">
        <span className="num text-xs font-semibold text-ink">#{step.i}</span>
        <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-ink-2">
          <Icon size={13} aria-hidden />
          {step.tool}
        </span>
        {step.milestones?.map((m) => (
          <span key={m} className="rounded-sm bg-surface-2 px-1.5 font-mono text-[10.5px] text-muted">
            {m}
          </span>
        ))}
        <span className="flex-1" />
        {marks.ruleDivergence && (
          <span className="rounded-sm border border-fail px-1.5 text-[10.5px] font-medium text-fail">first divergence · rules</span>
        )}
        {marks.judgeDivergence && (
          <span className="rounded-sm border border-dashed border-fail px-1.5 text-[10.5px] font-medium text-fail">first divergence · judge</span>
        )}
        {isEvidence && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-2">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: borderColor }} aria-hidden />
            evidence: {CATEGORY_LABEL[marks.evidenceCategory as Category]}
          </span>
        )}
        {marks.judgeEvidence && !isEvidence && <span className="text-[10.5px] text-ink-2">cited by judge</span>}
        {!compact && (step.latency_s > 0 || step.exec_s > 0) && (
          <span className="num text-[10.5px] text-muted">
            {step.tokens_in + step.tokens_out > 0 && `${step.tokens_in + step.tokens_out + step.tokens_thinking} tok · `}
            {secs(step.latency_s + step.exec_s)}
          </span>
        )}
      </header>
      <div className="grid gap-2 px-3 py-2.5">
        {step.thought && <p className="max-w-prose text-[13px] text-ink-2">{step.thought}</p>}
        {code && (
          <CodeBlock code={code} highlight={marks.evidenceLines} maxHeight={compact ? 220 : 420} label={`Code for step ${step.i}`} />
        )}
        {step.tool === "read_file" && (
          <p className="font-mono text-[12px] text-ink-2">
            read {String(step.args.path)} {out.truncated ? "(truncated)" : ""}
          </p>
        )}
        {step.tool === "list_files" && Array.isArray(out.files) && (
          <p className="font-mono text-[12px] text-ink-2">
            {out.files.map((f) => f.path).join("  ")}
          </p>
        )}
        {step.tool === "submit_answer" && (
          <CodeBlock code={prettyJson(step.args.answer_json)} language="json" maxHeight={240} label="Submitted answer" />
        )}
        {!compact && step.tool === "read_file" && typeof out.content === "string" && <Output text={out.content} />}
        {out.stdout ? <Output text={String(out.stdout)} truncated={!!out.truncated} /> : null}
        {out.error ? <Output text={String(out.error)} error /> : null}
        {step.images?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {step.images.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={imageBase + src}
                alt={`Figure produced at step ${step.i}`}
                className="max-h-[260px] w-auto rounded border border-border bg-white"
                loading="lazy"
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function prettyJson(raw: unknown): string {
  try {
    return JSON.stringify(typeof raw === "string" ? JSON.parse(raw) : raw, null, 1);
  } catch {
    return String(raw);
  }
}
