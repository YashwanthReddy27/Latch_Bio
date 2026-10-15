import "server-only";
import crypto from "node:crypto";
import tasksJson from "@/lib/generated/tasks.json";
import type { TaskForPrompt } from "./shared";

// ------------------------------------------------------------------------------------ config

export const LIMITS = {
  runsPerHour: Number(process.env.LIVE_RUNS_PER_HOUR ?? 5),
  stepsPerHour: Number(process.env.LIVE_STEPS_PER_HOUR ?? 150),
  dailyRunCap: Number(process.env.LIVE_DAILY_RUN_CAP ?? 200),
  maxOutputTokens: Number(process.env.LIVE_MAX_OUTPUT_TOKENS ?? 4096),
  maxRequestBytes: 300_000,
  tokenTtlS: 30 * 60,
};

export function geminiConfig(): { apiKey: string; model: string } | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!apiKey || !model) return null;
  return { apiKey, model };
}

export function liveDisabled(): boolean {
  return process.env.LIVE_RUNS_DISABLED === "1";
}

const TASKS = tasksJson as unknown as (TaskForPrompt & Record<string, unknown>)[];
export function getTask(id: string) {
  return TASKS.find((t) => t.id === id) ?? null;
}

// ------------------------------------------------------------------------------------ client ip

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

// ------------------------------------------------------------------------------------ run tokens
// HMAC-signed, short-lived token issued by /api/agent/start. /step and /label require it, so the
// key can only be used for a benchmark run that started through the rate-limited entry point.

function secret(): string {
  return process.env.RUN_TOKEN_SECRET || crypto.createHash("sha256").update(`helix:${process.env.GEMINI_API_KEY ?? "none"}`).digest("hex");
}

export interface RunClaims {
  rid: string;
  task: string;
  variant: string;
  ip: string;
  exp: number;
}

export function signToken(c: RunClaims): string {
  const body = Buffer.from(JSON.stringify(c)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: unknown, ip: string): RunClaims | null {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as RunClaims;
    if (c.exp < Date.now() / 1000) return null;
    if (c.ip !== hashIp(ip)) return null;
    return c;
  } catch {
    return null;
  }
}

export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(`${secret()}|${ip}`).digest("hex").slice(0, 16);
}

// ------------------------------------------------------------------------------------ rate limit
// Fixed-window counters. Uses Upstash Redis / Vercel KV over REST when configured (shared across
// serverless instances); otherwise an in-memory Map (per instance; fine for a demo, documented).

const mem = new Map<string, { n: number; reset: number }>();

function kvEnv(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function incr(key: string, windowS: number): Promise<number> {
  const kv = kvEnv();
  if (kv) {
    try {
      const res = await fetch(`${kv.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${kv.token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, String(windowS), "NX"],
        ]),
        cache: "no-store",
      });
      const out = (await res.json()) as { result: number }[];
      return Number(out[0]?.result ?? 0);
    } catch {
      // fall through to memory if KV is unreachable
    }
  }
  const now = Date.now();
  const cur = mem.get(key);
  if (!cur || cur.reset < now) {
    mem.set(key, { n: 1, reset: now + windowS * 1000 });
    return 1;
  }
  cur.n += 1;
  return cur.n;
}

async function peek(key: string): Promise<number> {
  const kv = kvEnv();
  if (kv) {
    try {
      const res = await fetch(`${kv.url}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${kv.token}` },
        cache: "no-store",
      });
      const out = (await res.json()) as { result: string | null };
      return Number(out.result ?? 0);
    } catch {
      /* memory fallback */
    }
  }
  const cur = mem.get(key);
  return cur && cur.reset > Date.now() ? cur.n : 0;
}

const hourKey = () => Math.floor(Date.now() / 3_600_000);
const dayKey = () => Math.floor(Date.now() / 86_400_000);

export async function consumeRun(ipHash: string): Promise<{ ok: boolean; reason?: "ip" | "global"; remaining: number }> {
  const daily = await incr(`helix:runs:day:${dayKey()}`, 86_400);
  if (daily > LIMITS.dailyRunCap) return { ok: false, reason: "global", remaining: 0 };
  const n = await incr(`helix:runs:${ipHash}:${hourKey()}`, 3600);
  if (n > LIMITS.runsPerHour) return { ok: false, reason: "ip", remaining: 0 };
  return { ok: true, remaining: LIMITS.runsPerHour - n };
}

export async function consumeStep(ipHash: string, rid: string): Promise<{ ok: boolean; reason?: string }> {
  const perRun = await incr(`helix:steps:run:${rid}`, LIMITS.tokenTtlS);
  if (perRun > 25 + 3) return { ok: false, reason: "step budget for this run is exhausted" };
  const perIp = await incr(`helix:steps:${ipHash}:${hourKey()}`, 3600);
  if (perIp > LIMITS.stepsPerHour) return { ok: false, reason: "hourly step limit reached" };
  return { ok: true };
}

export async function consumeLabel(rid: string): Promise<boolean> {
  return (await incr(`helix:label:${rid}`, LIMITS.tokenTtlS)) <= 1;
}

export async function runsRemaining(ipHash: string): Promise<number> {
  return Math.max(0, LIMITS.runsPerHour - (await peek(`helix:runs:${ipHash}:${hourKey()}`)));
}

export async function globalPaused(): Promise<boolean> {
  if (liveDisabled()) return true;
  if ((await peek(`helix:paused`)) > 0) return true;
  return (await peek(`helix:runs:day:${dayKey()}`)) >= LIMITS.dailyRunCap;
}

/** Called when Gemini returns 429 / quota errors: pause live runs for 15 minutes. */
export async function pauseLive(): Promise<void> {
  await incr(`helix:paused`, 900);
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function readJsonBody<T>(req: Request): Promise<T | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > LIMITS.maxRequestBytes) return null;
  const text = await req.text();
  if (text.length > LIMITS.maxRequestBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function isQuotaError(e: unknown): boolean {
  const s = String((e as { status?: number })?.status ?? "") + " " + String((e as Error)?.message ?? e);
  return /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(s);
}
