// TypeScript port of bench/bench/graders/engine.py — keep the two in lockstep.
// Parity is enforced by scripts/grader-parity.test.ts, which replays
// bench/tests/fixtures/grader_cases.json (the same fixtures pytest checks).

export interface Check {
  id: string;
  kind: string;
  path: string;
  label?: string;
  [k: string]: unknown;
}

export interface TaskLike {
  answer_schema: SchemaLike;
  grader: { checks: Check[] };
}

interface PropLike {
  type: string;
  items?: { type: string };
  additionalProperties?: PropLike;
}

interface SchemaLike {
  required?: string[];
  properties?: Record<string, PropLike>;
}

export interface CheckResult {
  id: string;
  kind: string;
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
  detail: string;
}

export interface GradeResult {
  passed: boolean;
  score: number;
  error: string | null;
  error_kind: string | null;
  checks: CheckResult[];
}

const EPS = 1e-9;
const MISSING = Symbol("missing");

type Json = unknown;

const isObj = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

// Python distinguishes int/float; JSON.parse does not. A JS number is an "integer" when it is
// integral, matching how Python's json.loads would have parsed the same text (1 -> int, 1.5 -> float).
// Note: Python parses "1.0" as float; the parity fixtures avoid that edge for integer fields.
function typeOk(value: Json, typ: string): boolean {
  switch (typ) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "array":
      return Array.isArray(value);
    case "object":
      return isObj(value);
    default:
      return false;
  }
}

export function validateSchema(answer: Json, schema: SchemaLike): string | null {
  if (!isObj(answer)) return "answer must be a JSON object";
  for (const key of schema.required ?? []) if (!(key in answer)) return `missing required key '${key}'`;
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (!(key in answer)) continue;
    const v = answer[key];
    if (!typeOk(v, prop.type)) return `'${key}' must be of type ${prop.type}`;
    if (prop.type === "array" && prop.items) {
      for (const item of v as Json[]) if (!typeOk(item, prop.items.type)) return `items of '${key}' must be of type ${prop.items.type}`;
    }
    if (prop.type === "object" && prop.additionalProperties) {
      const sub = prop.additionalProperties;
      for (const [k2, item] of Object.entries(v as Record<string, Json>)) {
        if (!typeOk(item, sub.type)) return `'${key}.${k2}' must be of type ${sub.type}`;
        if (sub.type === "array" && sub.items) {
          for (const x of item as Json[]) if (!typeOk(x, sub.items.type)) return `items of '${key}.${k2}' must be of type ${sub.items.type}`;
        }
      }
    }
  }
  return null;
}

function get(answer: Record<string, Json>, path: string): Json | typeof MISSING {
  let cur: Json = answer;
  if (path === "") return cur;
  for (const part of path.split(".")) {
    if (!isObj(cur) || !(part in cur)) return MISSING;
    cur = cur[part];
  }
  return cur;
}

const norm = (s: Json) => String(s).trim().toUpperCase();

