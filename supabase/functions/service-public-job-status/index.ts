/**
 * Limited public job status (no JWT). Validates only high-entropy opaque
 * tracking_token values against the stored token hash.
 *
 * Auth: anon key + x-apikey; function uses service role internally for the
 * narrow status lookup only.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { publicServiceStatusFromStage } from "../_shared/public-service-status.ts";

import { captureEdgeException } from "../_shared/sentry.ts";

const TOKEN_MIN_LENGTH = 32;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIdentity(req: Request): string {
  return req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (existing.count >= RATE_LIMIT_MAX_ATTEMPTS) return false;
  existing.count += 1;
  return true;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  try {
    let jobId: string | null = null;
    let token = "";
    if (req.method === "POST") {
      const body = await req.json() as {
        job_id?: string;
        token?: string;
        tracking_token?: string;
      };
      jobId = body.job_id ?? null;
      token = String(body.tracking_token ?? body.token ?? "").trim();
    } else {
      const url = new URL(req.url);
      jobId = url.searchParams.get("job_id");
      token = url.searchParams.get("token")?.trim() ?? "";
    }

    if (!jobId || token.length < TOKEN_MIN_LENGTH) {
      return safeJsonError("job_id and full tracking token required", 400, null);
    }

    const rateLimitKey = `${clientIdentity(req)}:${jobId}`;
    if (!checkRateLimit(rateLimitKey)) {
      return safeJsonError("Too many status attempts. Try again shortly.", 429, null);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);

    const { data: job, error } = await supabase
      .from("service_jobs")
      .select(
        "id, tracking_token_sha256, current_stage, scheduled_start_at, status_flags",
      )
      .eq("id", jobId)
      .maybeSingle();

    if (error || !job) return safeJsonError("Not found", 404, null);

    const submittedHash = await sha256Hex(token);
    const storedHash = typeof job.tracking_token_sha256 === "string"
      ? job.tracking_token_sha256.toLowerCase()
      : "";
    const tokenOk = storedHash.length > 0 && timingSafeEqualHex(storedHash, submittedHash);

    if (!tokenOk) {
      return safeJsonError("Invalid token", 403, null);
    }

    const { tracking_token_sha256: _hash, current_stage, ...rest } = job;
    const pub = publicServiceStatusFromStage(
      typeof current_stage === "string" ? current_stage : undefined,
    );
    const safeJob = {
      ...rest,
      current_stage,
      public_status: {
        headline: pub.headline,
        detail: pub.detail,
        friendly_stage: pub.friendly_stage,
      },
    };
    return safeJsonOk({ job: safeJob }, null);
  } catch (e) {
    captureEdgeException(e, { fn: "service-public-job-status", req });
    console.error("service-public-job-status:", e);
    return safeJsonError("Internal error", 500, null);
  }
});
