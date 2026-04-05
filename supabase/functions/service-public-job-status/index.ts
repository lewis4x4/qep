/**
 * Limited public job status (no JWT). Validates opaque tracking_token on the job,
 * or legacy PIN = last 4 alphanumeric chars of job UUID.
 *
 * Auth: anon key + x-apikey; function uses service role internally.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  try {
    let jobId: string | null = null;
    let secret = "";
    if (req.method === "POST") {
      const body = await req.json() as {
        job_id?: string;
        pin?: string;
        token?: string;
        tracking_token?: string;
      };
      jobId = body.job_id ?? null;
      secret = String(body.tracking_token ?? body.token ?? body.pin ?? "").trim();
    } else {
      const url = new URL(req.url);
      jobId = url.searchParams.get("job_id");
      secret =
        url.searchParams.get("token")?.trim() ??
          url.searchParams.get("pin")?.trim().toUpperCase() ?? "";
    }
    if (!jobId || secret.length < 4) {
      return safeJsonError("job_id and token (or legacy pin) required", 400, null);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);

    const { data: job, error } = await supabase
      .from("service_jobs")
      .select(
        "id, tracking_token, current_stage, quote_total, scheduled_start_at, customer_problem_summary, priority, status_flags",
      )
      .eq("id", jobId)
      .maybeSingle();

    if (error || !job) return safeJsonError("Not found", 404, null);

    const tokenOk = typeof job.tracking_token === "string" &&
      secret.length >= 16 && job.tracking_token === secret;
    const compact = jobId.replace(/-/g, "").toUpperCase();
    const legacyPin = compact.slice(-4);
    const legacyOk = secret.length === 4 && secret.toUpperCase() === legacyPin;

    if (!tokenOk && !legacyOk) {
      return safeJsonError("Invalid token", 403, null);
    }

    const { tracking_token: _t, ...safeJob } = job;
    return safeJsonOk({ job: safeJob }, null);
  } catch (e) {
    console.error("service-public-job-status:", e);
    return safeJsonError("Internal error", 500, null);
  }
});