export function fmt(x: number): string {
  let s = x.toFixed(4);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

function pyStr(v: Json): string {
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "string" ? `'${x}'` : pyStr(x))).join(", ")}]`;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (v === null) return "None";
  if (isObj(v)) return "dict";
  return String(v);
}

function typeName(v: Json): string {
  if (Array.isArray(v)) return "list";
  if (isObj(v)) return "dict";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  return "NoneType";
}

function result(check: Check, passed: boolean, expected: string, actual: string, detail: string): CheckResult {
  return { id: check.id, kind: check.kind, label: check.label ?? check.id, passed, expected, actual, detail };
}

function runCheck(check: Check, answer: Record<string, Json>): CheckResult {
  const c = check as Check & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const v = get(answer, check.path);
  if (v === MISSING) return result(check, false, "present", "missing", `no value at '${check.path}'`);

  switch (check.kind) {
    case "exact": {
      const exp = c.value;
      const ok = typeof exp === "string" ? typeof v === "string" && norm(v) === norm(exp) : typeOk(v, "number") && v === exp;
      return result(check, ok, String(exp), pyStr(v), ok ? "exact match" : "value differs");
    }
    case "numeric": {
      if (!typeOk(v, "number")) return result(check, false, fmt(c.value), pyStr(v), "not a number");
      const diff = Math.abs((v as number) - c.value);
      const ok = diff <= c.abs_tol + EPS;
      return result(check, ok, `${fmt(c.value)} ± ${fmt(c.abs_tol)}`, fmt(v as number), `|diff| = ${fmt(diff)}`);
    }
    case "numeric_map": {
      if (!isObj(v)) return result(check, false, "object", typeName(v), "not an object");
      const bad: string[] = [];
      const values = c.values as Record<string, number>;
      for (const [k, exp] of Object.entries(values)) {
        const got = k in v ? v[k] : MISSING;
        if (got === MISSING || !typeOk(got, "number")) bad.push(`${k}: missing`);
        else if (Math.abs((got as number) - exp) > c.abs_tol + EPS) bad.push(`${k}: ${fmt(got as number)} vs ${fmt(exp)}`);
      }
      const n = Object.keys(values).length;
      const ok = bad.length === 0;
      return result(check, ok, `${n} values within ± ${fmt(c.abs_tol)}`, `${n - bad.length}/${n} within tolerance`, ok ? "all within tolerance" : bad.join("; "));
    }
    case "range": {
      if (!typeOk(v, "number")) return result(check, false, `[${fmt(c.min)}, ${fmt(c.max)}]`, pyStr(v), "not a number");
      const x = v as number;
      const ok = c.min - EPS <= x && x <= c.max + EPS;
      return result(check, ok, `[${fmt(c.min)}, ${fmt(c.max)}]`, fmt(x), ok ? "within range" : "outside range");
    }
    case "set_equal":
    case "set_overlap":
    case "f1":
    case "max_overlap": {
      if (!Array.isArray(v)) return result(check, false, "list", typeName(v), "not a list");
      const got = new Set(v.map(norm));
      if (check.kind === "set_equal") {
        const exp = new Set((c.values as Json[]).map(norm));
        const missing = [...exp].filter((x) => !got.has(x)).sort();
        const extra = [...got].filter((x) => !exp.has(x)).sort();
        const ok = missing.length === 0 && extra.length === 0;
        return result(
          check,
          ok,
          [...exp].sort().join(", ") || "(empty)",
          [...got].sort().join(", ") || "(empty)",
          ok ? "sets match" : `missing ${pyStr(missing)} extra ${pyStr(extra)}`,
        );
      }
      if (check.kind === "max_overlap") {
        const forb = new Set((c.forbidden as Json[]).map(norm));
        const hit = [...got].filter((x) => forb.has(x)).sort();
        const ok = hit.length <= c.max_count;
        return result(check, ok, `≤ ${c.max_count}`, String(hit.length), hit.length === 0 ? "ok" : `includes ${pyStr(hit.slice(0, 8))}`);
      }
      const truth = new Set((c.truth as Json[]).map(norm));
      const tp = [...got].filter((x) => truth.has(x)).length;
      const recall = truth.size ? tp / truth.size : 0;
      const precision = got.size ? tp / got.size : 0;
      if (check.kind === "set_overlap") {
        const tooMany = v.length > c.max_items;
        const ok = !tooMany && recall >= c.min_recall - EPS && precision >= c.min_precision - EPS;
        let detail = `TP=${tp}, recall=${fmt(recall)}, precision=${fmt(precision)}`;
        if (tooMany) detail += `; ${v.length} items > max ${c.max_items}`;
        return result(check, ok, `recall ≥ ${fmt(c.min_recall)}, precision ≥ ${fmt(c.min_precision)}`, `recall ${fmt(recall)}, precision ${fmt(precision)}`, detail);
      }
      const f1 = tp === 0 ? 0 : (2 * precision * recall) / (precision + recall);
      const ok = f1 >= c.min_f1 - EPS;
      return result(check, ok, `F1 ≥ ${fmt(c.min_f1)}`, `F1 ${fmt(f1)}`, `TP=${tp}, recall=${fmt(recall)}, precision=${fmt(precision)}`);
    }
    case "classification": {
      if (!isObj(v)) return result(check, false, "object", typeName(v), "not an object");
      const assigned = new Map<string, string>();
      for (const [cls, items] of Object.entries(v)) {
        if (Array.isArray(items)) for (const it of items) assigned.set(norm(it), String(cls).trim().toLowerCase());
      }
      const truth = c.truth as Record<string, string>;
      const entries = Object.entries(truth);
      const correct = entries.filter(([item, cls]) => assigned.get(norm(item)) === cls).length;
      const acc = correct / entries.length;
      const ok = acc >= c.min_accuracy - EPS;
      const wrong = entries.filter(([item, cls]) => assigned.get(norm(item)) !== cls).map(([item]) => item);
      return result(
        check,
        ok,
        `accuracy ≥ ${fmt(c.min_accuracy)}`,
        `${correct}/${entries.length} (${fmt(acc)})`,
        wrong.length === 0 ? "all correct" : `misclassified ${pyStr(wrong.slice(0, 10))}`,
      );
    }
    default:
      throw new Error(`unknown check kind ${check.kind}`);
  }
}

/** Grade an answer against a task spec. Never throws on bad answers. */
export function grade(task: TaskLike, answer: Json): GradeResult {
  if (answer === null || answer === undefined) {
    return { passed: false, score: 0, error: "no answer submitted", error_kind: "no_answer", checks: [] };
  }
  const err = validateSchema(answer, task.answer_schema);
  if (err) return { passed: false, score: 0, error: `schema: ${err}`, error_kind: "schema", checks: [] };
  const checks = task.grader.checks.map((c) => runCheck(c, answer as Record<string, Json>));
  const nPass = checks.filter((c) => c.passed).length;
  return {
    passed: nPass === checks.length,
    score: Math.round((nPass / checks.length) * 1e4) / 1e4,
    error: null,
    error_kind: null,
    checks,
  };
}
