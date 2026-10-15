// Shared between the /live client and the /api routes. Mirrors bench/bench/harness.py and
// bench/bench/agents/gemini.py so live runs and offline REAL runs see identical prompts and tools.

export const MAX_STEPS = 25;
export const MAX_OUTPUT_CHARS = 6000;
export const NUDGE_TEXT = "Continue by calling a tool. When finished, call submit_answer.";

export const TOOLS = [
  {
    name: "run_python",
    description:
      "Execute Python code in a persistent session (variables persist between calls). The working directory contains the task's input files. numpy, pandas, scipy and matplotlib are available. Use print() to see results; output is truncated to ~6,000 characters. Matplotlib figures are captured automatically.",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "Python source to execute." } },
      required: ["code"],
    },
  },
  {
    name: "list_files",
    description: "List files in the workspace with their sizes in bytes.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description: "Read the beginning of a text file in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace." },
        max_bytes: { type: "integer", description: "Maximum bytes to return (default 4000, max 20000)." },
      },
      required: ["path"],
    },
  },
  {
    name: "submit_answer",
    description: "Submit the final answer as a JSON object matching the required schema. Ends the task.",
    parameters: {
      type: "object",
      properties: { answer_json: { type: "string", description: "The answer as a JSON-encoded object." } },
      required: ["answer_json"],
    },
  },
] as const;

export const SYSTEM_PROMPTS = {
  minimal:
    "You are a data analysis agent. Use the tools to analyze the files in the workspace and answer the task. Call one tool at a time. When you are done, call submit_answer with a JSON object matching the schema.",
  careful:
    "You are a careful computational biologist analyzing a pooled CRISPR screen. Work like a reviewer would expect:\n1. Read design.md and inspect the data before any statistics.\n2. Run QC first: reads per sgRNA, zero-count guides, Gini index per sample, replicate correlation. Decide explicitly which samples to exclude and say why.\n3. Normalize for sequencing depth before computing fold changes.\n4. Compare against the correct baseline (treatment vs vehicle control unless asked otherwise) and use non-targeting guides as the null where helpful.\n5. Control the false discovery rate whenever many genes are tested.\n6. Separate core-essential fitness effects from treatment-specific effects.\n7. Before submitting, re-read the task: check the direction (enriched vs depleted), the requested count and the answer schema.\nCall one tool at a time; keep printed output short. Finish with submit_answer.",
} as const;
export type PromptVariant = keyof typeof SYSTEM_PROMPTS;

export interface TaskForPrompt {
  id: string;
  context: string;
  prompt: string;
  inputs: string[];
  answer_schema: unknown;
}

/** Python json.dumps default separators (", ", ": ") so the text matches bench.harness.task_message. */
export function pyJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(pyJson).join(", ")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(v);
}

export function taskMessage(task: TaskForPrompt): string {
  return (
    `${task.context}\n\n` +
    `TASK (${task.id}): ${task.prompt}\n\n` +
    `Input files: ${task.inputs.join(", ")}\n` +
    `Submit your final answer with submit_answer. The answer must be a JSON object matching this schema:\n` +
    `${pyJson(task.answer_schema)}\n` +
    `You have at most ${MAX_STEPS} tool calls.`
  );
}

export function truncate(text: string, limit = MAX_OUTPUT_CHARS): [string, boolean] {
  if (text.length <= limit) return [text, false];
  const head = text.slice(0, Math.floor((limit * 2) / 3));
  const tail = text.slice(text.length - Math.floor(limit / 3));
  return [`${head}\n... [${text.length - limit} chars truncated] ...\n${tail}`, true];
}

// Gemini content shapes (subset) exchanged between the browser and /api/agent/step
export interface GPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}
export interface GContent {
  role: "user" | "model";
  parts: GPart[];
}

export interface StepResponse {
  content: GContent;
  calls: { id?: string; name: string; args: Record<string, unknown> }[];
  thought: string;
  usage: { tokens_in: number; tokens_out: number; tokens_thinking: number };
  latency_s: number;
  cost_usd: number;
}

// USD per 1M tokens (standard tier through 2026-12-31; ai.google.dev/gemini-api/docs/pricing)
export const PRICES: Record<string, [number, number]> = {
  "gemini-3.8-flash": [0.75, 3.75],
  "gemini-3.6-flash": [0.75, 3.75],
  "gemini-3.5-flash-lite": [0.3, 2.5],
};
export const priceFor = (model: string): [number, number] => PRICES[model] ?? [0.75, 3.75];
