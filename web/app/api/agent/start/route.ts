import crypto from "node:crypto";
import { clientIp, consumeRun, geminiConfig, getTask, globalPaused, hashIp, json, LIMITS, readJsonBody, signToken } from "@/lib/live/server";
import { SYSTEM_PROMPTS, taskMessage, type PromptVariant } from "@/lib/live/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = geminiConfig();
  if (!cfg) return json({ error: "not_configured", message: "GEMINI_API_KEY / GEMINI_MODEL are not set; showing replay." }, 503);
  if (await globalPaused()) return json({ error: "paused", message: "Live runs are temporarily paused." }, 503);

  const body = await readJsonBody<{ task_id?: string; variant?: string }>(req);
  const task = body?.task_id ? getTask(body.task_id) : null;
  if (!task) return json({ error: "bad_request", message: "Unknown task." }, 400);
  const variant: PromptVariant = body?.variant === "careful" ? "careful" : "minimal";

  const ip = hashIp(clientIp(req));
  const rl = await consumeRun(ip);
  if (!rl.ok) {
    return json(
      {
        error: "rate_limited",
        message:
          rl.reason === "global"
            ? "Live runs are temporarily paused (daily budget reached)."
            : `Live runs are limited to ${LIMITS.runsPerHour} per hour per visitor.`,
      },
      429,
    );
  }

  const rid = crypto.randomUUID();
  const token = signToken({ rid, task: task.id, variant, ip, exp: Math.floor(Date.now() / 1000) + LIMITS.tokenTtlS });
  return json({
    token,
    run_id: rid,
    model: cfg.model,
    variant,
    system_prompt: SYSTEM_PROMPTS[variant],
    contents: [{ role: "user", parts: [{ text: taskMessage(task) }] }],
    remaining: rl.remaining,
  });
}
