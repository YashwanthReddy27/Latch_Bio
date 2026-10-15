// Grader parity: the TypeScript engine must reproduce every verdict in the shared fixture file
// that pytest also checks (bench/tests/fixtures/grader_cases.json).
//   npm run test:parity
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { grade, type TaskLike } from "../lib/graders/engine";
import { taskMessage } from "../lib/live/shared";

const root = path.resolve(__dirname, "..", "..");
const cases = JSON.parse(fs.readFileSync(path.join(root, "bench/tests/fixtures/grader_cases.json"), "utf-8")) as {
  task_id: string;
  name: string;
  answer: unknown;
  expected: { passed: boolean; score: number; error_kind: string | null; checks: boolean[] };
}[];
const tasksDir = path.join(root, "bench/bench/tasks");
const tasks: Record<string, TaskLike> = {};
for (const f of fs.readdirSync(tasksDir).filter((f) => /^T\d+\.json$/.test(f))) {
  tasks[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(tasksDir, f), "utf-8"));
}

test("fixture file is substantial", () => {
  assert.ok(cases.length >= 100);
});

test("generated web copy of tasks matches bench tasks", () => {
  const gen = path.join(__dirname, "..", "lib", "generated", "tasks.json");
  const webTasks = JSON.parse(fs.readFileSync(gen, "utf-8")) as (TaskLike & { id: string })[];
  for (const t of webTasks) assert.deepEqual(t.grader, tasks[t.id].grader, `grader drift for ${t.id}`);
});

for (const c of cases) {
  test(`${c.task_id}: ${c.name}`, () => {
    const r = grade(tasks[c.task_id], c.answer);
    assert.deepEqual(
      { passed: r.passed, score: r.score, error_kind: r.error_kind, checks: r.checks.map((x) => x.passed) },
      c.expected,
    );
  });
}

// The live route must send Gemini exactly the prompt the offline harness sends.
test("TS task prompts match bench.harness.task_message", () => {
  const msgs = JSON.parse(fs.readFileSync(path.join(root, "bench/tests/fixtures/task_messages.json"), "utf-8")) as Record<string, string>;
  const gen = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "lib", "generated", "tasks.json"), "utf-8"));
  for (const t of gen) assert.equal(taskMessage(t), msgs[t.id], `prompt drift for ${t.id}`);
});
