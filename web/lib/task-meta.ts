import type { TaskSpec } from "./types";

export const TASK_CATEGORY_LABEL: Record<TaskSpec["category"], string> = {
  qc: "QC",
  statistical_reasoning: "Statistical reasoning",
  problem_interpretation: "Problem interpretation",
  biological_interpretation: "Biological interpretation",
};

/** Plain-language rendering of one declarative grader check. */
export function describeCheck(c: Record<string, unknown>): string {
  const list = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  switch (c.kind) {
    case "exact":
      return `must equal ${JSON.stringify(c.value)} (strings compared case-insensitively)`;
    case "numeric":
      return `within ±${c.abs_tol} of ${c.value}`;
    case "numeric_map":
      return `each of ${Object.keys(c.values as object).length} values within ±${c.abs_tol} of the reference`;
    case "range":
      return `integer in [${c.min}, ${c.max}] inclusive`;
    case "set_equal":
      return `exactly the set {${(c.values as string[]).join(", ")}}`;
    case "set_overlap":
      return `at most ${c.max_items} items; recall ≥ ${c.min_recall} and precision ≥ ${c.min_precision} against ${list(c.truth)} planted genes`;
    case "f1":
      return `F1 ≥ ${c.min_f1} against ${list(c.truth)} planted genes`;
    case "max_overlap":
      return `no more than ${c.max_count} of ${list(c.forbidden)} core-essential genes`;
    case "classification":
      return `≥ ${Math.round((c.min_accuracy as number) * 100)}% of ${Object.keys(c.truth as object).length} genes in their planted class`;
    default:
      return String(c.kind);
  }
}
