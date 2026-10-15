import type { Config } from "tailwindcss";

const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        "surface-3": v("surface-3"),
        border: v("border"),
        "border-strong": v("border-strong"),
        ink: v("text"),
        "ink-2": v("text-2"),
        muted: v("muted"),
        accent: v("accent"),
        "accent-hover": v("accent-hover"),
        "accent-soft": v("accent-soft"),
        "accent-ink": v("accent-ink"),
        pass: v("pass"),
        "pass-soft": v("pass-soft"),
        fail: v("fail"),
        "fail-soft": v("fail-soft"),
        warn: v("warn"),
        "warn-soft": v("warn-soft"),
        "code-bg": v("code-bg"),
        "hl-line": v("hl-line"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};
export default config;
