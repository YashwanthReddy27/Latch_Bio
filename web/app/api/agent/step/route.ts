import { GoogleGenAI } from "@google/genai";
import {
  clientIp,
  consumeStep,
  geminiConfig,
  getTask,
  hashIp,
  isQuotaError,
  json,
  LIMITS,
  pauseLive,
  readJsonBody,
  verifyToken,
} from "@/lib/live/server";
import { MAX_STEPS, NUDGE_TEXT, SYSTEM_PROMPTS, TOOLS, priceFor, taskMessage, type GContent, type GPart, type PromptVariant } from "@/lib/live/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_PART_KEYS = new Set(["text", "thought", "thoughtSignature", "functionCall", "functionResponse"]);

/**
 * The conversation must be a benchmark run: it starts with the exact task message for the task in
 * the signed token, user turns after that carry only tool results (or the fixed nudge), and parts
 * are restricted to text / function calls / function responses. This keeps the key from being
 * used as a general-purpose chatbot even by someone calling the API directly.
 */
function validate(contents: unknown, expectedFirst: string): GContent[] | string {
  if (!Array.isArray(contents) || contents.length === 0) return "contents must be a non-empty array";
  if (contents.length > MAX_STEPS * 2 + 6) return "conversation is too long";
  const out: GContent[] = [];
  let modelTurns = 0;
  for (const [i, c] of contents.entries()) {
    if (!c || (c.role !== "user" && c.role !== "model") || !Array.isArray(c.parts) || c.parts.length > 12) return `bad content at ${i}`;
    const parts: GPart[] = [];
    for (const p of c.parts) {
      if (!p || typeof p !== "object") return `bad part at ${i}`;
      for (const k of Object.keys(p)) if (!ALLOWED_PART_KEYS.has(k)) return `part field '${k}' is not allowed`;
      parts.push(p as GPart);
    }
    if (c.role === "model") modelTurns += 1;
    if (i === 0) {
      if (c.role !== "user" || parts.length !== 1 || parts[0].text !== expectedFirst) return "first turn must be the task prompt";
    } else if (c.role === "user") {
      const ok = parts.every((p) => p.functionResponse || p.text === NUDGE_TEXT);
      if (!ok) return "user turns may only contain tool results";
    }
    out.push({ role: c.role, parts });
  }
  if (out[out.length - 1].role !== "user") return "last turn must be a user turn";
  if (modelTurns >= MAX_STEPS) return "step limit reached";
  return out;
}

export async function POST(req: Request) {
  const cfg = geminiConfig();
  if (!cfg) return json({ error: "not_configured" }, 503);
  const body = await readJsonBody<{ token?: string; contents?: unknown }>(req);
  if (!body) return json({ error: "too_large", message: `Request exceeds ${LIMITS.maxRequestBytes} bytes or is not JSON.` }, 413);

  const ip = clientIp(req);
  const claims = verifyToken(body.token, ip);
  if (!claims) return json({ error: "bad_token", message: "Run token missing, invalid or expired. Start a new run." }, 401);
  const task = getTask(claims.task);
  if (!task) return json({ error: "bad_request" }, 400);

  const contents = validate(body.contents, taskMessage(task));
  if (typeof contents === "string") return json({ error: "bad_request", message: contents }, 400);

  const step = await consumeStep(hashIp(ip), claims.rid);
  if (!step.ok) return json({ error: "rate_limited", message: `Live run stopped: ${step.reason}.` }, 429);

  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  const t0 = Date.now();
  try {
    const resp = await ai.models.generateContent({
      model: cfg.model,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPTS[claims.variant as PromptVariant] ?? SYSTEM_PROMPTS.minimal,
        tools: [{ functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
        maxOutputTokens: LIMITS.maxOutputTokens,
        temperature: 1.0,
        thinkingConfig: { includeThoughts: true },
      },
    });
    const cand = resp.candidates?.[0];
    const parts = (cand?.content?.parts ?? []) as GPart[];
    const content: GContent = { role: "model", parts: parts.map((p) => pick(p)) };
    const calls = parts
      .filter((p) => p.functionCall)
      .map((p) => ({ id: p.functionCall!.id, name: p.functionCall!.name, args: (p.functionCall!.args ?? {}) as Record<string, unknown> }));
    const um = resp.usageMetadata;
    const tokens_in = um?.promptTokenCount ?? 0;
    const tokens_out = um?.candidatesTokenCount ?? 0;
    const tokens_thinking = um?.thoughtsTokenCount ?? 0;
    const [pin, pout] = priceFor(cfg.model);
    return json({
      content,
      calls,
      thought: parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("\n")
        .trim(),
      usage: { tokens_in, tokens_out, tokens_thinking },
      latency_s: (Date.now() - t0) / 1000,
      cost_usd: (tokens_in * pin + (tokens_out + tokens_thinking) * pout) / 1e6,
      finish_reason: cand?.finishReason ?? null,
    });
  } catch (e) {
    if (isQuotaError(e)) {
      await pauseLive();
      return json({ error: "paused", message: "Gemini quota reached. Live runs are temporarily paused." }, 503);
    }
    return json({ error: "upstream", message: "Gemini request failed." }, 502);
  }
}

function pick(p: GPart): GPart {
  const o: GPart = {};
  if (p.text !== undefined) o.text = p.text;
  if (p.thought !== undefined) o.thought = p.thought;
  if (p.thoughtSignature !== undefined) o.thoughtSignature = p.thoughtSignature;
  if (p.functionCall) o.functionCall = { id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args ?? {} };
  return o;
}
