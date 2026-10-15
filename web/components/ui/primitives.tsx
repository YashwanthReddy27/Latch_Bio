import Link from "next/link";
import { Check, X } from "lucide-react";
import type { Category, Kind } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";
import { cn } from "@/lib/format";

export const CATEGORY_COLOR: Record<Category, string> = {
  problem_interpretation: "var(--cat-1)",
  statistical_reasoning: "var(--cat-2)",
  biological_interpretation: "var(--cat-3)",
  qc_miss: "var(--cat-4)",
  execution_error: "var(--cat-5)",
  formatting: "var(--cat-6)",
};

export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded border border-border bg-surface", className)} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-h` : undefined} className="text-[13px] font-semibold tracking-tight">
            {title}
          </h2>
          {description && <p className="mt-0.5 max-w-3xl text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5">
      {eyebrow && <p className="text-2xs font-medium uppercase tracking-[0.08em] text-accent">{eyebrow}</p>}
      <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-[22px]">{title}</h1>
      {children && <div className="mt-1.5 max-w-3xl text-[13px] text-ink-2">{children}</div>}
    </div>
  );
}

export function KindBadge({ kind }: { kind: Kind }) {
  const styles: Record<Kind, string> = {
    REAL: "border-accent text-accent bg-accent-soft",
    SIMULATED: "border-border-strong text-ink-2 bg-surface-2 border-dashed",
    BASELINE: "border-border-strong text-ink-2 bg-surface",
  };
  return (
    <span className={cn("inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-[10px] font-medium tracking-wide", styles[kind])}>
      {kind}
    </span>
  );
}

export function PassChip({ passed, label }: { passed: boolean; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-[11px] font-medium",
        passed ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail",
      )}
    >
      {passed ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
      {label ?? (passed ? "Pass" : "Fail")}
    </span>
  );
}

export function CategoryTag({ category, muted }: { category: Category | null; muted?: boolean }) {
  if (!category) return <span className="text-muted">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", muted ? "text-muted" : "text-ink-2")}>
      <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: CATEGORY_COLOR[category] }} />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "pass" | "fail" | "warn" }) {
  return (
    <div className="min-w-0 rounded border border-border bg-surface px-3.5 py-3">
      <p className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">{label}</p>
      <p
        className={cn(
          "num mt-1 text-[22px] font-medium leading-none",
          tone === "pass" && "text-pass",
          tone === "fail" && "text-fail",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function ButtonLink({ href, children, variant = "secondary", className }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link href={href} className={cn(buttonClass(variant), className)}>
      {children}
    </Link>
  );
}

export function buttonClass(variant: "primary" | "secondary" | "ghost" = "secondary", size: "sm" | "md" = "sm") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-[13px]",
    variant === "primary" && "border-accent bg-accent text-accent-ink hover:bg-accent-hover hover:border-accent-hover",
    variant === "secondary" && "border-border-strong bg-surface text-ink hover:bg-surface-2",
    variant === "ghost" && "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  );
}

export function Gene({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px]">{children}</span>;
}

export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      className={cn(
        "rounded border px-3 py-2 text-xs",
        tone === "warn" ? "border-warn bg-warn-soft text-ink-2" : "border-border bg-surface-2 text-ink-2",
      )}
    >
      {children}
    </div>
  );
}
