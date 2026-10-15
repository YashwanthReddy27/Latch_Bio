// TS port of bench/bench/judge.py digest() + grade_summary(): the judge sees the same view of a
// live run as it does of an offline one.
import type { GradeResult, Step } from "@/lib/types";

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)} …[${s.length - n} more chars]`);

export function digest(steps: Step[]): string {
  const lines: string[] = [];
  for (const s of steps) {
    const out = s.output ?? {};
    let head = `[step ${s.i}] ${s.tool}`;
    if (s.thought) head += `\n  thought: ${clip(s.thought, 300)}`;
    lines.push(head);
    const args = s.args ?? {};
    if (s.tool === "run_python") {
      const code = String(args.code ?? "").split("\n").slice(0, 30).join("\n");
      lines.push("  code:\n" + code.split("\n").map((l) => "    " + l).join("\n"));
      if (out.error) {
        const errLines = String(out.error).trim().split("\n");
        lines.push("  error: " + clip(errLines[errLines.length - 1], 200));
      } else if (out.stdout) {
        lines.push("  stdout: " + clip(String(out.stdout).trim(), 500).replaceAll("\n", "\n    "));
      }
    } else if (s.tool === "submit_answer") {
      lines.push("  answer: " + clip(String(args.answer_json ?? JSON.stringify(args)), 600));
    } else if (s.tool === "read_file") {
      lines.push(`  path: ${String(args.path)}`);
    }
  }
  return lines.join("\n");
}

export function gradeSummary(grade: GradeResult, status: string): string {
  if (grade.error) return `FAILED: ${grade.error} (status: ${status})`;
  return (
    "FAILED checks:\n" +
    grade.checks
      .map((c) => `  ${c.label}: ${c.passed ? "pass" : "FAIL"} (expected ${c.expected}; got ${c.actual}; ${c.detail})`)
      .join("\n")
  );
}
