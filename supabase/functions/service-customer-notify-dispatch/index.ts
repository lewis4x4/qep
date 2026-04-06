/**
 * Dispatches SMS/email for service_customer_notifications rows.
 * Marks delivered only on HTTP success so failed sends stay retryable.
 * Cron or manual invoke with service role.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  const authHeader = req.headers.get("Authorization")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
    return safeJsonError("Unauthorized", 401, null);
  }

  if (req.method === "GET") {
    return safeJsonOk({
      ok: true,
      function: "service-customer-notify-dispatch",
      ts: new Date().toISOString(),
    }, null);
  }

  try {
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM") ??
      "QEP Service <onboarding@resend.dev>";

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);

    // Invariant: email/sms rows must have a recipient (queued upstream by lifecycle notify).
    const { data: pending } = await supabase
      .from("service_customer_notifications")
      .select("id, job_id, channel, recipient, notification_type, metadata")
      .in("channel", ["sms", "email"])
      .not("recipient", "is", null)
      .is("metadata->>delivered", null)
      .limit(25);

    let sms_sent = 0;
    let email_sent = 0;
    let skipped = 0;

    for (const row of pending ?? []) {
      const meta = (row.metadata && typeof row.metadata === "object")
        ? row.metadata as Record<string, unknown>
        : {};
      let ok = false;

      if (!row.recipient?.trim()) {
        skipped++;
        continue;
      }

      if (row.channel === "sms") {
        if (twilioSid && twilioToken && twilioFrom && row.recipient) {
          const body = new URLSearchParams({
            To: row.recipient,
            From: twilioFrom,
            Body: `QEP Service: ${row.notification_type} (job ${row.job_id})`,
          });
          const auth = btoa(`${twilioSid}:${twilioToken}`);
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body,
            },
          );
          ok = res.ok;
        } else {
          skipped++;
        }
      } else if (row.channel === "email") {
        if (resendKey && row.recipient) {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: resendFrom,
              to: [row.recipient],
              subject: `QEP Service — ${row.notification_type}`,
              text:
                `Service update for job ${row.job_id}: ${row.notification_type}`,
            }),
          });
          ok = res.ok;
        } else {
          skipped++;
        }
      }

      if (ok) {
        await supabase
          .from("service_customer_notifications")
          .update({
            metadata: {
              ...meta,
              delivered: true,
              delivered_at: new Date().toISOString(),
              provider: row.channel === "sms" ? "twilio" : "resend",
            },
          })
          .eq("id", row.id);
        if (row.channel === "sms") sms_sent++;
        if (row.channel === "email") email_sent++;
      }
    }

    const summary = {
      pending: pending?.length ?? 0,
      sms_sent,
      email_sent,
      skipped_no_credentials_or_recipient: skipped,
      twilio_configured: Boolean(twilioSid && twilioToken && twilioFrom),
      resend_configured: Boolean(resendKey),
    };
    await logServiceCronRun(supabase, {
      jobName: "service-customer-notify-dispatch",
      ok: true,
      metadata: summary,
    });
    return safeJsonOk({ ok: true, ...summary }, null);
  } catch (e) {
    console.error("service-customer-notify-dispatch:", e);
    try {
      const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (sk) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, sk);
        await logServiceCronRun(supabase, {
          jobName: "service-customer-notify-dispatch",
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } catch {
      /* ignore secondary logging failures */
    }
    return safeJsonError("Internal error", 500, null);
  }
});
