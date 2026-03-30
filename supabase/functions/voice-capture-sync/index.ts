import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "../_shared/hubspot-crypto.ts";
import { resolveHubSpotRuntimeConfig } from "../_shared/hubspot-runtime-config.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

interface ExtractedDealData {
  customer_name: string | null;
  company_name: string | null;
  machine_interest: string | null;
  attachments_discussed: string | null;
  deal_stage: string | null;
  budget_range: string | null;
  key_concerns: string | null;
  action_items: string[];
  next_step: string | null;
  follow_up_date: string | null;
}

interface CaptureRow {
  id: string;
  user_id: string;
  transcript: string | null;
  extracted_data: unknown;
  hubspot_deal_id: string | null;
  hubspot_contact_id: string | null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jsonError(message: string, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function normalizeExtracted(raw: unknown): ExtractedDealData {
  const source = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  const list = Array.isArray(source.action_items)
    ? source.action_items.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return {
    customer_name: str(source.customer_name),
    company_name: str(source.company_name),
    machine_interest: str(source.machine_interest),
    attachments_discussed: str(source.attachments_discussed),
    deal_stage: str(source.deal_stage),
    budget_range: str(source.budget_range),
    key_concerns: str(source.key_concerns),
    action_items: list,
    next_step: str(source.next_step),
    follow_up_date: str(source.follow_up_date),
  };
}

function buildNoteBody(transcript: string, extracted: ExtractedDealData): string {
  const lines: string[] = ["--- Field Note (QEP Voice Capture) ---", ""];

  if (extracted.customer_name) lines.push(`Customer: ${extracted.customer_name}`);
  if (extracted.company_name) lines.push(`Company: ${extracted.company_name}`);
  if (extracted.machine_interest) lines.push(`Equipment interest: ${extracted.machine_interest}`);
  if (extracted.attachments_discussed) lines.push(`Attachments: ${extracted.attachments_discussed}`);
  if (extracted.deal_stage) lines.push(`Deal stage: ${extracted.deal_stage}`);
  if (extracted.budget_range) lines.push(`Budget: ${extracted.budget_range}`);
  if (extracted.key_concerns) lines.push(`Key concerns: ${extracted.key_concerns}`);

  if (extracted.action_items.length > 0) {
    lines.push("", "Action items:");
    extracted.action_items.forEach((item) => lines.push(`  - ${item}`));
  }

  if (extracted.next_step) lines.push("", `Next step: ${extracted.next_step}`);

  lines.push("", "--- Full Transcript ---", "", transcript);
  return lines.join("\n");
}

async function getValidToken(
  supabase: SupabaseClient,
  hubId: string,
  connection: { access_token: string; token_expires_at: string; refresh_token: string }
): Promise<string | null> {
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
    console.error("[voice-capture-sync] runtime OAuth config missing", { hubId });
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

  if (!res.ok) {
    console.error("Token refresh failed:", await res.text());
    return null;
  }

  const tokens = await res.json();
  const newRefresh = typeof tokens.refresh_token === "string" ? tokens.refresh_token : plainRefreshToken;
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

  return tokens.access_token as string;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405, headers);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonError("Unauthorized", 401, headers);
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !["rep", "admin", "manager", "owner"].includes(profile.role)) {
      return jsonError("Your role does not have access to voice capture sync.", 403, headers);
    }

    const body = await req.json().catch(() => null) as { capture_id?: string } | null;
    const captureId = body?.capture_id?.trim();
    if (!captureId) {
      return jsonError("capture_id is required", 400, headers);
    }

    const { data: captureData, error: captureError } = await supabaseAdmin
      .from("voice_captures")
      .select("id, user_id, transcript, extracted_data, hubspot_deal_id, hubspot_contact_id")
      .eq("id", captureId)
      .single();

    const capture = captureData as CaptureRow | null;

    if (captureError || !capture) {
      return jsonError("Voice capture not found", 404, headers);
    }

    if (capture.user_id !== user.id && !["admin", "manager", "owner"].includes(profile.role)) {
      return jsonError("You can only sync your own captures.", 403, headers);
    }

    if (!capture.transcript || capture.transcript.trim().length === 0) {
      return jsonError("Capture transcript is empty; cannot sync.", 422, headers);
    }

