import { GoogleGenAI } from "@google/genai";
import prompt from "@/lib/generated/judge-prompt.json";
import { clientIp, consumeLabel, geminiConfig, getTask, isQuotaError, json, readJsonBody, verifyToken, pauseLive } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  token?: string;
  digest?: string;
  grade_summary?: string;
  status?: string;
  n_steps?: number;
}

/** Gemini failure judge for a live run. Same prompt + schema as bench/bench/judge.py (exported JSON). */
export async function POST(req: Request) {
  const cfg = geminiConfig();
  if (!cfg) return json({ error: "not_configured" }, 503);
  const body = await readJsonBody<Body>(req);
  if (!body || typeof body.digest !== "string" || typeof body.grade_summary !== "string") return json({ error: "bad_request" }, 400);
  const claims = verifyToken(body.token, clientIp(req));
  if (!claims) return json({ error: "bad_token" }, 401);
  if (!(await consumeLabel(claims.rid))) return json({ error: "rate_limited", message: "This run was already judged." }, 429);
  const task = getTask(claims.task) as (ReturnType<typeof getTask> & { title: string; grader_plain: string }) | null;
  if (!task) return json({ error: "bad_request" }, 400);

  const cats = Object.entries(prompt.categories as Record<string, string>)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const text =
    `TASK ${task.id} — ${task.title}\n${task.prompt}\n\n` +
    `Grader (deterministic): ${task.grader_plain}\n\n` +
    `${prompt.reference_summary}\n\n` +
    `Grader result:\n${body.grade_summary.slice(0, 4000)}\n\n` +
    `Failure categories:\n${cats}\n\n` +
    `Trajectory digest (${Number(body.n_steps) || 0} steps, status ${String(body.status ?? "")}):\n${body.digest.slice(0, 60_000)}`;

  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  try {
    const resp = await ai.models.generateContent({
      model: cfg.model,
      contents: text,
      config: {
        systemInstruction: prompt.system,
        responseMimeType: "application/json",
        responseJsonSchema: prompt.schema,
        temperature: 0,
        maxOutputTokens: 2048,
      },
    });
    const out = JSON.parse(resp.text ?? "{}") as { explanation?: string };
    const words = (out.explanation ?? "").split(/\s+/);
    if (words.length > 60) out.explanation = words.slice(0, 60).join(" ") + "…";
    return json({ ...out, model: cfg.model });
  } catch (e) {
    if (isQuotaError(e)) {
      await pauseLive();
      return json({ error: "paused", message: "Gemini quota reached." }, 503);
    }
    return json({ error: "upstream", message: "Judge request failed." }, 502);
  }
}
