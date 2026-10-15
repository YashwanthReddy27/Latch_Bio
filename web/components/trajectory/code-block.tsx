"use client";

import { Highlight, type PrismTheme } from "prism-react-renderer";
import { cn } from "@/lib/format";

const theme: PrismTheme = {
  plain: { color: "var(--text)", backgroundColor: "transparent" },
  styles: [
    { types: ["comment"], style: { color: "var(--syn-com)", fontStyle: "italic" } },
    { types: ["keyword", "builtin", "boolean"], style: { color: "var(--syn-kw)" } },
    { types: ["string", "char", "attr-value"], style: { color: "var(--syn-str)" } },
    { types: ["number"], style: { color: "var(--syn-num)" } },
    { types: ["function", "class-name"], style: { color: "var(--syn-fn)" } },
    { types: ["punctuation", "operator"], style: { color: "var(--syn-punct)" } },
  ],
};

export function CodeBlock({
  code,
  language = "python",
  highlight = [],
  maxHeight,
  className,
  label,
}: {
  code: string;
  language?: string;
  highlight?: number[];
  maxHeight?: number;
  className?: string;
  label?: string;
}) {
  const hl = new Set(highlight);
  return (
    <Highlight code={code.replace(/\n$/, "")} language={language} theme={theme}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre
          aria-label={label}
          tabIndex={0}
          className={cn("overflow-auto rounded border border-border bg-code-bg py-2 font-mono text-[12px] leading-[1.55]", className)}
          style={maxHeight ? { maxHeight } : undefined}
        >
          <code>
            {tokens.map((line, i) => {
              const n = i + 1;
              const lp = getLineProps({ line });
              const on = hl.has(n);
              return (
                <div
                  key={i}
                  {...lp}
                  className={cn("flex min-w-max pr-3", on && "bg-hl-line")}
                  style={undefined}
                  data-evidence={on || undefined}
                >
                  <span
                    aria-hidden
                    className={cn("num w-9 shrink-0 select-none pr-2.5 text-right text-[11px]", on ? "font-semibold text-warn" : "text-muted")}
                  >
                    {n}
                  </span>
                  <span>
                    {line.map((token, k) => (
                      <span key={k} {...getTokenProps({ token })} />
                    ))}
                  </span>
                  {on && <span className="sr-only"> (evidence line)</span>}
                </div>
              );
            })}
          </code>
        </pre>
      )}
    </Highlight>
  );
}
