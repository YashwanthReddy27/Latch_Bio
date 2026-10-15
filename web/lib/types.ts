// Shapes of the static JSON written by `python -m bench.export` (web/public/data).

export type Kind = "BASELINE" | "SIMULATED" | "REAL";

export const CATEGORIES = [
  "problem_interpretation",
  "statistical_reasoning",
  "biological_interpretation",
  "qc_miss",
  "execution_error",
  "formatting",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  problem_interpretation: "Problem interpretation",
  statistical_reasoning: "Statistical reasoning",
  biological_interpretation: "Biological interpretation",
  qc_miss: "QC miss",
  execution_error: "Tool / execution error",
  formatting: "Formatting",
};

export const CATEGORY_SHORT: Record<Category, string> = {
  problem_interpretation: "Interp.",
  statistical_reasoning: "Stats",
  biological_interpretation: "Biology",
  qc_miss: "QC",
  execution_error: "Exec.",
  formatting: "Format",
};

export interface ConfigRow {
  id: string;
  label: string;
  kind: Kind;
  model: string;
  harness: string;
  description: string;
  n: number;
  n_pass: number;
  pass_rate: number;
  ci: [number, number];
  mean_cost: number;
  mean_tokens: number;
  mean_steps: number;
  mean_wall_s: number;
  runs_per_task: number;
  per_task: Record<string, { n: number; pass: number }>;
  failures: Record<Category, number>;
  judge_failures: Record<Category, number>;
  mean_first_div: number | null;
}

export interface IndexRow {
  id: string;
  config_id: string;
  task_id: string;
  run_idx: number;
  kind: Kind;
  passed: boolean;
  score: number;
  status: string;
  n_steps: number;
  tokens: number;
  cost_usd: number;
  wall_s: number;
  rule_category: Category | null;
  rule_first_div: number | null;
  judge_category: Category | null;
  judge_first_div: number | null;
  disagree: boolean;
  div_gap: number | null;
  injected: string[];
  latent: string[];
  has_plot: boolean;
}

export interface GraderCheck {
  id: string;
  kind: string;
  path: string;
  label?: string;
  [k: string]: unknown;
}

export interface TaskSpec {
  id: string;
  title: string;
  category: "qc" | "statistical_reasoning" | "problem_interpretation" | "biological_interpretation";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  context: string;
  inputs: string[];
  answer_schema: {
    type: "object";
    required?: string[];
    properties?: Record<string, SchemaProp>;
  };
  grader: { checks: GraderCheck[] };
  grader_plain: string;
  traps: string[];
  milestones: string[];
  reference_answer: Record<string, unknown>;
  ground_truth: Record<string, unknown>;
  n_runs?: number;
  pass_rate?: number;
}

export interface SchemaProp {
  type: string;
  items?: { type: string };
  additionalProperties?: SchemaProp;
}

export interface TasksFile {
  tasks: TaskSpec[];
  inputs: {
    files: Record<string, { bytes: number; rows?: number; columns?: string[]; genes?: number; non_targeting?: number; gene_sets?: number }>;
    counts_preview: Record<string, string | number>[];
  };
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

export interface StepOutput {
  stdout?: string;
  stderr?: string;
  error?: string | null;
  truncated?: boolean;
  exec_s?: number;
  files?: { path: string; bytes: number }[];
  content?: string;
  path?: string;
  accepted?: boolean;
  answer?: unknown;
  [k: string]: unknown;
}

export interface Step {
  i: number;
  thought: string;
  tool: string;
  args: Record<string, unknown>;
  output: StepOutput;
  images: string[];
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  cost_usd: number;
  latency_s: number;
  exec_s: number;
  milestones: string[];
  meta?: Record<string, unknown>;
}

export interface Signal {
  id: string;
  category: Category;
  message: string;
  evidence: { step: number | null; lines: number[] }[];
}

export interface RuleLabel {
  category: Category | null;
  signals: Signal[];
  first_divergence_step: number | null;
  evidence_step_ids: number[];
  latent_issues: string[];
}

export interface JudgeLabel {
  category: Category;
  first_divergence_step: number;
  evidence_step_ids: number[];
  explanation: string;
  model: string;
  created?: string;
}

export interface Trajectory {
  id: string;
  config_id: string;
  task_id: string;
  run_idx: number;
  kind: Kind;
  model: string;
  harness: string;
  status: string;
  answer: unknown;
  grade: GradeResult;
  passed: boolean;
  totals: {
    n_steps: number;
    tokens_in: number;
    tokens_out: number;
    tokens_thinking: number;
    cost_usd: number;
    model_latency_s: number;
    exec_s: number;
    wall_s: number;
  };
  steps: Step[];
  injected: { mistakes: string[]; categories: string[]; descriptions: string[] } | null;
  labels: { rule: RuleLabel; judge: JudgeLabel | null; disagree: boolean };
  created: string;
}

export interface FailuresFile {
  categories: Category[];
  by_config: Record<string, Record<Category, number>>;
  judge_by_config: Record<string, Record<Category, number>>;
  by_task: Record<string, Record<Category, number>>;
  first_divergence: Record<string, Record<string, number>>;
  agreement: {
    rule_vs_injected: { n: number; agree: number };
    judge_vs_rule: { n: number; agree: number };
    gold: {
      n: number;
      labeler: string;
      rule_correct: number;
      judge_n: number;
      judge_correct: number;
      rule_div_within1: number;
      rows: {
        id: string;
        gold: Category;
        gold_first_div: number | null;
        rule: Category | null;
        judge: Category | null;
        rule_first_div: number | null;
        judge_first_div: number | null;
        rationale: string;
      }[];
    };
  };
  disagreements: string[];
  signals: { id: string; category: Category; n_fail: number; n_latent: number; example: string; example_id: string }[];
  multi_fault: { id: string; config_id: string; task_id: string; injected: string[]; rule: Category | null }[];
  latent: { id: string; config_id: string; task_id: string; signals: string[] }[];
}

export interface Meta {
  generated_at: string;
  n_trajectories: number;
  n_configs: number;
  n_tasks: number;
  n_failures: number;
  n_real: number;
  real_models: string[];
  judge: { n_labeled: number; models: string[] };
  n_plots: number;
  dataset: { genes: number; guides_per_gene: number; non_targeting: number; samples: number; seed: number };
}
