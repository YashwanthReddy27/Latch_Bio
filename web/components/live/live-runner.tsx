"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Pause, Play, RotateCcw, Square } from "lucide-react";
import type { Category, ConfigRow, GradeResult, Step, TaskSpec, Trajectory } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";
import { grade as gradeAnswer, type TaskLike } from "@/lib/graders/engine";
import { BrowserSandbox } from "@/lib/live/sandbox-client";
import { MAX_STEPS, NUDGE_TEXT, type GContent, type GPart, type StepResponse } from "@/lib/live/shared";
import { digest, gradeSummary } from "@/lib/live/digest";
import { StepCard } from "@/components/trajectory/step-card";
import { GraderPanel } from "@/components/trajectory/panels";
import { CategoryTag, KindBadge, Note, PassChip, buttonClass } from "@/components/ui/primitives";
import { PassRateBar } from "@/components/charts/leaderboard";
import { compact, secs, usd, cn } from "@/lib/format";

type Mode = "checking" | "live" | "replay" | "paused";
type Phase = "idle" | "booting" | "running" | "grading" | "judging" | "done" | "error" | "stopped";

interface Status {
  configured: boolean;
  mode: "live" | "replay" | "paused";
  model?: string;
  remaining?: number;
  limits?: { runsPerHour: number };
}

interface JudgeOut {
  category: Category;
  first_divergence_step: number;
  evidence_step_ids: number[];
  explanation: string;
  model: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function taskFiles(task: TaskSpec) {
  return task.inputs.map((f) => ({ path: f, url: f === "candidates.json" ? `/tasks/T10/${f}` : `/tasks/screen/${f}` }));
}

function compactForModel(out: Record<string, unknown>) {
  const o = { ...out };
  delete o.exec_s;
  if (Array.isArray(o.images)) o.images = (o.images as string[]).map((_, i) => `<figure ${i + 1} captured>`);
  return o;
}

export function LiveRunner({ tasks, configs, replays }: { tasks: TaskSpec[]; configs: ConfigRow[]; replays: Record<string, { id: string; kind: string }> }) {
  const params = useSearchParams();
  const [taskId, setTaskId] = useState<string>(() => {
    const t = params.get("task");
    return t && tasks.some((x) => x.id === t) ? t : "T08";
  });
  const [variant, setVariant] = useState<"minimal" | "careful">("careful");
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("checking");
  const [reexec, setReexec] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [boot, setBoot] = useState<{ stage: string; pct: number } | null>(null);
  const [versions, setVersions] = useState<Record<string, string> | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<{ grade: GradeResult; status: string; answer: unknown } | null>(null);
  const [judge, setJudge] = useState<JudgeOut | null>(null);
  const [judgeNote, setJudgeNote] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [replaySource, setReplaySource] = useState<{ id: string; kind: string; config: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [replayRule, setReplayRule] = useState<{ category: Category; div: number | null } | null>(null);
  const sandbox = useRef<BrowserSandbox | null>(null);
  const stopRef = useRef(false);
  const t0 = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const task = tasks.find((t) => t.id === taskId)!;
  const labelOf = useMemo(() => Object.fromEntries(configs.map((c) => [c.id, c.label])), [configs]);

  useEffect(() => {
    fetch("/api/agent/status")
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        setMode(s.configured ? (s.mode === "live" ? "live" : "paused") : "replay");
      })
      .catch(() => setMode("replay"));
    return () => sandbox.current?.terminate();
  }, []);

