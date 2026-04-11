/**
 * Invokes SQL dispatcher for due native follow-up reminders (in-app notifications).
 * Prefer pg_cron + crm_dispatch_due_follow_up_reminders when available; this edge
 * function mirrors hubspot-scheduler for HTTP/cron triggers.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { timingSafeEqualString } from "../_shared/timing-safe.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization")?.trim();
  const cronSecret = Deno.env.get("CRON_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!cronSecret || !authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = authHeader.slice(7);
  if (!timingSafeEqualString(token, cronSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let pLimit = 75;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.p_limit === "number" && body.p_limit > 0) {
        pLimit = Math.min(200, Math.trunc(body.p_limit));
      }
    }
  } catch {
    // ignore body parse errors
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.rpc("crm_dispatch_due_follow_up_reminders", {
      p_limit: pLimit,
    });

    if (error) {
      console.error("[crm-reminder-dispatcher] rpc failed", { message: error.message, code: error.code });
      return new Response(
        JSON.stringify({ error: "DISPATCH_RPC_FAILED", detail: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const payload = data as Record<string, unknown> | null;
    console.info("[crm-reminder-dispatcher] ok", {
      dispatched: payload?.dispatched_count ?? null,
      skipped: payload?.skipped_count ?? null,
      limit: pLimit,
    });
    return new Response(JSON.stringify(payload ?? {}), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (fatal) {
    captureEdgeException(fatal, { fn: "crm-reminder-dispatcher", req });
    console.error("[crm-reminder-dispatcher] fatal", fatal);
    const detail = fatal instanceof Error ? fatal.message : String(fatal);
    return new Response(
      JSON.stringify({ error: "DISPATCH_FATAL", detail }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
