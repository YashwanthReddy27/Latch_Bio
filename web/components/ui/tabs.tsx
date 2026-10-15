"use client";

import * as RT from "@radix-ui/react-tabs";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";

export interface TabItem {
  value: string;
  label: string;
  hint?: string;
  content: React.ReactNode;
}

/**
 * Page-level tabs: one question per screen. The active tab is mirrored in the URL hash so a
 * view can be linked (e.g. /failures#trust) and survives reloads.
 */
export function PageTabs({ items, label, syncHash = true, dense = false }: { items: TabItem[]; label: string; syncHash?: boolean; dense?: boolean }) {
  const [value, setValue] = useState(items[0].value);

  useEffect(() => {
    if (!syncHash) return;
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (items.some((i) => i.value === h)) setValue(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [items, syncHash]);

  const change = (v: string) => {
    setValue(v);
    if (syncHash) history.replaceState(null, "", `#${v}`);
  };

  return (
    <RT.Root value={value} onValueChange={change}>
      <RT.List
        aria-label={label}
        className={cn("flex gap-1 overflow-x-auto border-b border-border", dense ? "mb-3" : "-mx-4 mb-5 px-4 sm:mx-0 sm:px-0")}
      >
        {items.map((t) => (
          <RT.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              "-mb-px shrink-0 border-b-2 text-left transition-colors",
              dense ? "px-2.5 py-1.5" : "px-3 py-2",
              "data-[state=active]:border-accent data-[state=inactive]:border-transparent",
              "data-[state=inactive]:text-ink-2 data-[state=inactive]:hover:text-ink",
            )}
          >
            <span className="block text-[13px] font-medium">{t.label}</span>
            {t.hint && <span className="hidden text-[11px] text-muted sm:block">{t.hint}</span>}
          </RT.Trigger>
        ))}
      </RT.List>
      {items.map((t) => (
        <RT.Content key={t.value} value={t.value} className="focus-visible:outline-none">
          {t.content}
        </RT.Content>
      ))}
    </RT.Root>
  );
}