  useEffect(() => {
    if (phase !== "running" && phase !== "booting" && phase !== "judging" && phase !== "grading") return;
    const id = setInterval(() => setElapsed((performance.now() - t0.current) / 1000), 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [steps.length, result]);

  const ensureSandbox = useCallback(async () => {
    if (!sandbox.current) sandbox.current = new BrowserSandbox((stage, pct) => setBoot({ stage, pct }));
    setPhase("booting");
    const wasReady = !!sandbox.current.ready;
    const v = await sandbox.current.init(taskFiles(task));
    if (wasReady) await sandbox.current.reset();
    setVersions(v);
    setBoot(null);
  }, [task]);

  const reset = () => {
    stopRef.current = false;
    setSteps([]);
    setResult(null);
    setJudge(null);
    setJudgeNote(null);
    setMessage(null);
    setReplaySource(null);
    setReplayRule(null);
    setElapsed(0);
    t0.current = performance.now();
  };

  async function execTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sb = sandbox.current!;
    if (name === "run_python") return { ...(await sb.run(String(args.code ?? ""))) };
    if (name === "list_files") return await sb.listFiles();
    if (name === "read_file") return await sb.readFile(String(args.path ?? ""), Number(args.max_bytes ?? 4000));
    if (name === "submit_answer") {
      const raw = args.answer_json ?? args.answer;
      if (typeof raw === "string") {
        try {
          return { accepted: true, answer: JSON.parse(raw) };
        } catch (e) {
          return { accepted: false, error: `answer_json is not valid JSON: ${(e as Error).message}`, raw: raw.slice(0, 500) };
        }
      }
      return { accepted: true, answer: raw };
    }
    return { error: `unknown tool '${name}'` };
  }

  function finish(answer: unknown, runStatus: string, stepsSoFar: Step[]) {
    setPhase("grading");
    const g = gradeAnswer(task as unknown as TaskLike, runStatus === "submitted" ? answer : null) as GradeResult;
    setResult({ grade: g, status: runStatus, answer });
    return { g, stepsSoFar };
  }

  // ------------------------------------------------------------------ live (Gemini)
  async function runLive() {
    reset();
    setPhase("booting");
    let start: { token: string; contents: GContent[]; model: string; error?: string; message?: string };
    try {
      const res = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: task.id, variant }),
      });
      start = await res.json();
      if (!res.ok) {
        setMessage(start.message ?? "Could not start a live run.");
        if (start.error === "rate_limited" || start.error === "paused") setMode("paused");
        setPhase("error");
        return;
      }
    } catch {
      setMessage("Network error starting the run.");
      setPhase("error");
      return;
    }
    try {
      await ensureSandbox();
    } catch (e) {
      setBoot(null);
      setMessage(`The in-browser Python sandbox failed to load: ${(e as Error).message}`);
      setPhase("error");
      return;
    }
    setPhase("running");
    const contents: GContent[] = [...start.contents];
    const acc: Step[] = [];
    let answer: unknown = null;
    let runStatus = "max_steps";
    let nudges = 0;
    outer: while (acc.length < MAX_STEPS) {
      if (stopRef.current) {
        runStatus = "stopped";
        break;
      }
      let r: StepResponse & { error?: string; message?: string };
      try {
        const res = await fetch("/api/agent/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: start.token, contents }),
        });
        r = await res.json();
        if (!res.ok) {
          setMessage(r.message ?? "Live run stopped by the server.");
          if (r.error === "paused" || r.error === "rate_limited") setMode("paused");
          runStatus = "agent_error";
          break;
        }
      } catch {
        setMessage("Network error during the run.");
        runStatus = "agent_error";
        break;
      }
      contents.push(r.content);
      if (!r.calls.length) {
        nudges += 1;
        if (nudges > 2) {
          runStatus = "no_submission";
          break;
        }
        contents.push({ role: "user", parts: [{ text: NUDGE_TEXT }] });
        continue;
      }
      const responses: GPart[] = [];
      for (const [k, call] of r.calls.entries()) {
        const out = await execTool(call.name, call.args);
        const step: Step = {
          i: acc.length,
          thought: k === 0 ? r.thought : "",
          tool: call.name,
          args: call.args,
          output: { ...out, images: undefined } as Step["output"],
          images: (out.images as string[]) ?? [],
          tokens_in: k === 0 ? r.usage.tokens_in : 0,
          tokens_out: k === 0 ? r.usage.tokens_out : 0,
          tokens_thinking: k === 0 ? r.usage.tokens_thinking : 0,
          cost_usd: k === 0 ? r.cost_usd : 0,
          latency_s: k === 0 ? r.latency_s : 0,
          exec_s: Number(out.exec_s ?? 0),
          milestones: [],
        };
        acc.push(step);
        setSteps([...acc]);
        responses.push({ functionResponse: { id: call.id, name: call.name, response: { result: compactForModel(out) } } });
        if (call.name === "submit_answer" && out.accepted) {
          answer = out.answer;
          runStatus = "submitted";
          break outer;
        }
        if (acc.length >= MAX_STEPS) break outer;
      }
      contents.push({ role: "user", parts: responses });
    }
    const { g } = finish(answer, runStatus, acc);
    if (!g.passed && runStatus !== "stopped") {
      setPhase("judging");
      try {
        const res = await fetch("/api/label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: start.token, digest: digest(acc), grade_summary: gradeSummary(g, runStatus), status: runStatus, n_steps: acc.length }),
        });
        const j = await res.json();
        if (res.ok) setJudge(j);
        else setJudgeNote(j.message ?? "Judge unavailable.");
      } catch {
        setJudgeNote("Judge request failed.");
      }
    }
    setPhase(runStatus === "stopped" ? "stopped" : "done");
  }

  // ------------------------------------------------------------------ replay (cached run)
  async function runReplay() {
    reset();
    const src = replays[task.id];
    if (!src) {
      setMessage("No cached run for this task.");
      setPhase("error");
      return;
    }
    setPhase("booting");
    const traj: Trajectory = await fetch(`/data/traj/${src.id}.json`).then((r) => r.json());
    setReplaySource({ id: src.id, kind: traj.kind, config: traj.config_id });
    let canExec = false;
    if (reexec) {
      try {
        await ensureSandbox();
        canExec = true;
      } catch (e) {
        setBoot(null);
        setMessage(`Pyodide failed to load (${(e as Error).message}); replaying stored outputs instead.`);
      }
    }
    setPhase("running");
    const acc: Step[] = [];
    let answer: unknown = null;
    for (const s of traj.steps) {
      if (stopRef.current) break;
      await sleep(Math.min(1400, 350 + (s.latency_s || 0) * 150));
      let output = s.output;
      let images = s.images.map((p) => `/data/${p}`);
      let exec_s = s.exec_s;
      if (canExec && s.tool !== "submit_answer") {
        const out = await execTool(s.tool, s.args);
        images = (out.images as string[]) ?? [];
        exec_s = Number(out.exec_s ?? 0);
        output = { ...out, images: undefined } as Step["output"];
      }
      const step: Step = { ...s, output, images, exec_s, milestones: s.milestones ?? [] };
      acc.push(step);
      setSteps([...acc]);
      if (s.tool === "submit_answer" && s.output.accepted) answer = s.output.answer;
    }
    const runStatus = stopRef.current ? "stopped" : traj.status;
    const { g } = finish(answer, runStatus, acc);
    if (!g.passed && traj.labels.judge) setJudge(traj.labels.judge as JudgeOut);
    else if (!g.passed) setJudgeNote("Replay mode: the Gemini judge only runs on live runs (or offline via bench.judge). Rule-based label for this cached run is shown below.");
    if (!g.passed && traj.labels.rule.category) setReplayRule({ category: traj.labels.rule.category, div: traj.labels.rule.first_divergence_step });
    setPhase(stopRef.current ? "stopped" : "done");
  }
  const busy = phase === "booting" || phase === "running" || phase === "grading" || phase === "judging";
  const totals = useMemo(
    () => ({
      tokens: steps.reduce((s, x) => s + x.tokens_in + x.tokens_out + x.tokens_thinking, 0),
      cost: steps.reduce((s, x) => s + x.cost_usd, 0),
    }),
    [steps],
  );
  const effectiveMode: "live" | "replay" = mode === "live" ? "live" : "replay";

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* ---------------------------------------------------------------- control panel */}
      <aside className="grid content-start gap-3 lg:sticky lg:top-16">
        <section className="rounded border border-border bg-surface p-3" aria-label="Run setup">
          <ModeBanner mode={mode} status={status} />
          <label className="mt-3 grid gap-1 text-2xs font-medium uppercase tracking-[0.06em] text-muted">
            Task
            <select
              value={taskId}
              disabled={busy}
              onChange={(e) => {
                setTaskId(e.target.value);
                reset();
                setPhase("idle");
              }}
              className="rounded border border-border-strong bg-surface px-2 py-1.5 text-[13px] normal-case tracking-normal text-ink"
            >
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.title}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-[12.5px] text-ink-2">{task.prompt}</p>
          {effectiveMode === "live" ? (
            <fieldset className="mt-3" disabled={busy}>
              <legend className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">System prompt</legend>
              <div className="mt-1 flex gap-3 text-[13px]">
                {(["careful", "minimal"] as const).map((v) => (
                  <label key={v} className="flex items-center gap-1.5">
                    <input type="radio" name="variant" checked={variant === v} onChange={() => setVariant(v)} className="accent-[var(--accent)]" />
                    {v === "careful" ? "Careful analyst (QC first)" : "Minimal"}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <label className="mt-3 flex items-start gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={reexec} disabled={busy} onChange={(e) => setReexec(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              Re-execute the cached agent&apos;s code in your browser (Pyodide) instead of showing stored outputs
            </label>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!busy ? (
              <button
                type="button"
                className={buttonClass("primary", "md")}
                onClick={() => (effectiveMode === "live" ? runLive() : runReplay())}
                disabled={mode === "checking"}
              >
                {phase === "done" || phase === "stopped" || phase === "error" ? <RotateCcw size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                {effectiveMode === "live" ? "Run Gemini agent" : "Play replay"}
              </button>
            ) : (
              <button type="button" className={buttonClass("secondary", "md")} onClick={() => (stopRef.current = true)}>
                <Square size={13} aria-hidden /> Stop
              </button>
            )}
            {mode === "live" && !busy && (
              <button type="button" className={buttonClass("ghost", "md")} onClick={() => runReplay()}>
                Watch replay instead
              </button>
            )}
          </div>
          {message && (
            <p className="mt-3 rounded border border-warn bg-warn-soft px-2.5 py-2 text-xs text-ink" role="status">
              {message}
            </p>
          )}
        </section>

        <section className="rounded border border-border bg-surface p-3" aria-label="Run meters">
          <dl className="num grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
            <Meter k="Phase" v={phase} />
            <Meter k="Elapsed" v={secs(elapsed)} />
            <Meter k="Steps" v={`${steps.length} / ${MAX_STEPS}`} />
            <Meter k="Tokens" v={compact(totals.tokens)} />
            <Meter k="Cost" v={usd(totals.cost)} />
            <Meter k="Sandbox" v={versions ? `Py ${versions.python}` : "not loaded"} />
          </dl>
          {versions && (
            <p className="mt-2 text-[11px] text-muted">
              Pyodide in a Web Worker · numpy {versions.numpy} · pandas {versions.pandas} · scipy {versions.scipy}
            </p>
          )}
        </section>
      </aside>

      {/* ---------------------------------------------------------------- stream */}
      <div className="min-w-0">
        {boot && (
          <div className="mb-3 rounded border border-border bg-surface p-3" role="status" aria-live="polite">
            <div className="mb-1.5 flex items-center gap-2 text-[13px]">
              <Cpu size={14} aria-hidden className="text-accent" /> {boot.stage}
              <span className="num ml-auto text-xs text-muted">{boot.pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={boot.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Sandbox loading">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${boot.pct}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-muted">First load downloads ~30 MB from the Pyodide CDN; later runs reuse it.</p>
          </div>
        )}

        {replaySource && (
          <div className="mb-3">
            <Note>
              <span className="font-medium">Replay</span> of cached run{" "}
              <Link href={`/trajectories/${replaySource.id}`} className="text-accent hover:underline">
                {labelOf[replaySource.config] ?? replaySource.config} · {task.id}
              </Link>{" "}
              (<KindBadge kind={replaySource.kind as "REAL"} />).{" "}
              {replaySource.kind !== "REAL" && "No REAL Gemini run is cached yet, so this replays a SIMULATED trajectory. "}
              {reexec ? "Code is re-executed live in your browser; " : "Stored outputs are shown; "}
              the answer is re-graded by the TypeScript port of the grader.
            </Note>
          </div>
        )}

        {phase === "idle" && !steps.length && (
          <div className="rounded border border-dashed border-border-strong bg-surface px-5 py-10 text-center">
            <p className="text-[15px] font-medium">{effectiveMode === "live" ? "Run a Gemini agent on this task" : "Replay a cached agent run"}</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-2">
              Each thought, code cell, output and figure appears as it happens. Python runs in your browser; the deterministic grader scores the
              answer, and a failed run is labeled by the judge.
            </p>
          </div>
        )}

        <ol className="grid gap-2.5" aria-live="polite" aria-label="Live trajectory">
          {steps.map((s) => (
            <li key={s.i} className="animate-[fadein_.25s_ease-out]">
              <StepCard step={s} imageBase="" anchorPrefix="live-step" />
            </li>
          ))}
          {phase === "running" && (
            <li className="flex items-center gap-2 rounded border border-dashed border-border-strong px-3 py-2 text-[12.5px] text-muted">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
              {effectiveMode === "live" && !replaySource ? "Waiting for Gemini…" : "Next step…"}
            </li>
          )}
        </ol>

        {result && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <GraderPanel grade={result.grade} title="Deterministic grader (run in your browser)" />
            <section className="rounded border border-border bg-surface" aria-label="Failure label">
              <header className="flex items-center justify-between border-b border-border px-3 py-2">
                <h2 className="text-[13px] font-semibold">Failure label</h2>
                {phase === "judging" && <span className="text-xs text-muted">judging…</span>}
              </header>
              <div className="grid gap-2 px-3 py-2.5 text-[12.5px]">
                {result.grade.passed ? (
                  <p className="text-ink-2">Passed: no label needed.</p>
                ) : (
                  <>
                    {judge && (
                      <div>
                        <p className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">Gemini judge · {judge.model}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3">
                          <CategoryTag category={judge.category} />
                          <a href={`#live-step-${judge.first_divergence_step}`} className="num text-xs text-accent hover:underline">
                            first divergence: step {judge.first_divergence_step}
                          </a>
                        </div>
                        <p className="mt-1 text-ink-2">{judge.explanation}</p>
                        {replayRule && replayRule.category !== judge.category && (
                          <p className="mt-1 rounded-sm bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">
                            judge / rule disagreement: rules say {CATEGORY_LABEL[replayRule.category]}
                          </p>
                        )}
                      </div>
                    )}
                    {judgeNote && <p className="text-muted">{judgeNote}</p>}
                    {replayRule && (
                      <div>
                        <p className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">Rule-based (offline)</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3">
                          <CategoryTag category={replayRule.category} />
                          {replayRule.div !== null && (
                            <a href={`#live-step-${replayRule.div}`} className="num text-xs text-accent hover:underline">
                              first divergence: step {replayRule.div}
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>
        )}

        {result && (phase === "done" || phase === "stopped") && (
          <LeaderboardCompare task={task} configs={configs} run={{ passed: result.grade.passed, steps: steps.length, tokens: totals.tokens, cost: totals.cost }} label={replaySource ? "This replay" : `This run (${status?.model ?? "Gemini"} · ${variant})`} />
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Meter({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-sans text-2xs uppercase tracking-[0.06em] text-muted">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </div>
  );
}

function ModeBanner({ mode, status }: { mode: Mode; status: Status | null }) {
  const cls = "flex items-start gap-2 rounded px-2.5 py-2 text-[12.5px]";
  if (mode === "checking") return <p className={cn(cls, "bg-surface-2 text-muted")}>Checking live-run availability…</p>;
  if (mode === "live")
    return (
      <p className={cn(cls, "bg-accent-soft text-ink")}>
        <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
        <span>
          <span className="font-medium">Live</span> · {status?.model} · {status?.remaining} of {status?.limits?.runsPerHour} runs left this hour
        </span>
      </p>
    );
  if (mode === "paused")
    return (
      <p className={cn(cls, "bg-warn-soft text-ink")}>
        <Pause size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <span>
          <span className="font-medium">Live runs temporarily paused</span> (rate limit or quota). Replays still work.
        </span>
      </p>
    );
  return (
    <p className={cn(cls, "bg-surface-2 text-ink-2")}>
      <Play size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">Replay</span> · no Gemini key is configured on this deployment, so cached runs are replayed with the same
        streaming UI.
      </span>
    </p>
  );
}

function LeaderboardCompare({ task, configs, run, label }: { task: TaskSpec; configs: ConfigRow[]; run: { passed: boolean; steps: number; tokens: number; cost: number }; label: string }) {
  return (
    <section className="mt-4 rounded border border-border bg-surface" aria-label="Compare with leaderboard">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-[13px] font-semibold">Compare with leaderboard · {task.id}</h2>
        <p className="text-xs text-muted">This run next to the stored configurations on the same task.</p>
      </header>
      <div className="-mx-0 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-2xs uppercase tracking-[0.06em] text-muted">
              <th scope="col" className="px-3 py-1.5 font-medium">Config</th>
              <th scope="col" className="px-3 py-1.5 font-medium">Pass rate on {task.id}</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Runs</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border bg-accent-soft">
              <th scope="row" className="px-3 py-2 text-left font-medium">{label}</th>
              <td className="px-3 py-2">
                <PassChip passed={run.passed} /> <span className="num ml-2 text-xs text-muted">{run.steps} steps · {compact(run.tokens)} tok · {usd(run.cost)}</span>
              </td>
              <td className="num px-3 py-2 text-right">1</td>
            </tr>
            {configs.map((c) => {
              const cell = c.per_task[task.id];
              const rate = cell?.n ? cell.pass / cell.n : 0;
              return (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    <Link href={`/trajectories?config=${c.id}&task=${task.id}`} className="hover:text-accent">{c.label}</Link> <KindBadge kind={c.kind} />
                  </th>
                  <td className="px-3 py-1.5">
                    <PassRateBar rate={rate} ci={[rate, rate]} />
                  </td>
                  <td className="num px-3 py-1.5 text-right">{cell?.pass}/{cell?.n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
