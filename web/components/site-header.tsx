"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/failures", label: "Failure taxonomy" },
  { href: "/trajectories", label: "Trajectories" },
  { href: "/tasks", label: "Tasks" },
  { href: "/live", label: "Live run" },
  { href: "/about", label: "About" },
];

function Mark() {
  // two helical strands drawn as offset sine paths: a quiet, single-colour mark
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-accent">
      <path d="M6 2c0 5 12 5 12 10S6 17 6 22" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M18 2c0 5-12 5-12 10s12 5 12 10" fill="none" stroke="currentColor" strokeWidth="1.8" opacity=".45" />
      <path d="M8 5.5h8M8 18.5h8M9.5 9h5M9.5 15h5" stroke="currentColor" strokeWidth="1.2" opacity=".6" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 py-3" aria-label="Helix Trace home">
          <Mark />
          <span className="text-[15px] font-semibold tracking-tight">Helix Trace</span>
          <span className="hidden border-l border-border pl-2 text-xs text-muted md:inline">CRISPRScreenBench-mini</span>
        </Link>
        <nav aria-label="Primary" className="-mb-px flex min-w-0 flex-1 overflow-x-auto">
          <ul className="flex gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={`block whitespace-nowrap border-b-2 px-2.5 py-3.5 text-[13px] transition-colors ${
                    isActive(n.href)
                      ? "border-accent font-medium text-ink"
                      : "border-transparent text-ink-2 hover:text-ink"
                  }`}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="shrink-0">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