    const extracted = normalizeExtracted(capture.extracted_data);
    let resolvedDealId = capture.hubspot_deal_id;
    let resolvedContactId = capture.hubspot_contact_id;
    let noteId: string | null = null;
    let taskId: string | null = null;

    const { data: connectionData } = await supabaseAdmin
      .from("hubspot_connections")
      .select("hub_id, access_token, refresh_token, token_expires_at")
      .eq("user_id", capture.user_id)
      .eq("is_active", true)
      .limit(1)
      .single();

    const connection = connectionData as {
      hub_id: string;
      access_token: string;
      refresh_token: string;
      token_expires_at: string;
    } | null;

    if (!connection) {
      return jsonError("HubSpot is not connected for this user.", 409, headers);
    }

    const token = await getValidToken(supabaseAdmin, connection.hub_id, connection);
    if (!token) {
      return jsonError("Failed to refresh HubSpot token.", 502, headers);
    }

    if (!resolvedDealId && extracted.customer_name) {
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{
              propertyName: "fullname",
              operator: "CONTAINS_TOKEN",
              value: extracted.customer_name,
            }],
          }],
          properties: ["firstname", "lastname", "hs_object_id"],
          limit: 1,
        }),
      });

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const contact = searchData.results?.[0];
        if (contact?.id) {
          resolvedContactId = String(contact.id);
          const dealAssocRes = await fetch(
            `https://api.hubapi.com/crm/v4/objects/contacts/${resolvedContactId}/associations/deals`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (dealAssocRes.ok) {
            const dealAssoc = await dealAssocRes.json();
            resolvedDealId = dealAssoc.results?.[0]?.toObjectId?.toString() ?? null;
          }
        }
      }
    }

    if (!resolvedDealId) {
      await supabaseAdmin
        .from("voice_captures")
        .update({
          sync_status: "pending",
          sync_error: "No HubSpot deal id provided and no associated deal was resolved.",
        })
        .eq("id", captureId);
      return jsonError("Could not resolve a HubSpot deal for this capture.", 409, headers);
    }

    const noteRes = await fetch("https://api.hubapi.com/engagements/v1/engagements", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        engagement: {
          active: true,
          type: "NOTE",
          timestamp: Date.now(),
        },
        associations: {
          dealIds: [parseInt(resolvedDealId, 10)],
          contactIds: resolvedContactId ? [parseInt(resolvedContactId, 10)] : [],
          ownerIds: [],
        },
        metadata: { body: buildNoteBody(capture.transcript, extracted) },
      }),
    });

    if (noteRes.ok) {
      const noteData = await noteRes.json();
      noteId = String(noteData.engagement?.id ?? "");
    }

    const dueDate = extracted.follow_up_date
      ? new Date(extracted.follow_up_date).getTime()
      : Date.now() + 86400000;
    const taskTitle = extracted.next_step
      ? `Field note follow-up: ${extracted.next_step}`
      : `Follow up with ${extracted.customer_name ?? "prospect"} - field visit`;

    const taskRes = await fetch("https://api.hubapi.com/crm/v3/objects/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          hs_task_subject: taskTitle,
          hs_task_body: extracted.action_items.join("\n") || "Review field note and follow up.",
          hs_task_status: "NOT_STARTED",
          hs_task_priority: "HIGH",
          hs_timestamp: dueDate.toString(),
          hs_task_type: "CALL",
        },
        associations: [{
          to: { id: resolvedDealId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 216 }],
        }],
      }),
    });

    if (taskRes.ok) {
      const taskData = await taskRes.json();
      taskId = typeof taskData.id === "string" ? taskData.id : null;
    }

    await supabaseAdmin
      .from("voice_captures")
      .update({
        sync_status: "synced",
        sync_error: null,
        hubspot_deal_id: resolvedDealId,
        hubspot_contact_id: resolvedContactId,
        hubspot_note_id: noteId,
        hubspot_task_id: taskId,
        hubspot_synced_at: new Date().toISOString(),
      })
      .eq("id", captureId);

    return new Response(
      JSON.stringify({
        id: captureId,
        hubspot_synced: true,
        hubspot_deal_id: resolvedDealId,
        hubspot_note_id: noteId,
        hubspot_task_id: taskId,
      }),
      {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("voice-capture-sync failed:", error);
    return jsonError("Internal server error", 500, headers);
  }
});
