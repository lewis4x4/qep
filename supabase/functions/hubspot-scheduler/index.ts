/**
 * HubSpot Follow-Up Scheduler
 * Triggered by pg_cron every 15 minutes
 * Processes due sequence steps and detects stalled deals
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptToken, decryptToken } from "../_shared/hubspot-crypto.ts";
import { resolveHubSpotRuntimeConfig } from "../_shared/hubspot-runtime-config.ts";

const STALLED_THRESHOLD_DAYS = 7;

type FollowUpStepType = "task" | "email" | "call_log" | "stalled_alert";

interface SchedulerDatabase {
  public: {
    Tables: {
      sequence_enrollments: {
        Row: {
          id: string;
          deal_id: string;
          deal_name: string | null;
          contact_id: string | null;
          contact_name: string | null;
          owner_id: string | null;
          hub_id: string;
          current_step: number;
          sequence_id: string;
          status: string;
          next_step_due_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          deal_id: string;
          deal_name?: string | null;
          contact_id?: string | null;
          contact_name?: string | null;
          owner_id?: string | null;
          hub_id: string;
          current_step?: number;
          sequence_id: string;
          status?: string;
          next_step_due_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          status?: string;
          completed_at?: string | null;
          current_step?: number;
          next_step_due_at?: string | null;
        };
        Relationships: [];
      };
      follow_up_steps: {
        Row: {
          id: string;
          sequence_id: string;
          step_number: number;
          day_offset: number;
          step_type: FollowUpStepType;
          subject: string | null;
          body_template: string | null;
          task_priority: string | null;
        };
        Insert: {
          id?: string;
          sequence_id: string;
          step_number: number;
          day_offset: number;
          step_type: FollowUpStepType;
          subject?: string | null;
          body_template?: string | null;
          task_priority?: string | null;
        };
        Update: {
          step_number?: number;
          day_offset?: number;
          step_type?: FollowUpStepType;
          subject?: string | null;
          body_template?: string | null;
          task_priority?: string | null;
        };
        Relationships: [];
      };
      hubspot_connections: {
        Row: {
          id: string;
          hub_id: string;
          user_id: string;
          access_token: string;
          refresh_token: string;
          token_expires_at: string;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          hub_id: string;
          user_id: string;
          access_token: string;
          refresh_token: string;
          token_expires_at: string;
          is_active?: boolean;
        };
        Update: {
          access_token?: string;
          refresh_token?: string;
          token_expires_at?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      workspace_hubspot_portal: {
        Row: {
          workspace_id: string;
          hub_id: string;
          is_active: boolean;
        };
        Insert: {
          workspace_id: string;
          hub_id: string;
          is_active?: boolean;
        };
        Update: {
          workspace_id?: string;
          hub_id?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      activity_log: {
        Row: {
          id: string;
          enrollment_id: string | null;
          deal_id: string | null;
          hub_id: string | null;
          activity_type: string;
          step_number: number | null;
          hubspot_engagement_id: string | null;
          payload: unknown;
          success: boolean | null;
        };
        Insert: {
          id?: string;
          enrollment_id?: string | null;
          deal_id?: string | null;
          hub_id?: string | null;
          activity_type: string;
          step_number?: number | null;
          hubspot_engagement_id?: string | null;
          payload?: unknown;
          success?: boolean | null;
        };
        Update: {
          enrollment_id?: string | null;
          deal_id?: string | null;
          hub_id?: string | null;
          activity_type?: string;
          step_number?: number | null;
          hubspot_engagement_id?: string | null;
          payload?: unknown;
          success?: boolean | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

interface DueEnrollment {
  id: string;
  deal_id: string;
  deal_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  owner_id: string | null;
  hub_id: string;
  current_step: number;
  sequence_id: string;
}

interface HubSpotDealSearchResult {
  id: string;
  properties: {
    dealname?: string;
    hubspot_owner_id?: string;
    hs_last_activity_date?: string;
  };
}

interface HubSpotDealSearchResponse {
  results?: HubSpotDealSearchResult[];
}

interface HubSpotObjectResponse {
  id?: string;
}

interface HubSpotTokenRefreshResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  const cronSecret = Deno.env.get("CRON_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabase = createClient<SchedulerDatabase>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results = { processed: 0, errors: 0, stalledAlerts: 0 };

    const { data: dueEnrollmentRows } = await supabase
      .from("sequence_enrollments")
      .select(`
        id, deal_id, deal_name, contact_id, contact_name, owner_id,
        hub_id, current_step, sequence_id
      `)
      .eq("status", "active")
      .lte("next_step_due_at", new Date().toISOString())
      .limit(50);
    const dueEnrollments: DueEnrollment[] = (dueEnrollmentRows ?? []) as DueEnrollment[];

    for (const enrollment of dueEnrollments) {
      try {
        await processEnrollmentStep(supabase, enrollment);
        results.processed++;
      } catch (err) {
        console.error(`Error processing enrollment ${enrollment.id}:`, err);
        results.errors++;
      }
    }

    let stalledCount = 0;
    try {
      stalledCount = await detectStalledDeals(supabase);
    } catch (stalledErr) {
      console.error("detectStalledDeals failed:", stalledErr);
    }
    results.stalledAlerts = stalledCount;

    console.log("Scheduler run complete:", results);
    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (fatalErr) {
    console.error("Scheduler fatal error:", fatalErr);
    const detail = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    return new Response(
      JSON.stringify({ error: "SCHEDULER_FATAL", detail }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

async function processEnrollmentStep(
  supabase: ReturnType<typeof createClient<SchedulerDatabase>>,
  enrollment: DueEnrollment
): Promise<void> {
  // Get the current step definition
  const { data: step } = await supabase
    .from("follow_up_steps")
    .select("*")
    .eq("sequence_id", enrollment.sequence_id)
    .eq("step_number", enrollment.current_step)
    .single();

  if (!step) {
    // No more steps — mark enrollment complete
    await supabase
      .from("sequence_enrollments")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", enrollment.id);
    await supabase.from("activity_log").insert({
      enrollment_id: enrollment.id,
      deal_id: enrollment.deal_id,
      hub_id: enrollment.hub_id,
      activity_type: "enrollment_completed",
    });
    return;
  }

  // Get a valid HubSpot token for this portal
  const { data: connection } = await supabase
    .from("hubspot_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("hub_id", enrollment.hub_id)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (!connection) {
    throw new Error(`No active connection for hub ${enrollment.hub_id}`);
  }

  const token = await getValidToken(supabase, enrollment.hub_id, connection);
  if (!token) throw new Error("Could not get valid token");

  // Interpolate template variables
  const vars = {
    contact_name: enrollment.contact_name ?? "there",
    deal_name: enrollment.deal_name ?? "your deal",
    rep_name: "Your QEP Rep",
  };

  function interpolate(template: string): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key as keyof typeof vars] ?? `{{${key}}}`);
  }

  const subject = step.subject ? interpolate(step.subject) : null;
  const body = step.body_template ? interpolate(step.body_template) : null;

  let engagementId: string | null = null;

  switch (step.step_type) {
    case "task":
      engagementId = await createHubSpotTask(
        token,
        enrollment,
        subject,
        body,
        step.task_priority ?? "MEDIUM",
      );
      break;

    case "email":
      engagementId = await sendHubSpotEmail(token, enrollment, subject, body);
      break;

    case "call_log":
      engagementId = await logHubSpotCall(token, enrollment, subject, body);
      break;

    case "stalled_alert":
      await createHubSpotTask(token, enrollment, subject, body, "HIGH");
      await supabase.from("hubspot_connections")
        .select("user_id")
        .eq("hub_id", enrollment.hub_id)
        .limit(1);
      // Update deal with stalled flag
      await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${enrollment.deal_id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { blackrock_stalled_flag: "true" } }),
      });
      break;
  }

  await supabase.from("activity_log").insert({
    enrollment_id: enrollment.id,
    deal_id: enrollment.deal_id,
    hub_id: enrollment.hub_id,
    activity_type: step.step_type === "task" ? "task_created"
      : step.step_type === "email" ? "email_sent"
      : step.step_type === "call_log" ? "call_logged"
      : "stalled_alert",
    step_number: enrollment.current_step,
    hubspot_engagement_id: engagementId,
    payload: { subject, step_type: step.step_type },
    success: true,
  });

  // Advance to next step
  const { data: nextStep } = await supabase
    .from("follow_up_steps")
    .select("day_offset")
    .eq("sequence_id", enrollment.sequence_id)
    .eq("step_number", enrollment.current_step + 1)
    .single();

  if (nextStep) {
    const nextDue = new Date(Date.now() + nextStep.day_offset * 86400000);
    await supabase
      .from("sequence_enrollments")
      .update({
        current_step: enrollment.current_step + 1,
        next_step_due_at: nextDue.toISOString(),
      })
      .eq("id", enrollment.id);

    // Push updated step to HubSpot
    await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${enrollment.deal_id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          blackrock_followup_step: String(enrollment.current_step + 1),
          blackrock_last_followup_date: new Date().toISOString().split("T")[0],
        },
      }),
    });
  } else {
    // No next step
    await supabase
      .from("sequence_enrollments")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", enrollment.id);
  }
}

async function detectStalledDeals(
  supabase: ReturnType<typeof createClient<SchedulerDatabase>>,
): Promise<number> {
  const { data: connections } = await supabase
    .from("hubspot_connections")
    .select("hub_id, access_token, refresh_token, token_expires_at")
    .eq("is_active", true);

  let alertCount = 0;
  for (const connection of connections ?? []) {
    const token = await getValidToken(supabase, connection.hub_id, connection);
    if (!token) continue;

    const thresholdDate = new Date(Date.now() - STALLED_THRESHOLD_DAYS * 86400000);
    const isoDate = thresholdDate.toISOString().split("T")[0];

    // Query HubSpot for open deals with no recent activity
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/search`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [{
            filters: [
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              { propertyName: "hs_last_activity_date", operator: "LT", value: isoDate },
              { propertyName: "blackrock_stalled_flag", operator: "NOT_HAS_PROPERTY" },
            ],
          }],
          properties: ["dealname", "hubspot_owner_id", "hs_last_activity_date"],
          limit: 20,
        }),
      }
    );

    if (!res.ok) continue;
    const data = await res.json() as HubSpotDealSearchResponse;

    for (const deal of data.results ?? []) {
      const dealId = deal.id;
      const dealName = deal.properties.dealname;

      // Create stalled alert task
      await fetch("https://api.hubapi.com/crm/v3/objects/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: {
            hs_task_subject: `[STALLED] ${dealName} — no activity for ${STALLED_THRESHOLD_DAYS}+ days`,
            hs_task_body: `This deal has had no recorded activity since ${isoDate}. Please follow up or update the deal status.`,
            hs_task_priority: "HIGH",
            hs_task_type: "TODO",
            hs_timestamp: new Date().toISOString(),
            hubspot_owner_id: deal.properties.hubspot_owner_id,
          },
          associations: [{ to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 216 }] }],
        }),
      });

      // Flag the deal
      await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { blackrock_stalled_flag: "true" } }),
      });

      await supabase.from("activity_log").insert({
        deal_id: dealId,
        hub_id: connection.hub_id,
        activity_type: "stalled_alert",
        payload: { deal_name: dealName, last_activity: deal.properties.hs_last_activity_date },
      });

      alertCount++;
    }
  }

  return alertCount;
}

async function createHubSpotTask(
  token: string,
  enrollment: DueEnrollment,
  subject: string | null,
  body: string | null,
  priority: string
): Promise<string | null> {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/tasks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: {
        hs_task_subject: subject ?? "Follow up",
        hs_task_body: body ?? "",
        hs_task_priority: priority,
        hs_task_type: "TODO",
        hs_timestamp: new Date().toISOString(),
        hubspot_owner_id: enrollment.owner_id,
      },
      associations: enrollment.deal_id ? [{
        to: { id: enrollment.deal_id },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 216 }],
      }] : [],
    }),
  });
  const data = await res.json() as HubSpotObjectResponse;
  return data.id ?? null;
}

async function sendHubSpotEmail(
  token: string,
  enrollment: DueEnrollment,
  subject: string | null,
  body: string | null
): Promise<string | null> {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: {
        hs_email_subject: subject ?? "Following up",
        hs_email_text: body ?? "",
        hs_email_direction: "EMAIL",
        hs_timestamp: new Date().toISOString(),
        hubspot_owner_id: enrollment.owner_id,
      },
      associations: [
        ...(enrollment.contact_id ? [{
          to: { id: enrollment.contact_id },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 198 }],
        }] : []),
        ...(enrollment.deal_id ? [{
          to: { id: enrollment.deal_id },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 210 }],
        }] : []),
      ],
    }),
  });
  const data = await res.json() as HubSpotObjectResponse;
  return data.id ?? null;
}

async function logHubSpotCall(
  token: string,
  enrollment: DueEnrollment,
  subject: string | null,
  body: string | null
): Promise<string | null> {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: {
        hs_call_title: subject ?? "Follow-up call",
        hs_call_body: body ?? "",
        hs_call_status: "NO_ANSWER",
        hs_call_duration: 0,
        hs_timestamp: new Date().toISOString(),
        hubspot_owner_id: enrollment.owner_id,
      },
      associations: [
        ...(enrollment.deal_id ? [{
          to: { id: enrollment.deal_id },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }],
        }] : []),
      ],
    }),
  });
  const data = await res.json() as HubSpotObjectResponse;
  return data.id ?? null;
}

async function getValidToken(
  supabase: ReturnType<typeof createClient<SchedulerDatabase>>,
  hubId: string,
  connection: { access_token: string; token_expires_at: string; refresh_token: string }
): Promise<string | null> {
  // Decrypt stored tokens — SEC-QEP-008
  const [plainAccessToken, plainRefreshToken] = await Promise.all([
    decryptToken(connection.access_token),
    decryptToken(connection.refresh_token),
  ]);

  const expiresAt = new Date(connection.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60000) return plainAccessToken;

  const { data: portalBinding } = await supabase
    .from("workspace_hubspot_portal")
    .select("workspace_id")
    .eq("hub_id", hubId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const runtimeConfig = await resolveHubSpotRuntimeConfig(
    supabase,
    portalBinding?.workspace_id ?? "default",
  );
  if (!runtimeConfig) {
    console.error("[hubspot-scheduler] runtime OAuth config missing", { hubId });
    return null;
  }

  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: runtimeConfig.clientId,
      client_secret: runtimeConfig.clientSecret,
      refresh_token: plainRefreshToken,
    }),
  });

  if (!res.ok) return null;
  const tokens = await res.json() as HubSpotTokenRefreshResponse;

  const newRefresh = tokens.refresh_token ?? plainRefreshToken;
  const [encAccess, encRefresh] = await Promise.all([
    encryptToken(tokens.access_token),
    encryptToken(newRefresh),
  ]);

  await supabase
    .from("hubspot_connections")
    .update({
      access_token: encAccess,
      refresh_token: encRefresh,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
    .eq("hub_id", hubId);

  return tokens.access_token;
}
