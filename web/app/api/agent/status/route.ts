import { clientIp, geminiConfig, globalPaused, hashIp, json, LIMITS, runsRemaining } from "@/lib/live/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = geminiConfig();
  if (!cfg) return json({ configured: false, mode: "replay" });
  const paused = await globalPaused();
  const remaining = await runsRemaining(hashIp(clientIp(req)));
  return json({
    configured: true,
    mode: paused || remaining <= 0 ? "paused" : "live",
    model: cfg.model,
    paused,
    remaining,
    limits: { runsPerHour: LIMITS.runsPerHour, maxSteps: 25 },
  });
}
