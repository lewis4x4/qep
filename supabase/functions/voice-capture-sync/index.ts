import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { decryptToken, encryptToken } from "../_shared/hubspot-crypto.ts";
import { resolveHubSpotRuntimeConfig } from "../_shared/hubspot-runtime-config.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { safeCorsHeaders } from "../_shared/safe-cors.ts";
import {
  buildVoiceCaptureNoteBody,
  getVoiceCaptureContactName,
  getVoiceCapturePrimaryActionItems,
  normalizeVoiceCaptureExtractedDealData,
  writeVoiceCaptureToLocalCrm,
  type VoiceCaptureExtractedDealData,
} from "../_shared/voice-capture-crm.ts";

type ExtractedDealData = VoiceCaptureExtractedDealData;

interface CaptureRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  transcript: string | null;
  extracted_data: unknown;
  hubspot_deal_id: string | null;
  hubspot_contact_id: string | null;
  hubspot_note_id: string | null;
  hubspot_task_id: string | null;
  linked_deal_id: string | null;
  linked_company_id: string | null;
  linked_contact_id: string | null;
}

function jsonError(message: string, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function resolveCaptureWorkspaceId(
  supabase: SupabaseClient,
  capture: Pick<CaptureRow, "hubspot_deal_id" | "linked_deal_id" | "linked_company_id" | "linked_contact_id">,
): Promise<string | null> {
  const dealId = isUuid(capture.linked_deal_id ?? "")
    ? capture.linked_deal_id
    : isUuid(capture.hubspot_deal_id ?? "")
      ? capture.hubspot_deal_id
      : null;

  if (dealId) {
    const { data: deal } = await supabase
      .from("crm_deals")
      .select("workspace_id")
      .eq("id", dealId)
      .is("deleted_at", null)
      .maybeSingle();
    const dealWorkspaceId = (deal as { workspace_id?: unknown } | null)?.workspace_id;
    if (typeof dealWorkspaceId === "string" && dealWorkspaceId.trim().length > 0) {
      return dealWorkspaceId;
    }
  }

  if (isUuid(capture.linked_company_id ?? "")) {
    const { data: company } = await supabase
      .from("crm_companies")
      .select("workspace_id")
      .eq("id", capture.linked_company_id)
      .is("deleted_at", null)
      .maybeSingle();
    const companyWorkspaceId = (company as { workspace_id?: unknown } | null)?.workspace_id;
    if (typeof companyWorkspaceId === "string" && companyWorkspaceId.trim().length > 0) {
      return companyWorkspaceId;
    }
  }

  if (isUuid(capture.linked_contact_id ?? "")) {
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("workspace_id")
      .eq("id", capture.linked_contact_id)
      .is("deleted_at", null)
      .maybeSingle();
    const contactWorkspaceId = (contact as { workspace_id?: unknown } | null)?.workspace_id;
    if (typeof contactWorkspaceId === "string" && contactWorkspaceId.trim().length > 0) {
      return contactWorkspaceId;
    }
  }

  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHubSpotObjectId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value);
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
  const headers = safeCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405, headers);
  }

  try {
    // Canonical ES256-safe JWT auth, rep/admin/manager/owner role gate.
    const origin = req.headers.get("origin");
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) {
      return jsonError("Unauthorized", 401, headers);
    }
    const user = { id: auth.userId };
    const workspaceId = auth.workspaceId;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => null) as { capture_id?: string } | null;
    const captureId = body?.capture_id?.trim();
    if (!captureId) {
      return jsonError("capture_id is required", 400, headers);
    }

    const { data: captureData, error: captureError } = await supabaseAdmin
      .from("voice_captures")
      .select("id, user_id, workspace_id, transcript, extracted_data, hubspot_deal_id, hubspot_contact_id, hubspot_note_id, hubspot_task_id, linked_deal_id, linked_company_id, linked_contact_id")
      .eq("id", captureId)
      .single();

    const capture = captureData as CaptureRow | null;

    if (captureError || !capture) {
      return jsonError("Voice capture not found", 404, headers);
    }

    const canSyncAnyCapture = ["admin", "manager", "owner"].includes(auth.role);
    const captureWorkspaceId = capture.workspace_id ?? await resolveCaptureWorkspaceId(supabaseAdmin, capture);

    if (!captureWorkspaceId) {
      return jsonError(
        "This legacy capture has no verified workspace. Re-record it or run the voice_captures workspace backfill before syncing.",
        409,
        headers,
      );
    }

    if (captureWorkspaceId !== workspaceId) {
      return jsonError("You can only sync captures in your active workspace.", 403, headers);
    }

    if (capture.user_id !== user.id && !canSyncAnyCapture) {
      return jsonError("You can only sync your own captures.", 403, headers);
    }

    if (!capture.transcript || capture.transcript.trim().length === 0) {
      return jsonError("Capture transcript is empty; cannot sync.", 422, headers);
    }

    const extracted = normalizeVoiceCaptureExtractedDealData(capture.extracted_data);
    const localCrmSync = await writeVoiceCaptureToLocalCrm(supabaseAdmin, {
      workspaceId: captureWorkspaceId,
      actorUserId: user.id,
      captureId,
      dealId: isUuid(capture.linked_deal_id ?? "")
        ? capture.linked_deal_id
        : isUuid(capture.hubspot_deal_id ?? "")
          ? capture.hubspot_deal_id
          : null,
      companyId: isUuid(capture.linked_company_id ?? "") ? capture.linked_company_id : null,
      contactId: isUuid(capture.linked_contact_id ?? "") ? capture.linked_contact_id : null,
      occurredAtIso: new Date().toISOString(),
      transcript: capture.transcript,
      extracted,
    });

    let resolvedDealId = capture.hubspot_deal_id;
    let resolvedContactId = capture.hubspot_contact_id;
    let noteId: string | null = capture.hubspot_note_id;
    let taskId: string | null = capture.hubspot_task_id;
    const externalSyncErrors: string[] = [];

    const hasHubSpotDealTarget = isHubSpotObjectId(resolvedDealId);
    if (localCrmSync.saved && !hasHubSpotDealTarget) {
      await supabaseAdmin
        .from("voice_captures")
        .update({
          sync_status: "synced",
          sync_error: null,
          qrm_activity_id: localCrmSync.noteActivityId,
          qrm_synced_at: new Date().toISOString(),
          hubspot_deal_id: localCrmSync.dealId,
          hubspot_contact_id: localCrmSync.contactId,
        })
        .eq("id", captureId);

      return new Response(
        JSON.stringify({
          id: captureId,
          hubspot_synced: false,
          hubspot_skipped_reason: "No HubSpot deal target; local QRM activity saved.",
          hubspot_deal_id: localCrmSync.dealId,
          qrm_activity_id: localCrmSync.noteActivityId,
          qrm_synced_at: new Date().toISOString(),
          local_crm_saved: true,
        }),
        {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        },
      );
    }

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
      if (localCrmSync.saved) {
        await supabaseAdmin
          .from("voice_captures")
          .update({
            sync_status: "synced",
            sync_error: null,
            qrm_activity_id: localCrmSync.noteActivityId,
            qrm_synced_at: new Date().toISOString(),
            hubspot_deal_id: localCrmSync.dealId,
            hubspot_contact_id: localCrmSync.contactId,
          })
          .eq("id", captureId);

        return new Response(
          JSON.stringify({
            id: captureId,
            hubspot_synced: false,
            hubspot_deal_id: localCrmSync.dealId,
            qrm_activity_id: localCrmSync.noteActivityId,
            qrm_synced_at: new Date().toISOString(),
            local_crm_saved: true,
          }),
          {
            status: 200,
            headers: { ...headers, "Content-Type": "application/json" },
          },
        );
      }

      return jsonError("HubSpot is not connected for this user.", 409, headers);
    }

    const token = await getValidToken(supabaseAdmin, connection.hub_id, connection);
    if (!token) {
      return jsonError("Failed to refresh HubSpot token.", 502, headers);
    }

    if (!resolvedDealId && getVoiceCaptureContactName(extracted)) {
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
              value: getVoiceCaptureContactName(extracted),
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

    if (!isHubSpotObjectId(resolvedDealId)) {
      if (localCrmSync.saved) {
        await supabaseAdmin
          .from("voice_captures")
          .update({
            sync_status: "synced",
            sync_error: "Skipped HubSpot sync because the resolved QRM deal is not a HubSpot object id.",
            qrm_activity_id: localCrmSync.noteActivityId,
            qrm_synced_at: new Date().toISOString(),
            hubspot_deal_id: localCrmSync.dealId,
            hubspot_contact_id: localCrmSync.contactId,
          })
          .eq("id", captureId);

        return new Response(
          JSON.stringify({
            id: captureId,
            hubspot_synced: false,
            hubspot_deal_id: localCrmSync.dealId,
            qrm_activity_id: localCrmSync.noteActivityId,
            qrm_synced_at: new Date().toISOString(),
            local_crm_saved: true,
          }),
          {
            status: 200,
            headers: { ...headers, "Content-Type": "application/json" },
          },
        );
      }

      return jsonError("Resolved QRM deal is not linked to a HubSpot object id.", 409, headers);
    }

    if (!noteId) {
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
          metadata: { body: buildVoiceCaptureNoteBody(capture.transcript, extracted) },
        }),
      });

      if (noteRes.ok) {
        const noteData = await noteRes.json();
        noteId = String(noteData.engagement?.id ?? "");
      } else {
        externalSyncErrors.push("HubSpot note creation failed.");
      }
    }

    const dueDate = extracted.opportunity.followUpDate
      ? new Date(extracted.opportunity.followUpDate).getTime()
      : Date.now() + 86400000;
    const taskTitle = extracted.opportunity.nextStep
      ? `Field note follow-up: ${extracted.opportunity.nextStep}`
      : `Follow up with ${getVoiceCaptureContactName(extracted) ?? "prospect"} - field visit`;

    if (!taskId) {
      const taskRes = await fetch("https://api.hubapi.com/crm/v3/objects/tasks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            hs_task_subject: taskTitle,
            hs_task_body: getVoiceCapturePrimaryActionItems(extracted).join("\n") || "Review field note and follow up.",
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
      } else {
        externalSyncErrors.push("HubSpot task creation failed.");
      }
    }

    const hubspotSynced = Boolean(noteId) && Boolean(taskId);

    await supabaseAdmin
      .from("voice_captures")
      .update({
        sync_status: localCrmSync.saved || hubspotSynced ? "synced" : "pending",
        sync_error: externalSyncErrors.length > 0 ? externalSyncErrors.join(" ") : null,
        qrm_activity_id: localCrmSync.noteActivityId,
        qrm_synced_at: localCrmSync.saved ? new Date().toISOString() : null,
        hubspot_deal_id: localCrmSync.dealId ?? resolvedDealId,
        hubspot_contact_id: localCrmSync.contactId ?? resolvedContactId,
        hubspot_note_id: noteId,
        hubspot_task_id: taskId,
        hubspot_synced_at: hubspotSynced ? new Date().toISOString() : null,
      })
      .eq("id", captureId);

    return new Response(
      JSON.stringify({
        id: captureId,
        hubspot_synced: hubspotSynced,
        hubspot_deal_id: localCrmSync.dealId ?? resolvedDealId,
        hubspot_note_id: noteId,
        hubspot_task_id: taskId,
        qrm_activity_id: localCrmSync.noteActivityId,
        qrm_synced_at: localCrmSync.saved ? new Date().toISOString() : null,
        local_crm_saved: localCrmSync.saved,
        local_crm_note_id: localCrmSync.noteActivityId,
        local_crm_task_id: localCrmSync.taskActivityId,
      }),
      {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    captureEdgeException(error, { fn: "voice-capture-sync", req });
    console.error("voice-capture-sync failed:", error);
    return jsonError("Internal server error", 500, headers);
  }
});
