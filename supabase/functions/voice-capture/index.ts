/**
 * Voice-to-CRM Field Capture (Module 4)
 *
 * Accepts a multipart POST with an audio blob from a sales rep in the field.
 * Pipeline:
 *   1. Validate auth (rep/manager/owner roles only)
 *   2. Upload audio to Supabase Storage
 *   3. Transcribe via OpenAI Whisper
 *   4. Extract structured deal data via OpenAI
 *   5. Persist to voice_captures table
 *   6. If HubSpot is connected: create note engagement + schedule follow-up task
 *   7. Return capture record + extracted data
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encryptToken, decryptToken } from "../_shared/hubspot-crypto.ts";
import { resolveHubSpotRuntimeConfig } from "../_shared/hubspot-runtime-config.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

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

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonError("Unauthorized", 401, ch);
    }

    // Verify role — parts/service roles cannot use voice capture
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !["rep", "admin", "manager", "owner"].includes(profile.role)) {
      return jsonError("Your role does not have access to voice capture.", 403, ch);
    }

    // SEC-QEP-006: Per-user rate limiting — 5 requests per minute
    const allowed = await checkVoiceCaptureRateLimit(supabaseAdmin, user.id);
    if (allowed === false) {
      return jsonError("Rate limit exceeded. Please wait before submitting another recording.", 429, ch);
    }

    // ── Parse multipart form data ─────────────────────────────────────────────
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return jsonError("Expected multipart/form-data", 400, ch);
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    const crmDealId = (formData.get("crm_deal_id") as string | null) ?? null;
    const hubspotDealId =
      crmDealId ??
      ((formData.get("hubspot_deal_id") as string | null) ?? null);

    if (!audioFile || audioFile.size === 0) {
      return jsonError("audio field is required", 400, ch);
    }

    if (audioFile.size > 50 * 1024 * 1024) {
      return jsonError("Audio file exceeds 50MB limit", 400, ch);
    }

    // ── Upload audio to Supabase Storage ──────────────────────────────────────
    const extension = getAudioExtension(audioFile.type);
    const storagePath = `${user.id}/${Date.now()}.${extension}`;
    const audioBuffer = await audioFile.arrayBuffer();

    const { error: uploadError } = await supabaseAdmin.storage
      .from("voice-recordings")
      .upload(storagePath, audioBuffer, {
        contentType: audioFile.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError.message);
      return jsonError("Failed to store audio file", 500, ch);
    }

    // Create a placeholder capture record — update as pipeline progresses
    const { data: captureRecord, error: insertError } = await supabaseAdmin
      .from("voice_captures")
      .insert({
        user_id: user.id,
        audio_storage_path: storagePath,
        hubspot_deal_id: hubspotDealId,
        sync_status: "processing",
      })
      .select()
      .single();

    if (insertError || !captureRecord) {
      console.error("Failed to create capture record:", insertError?.message);
      return jsonError("Failed to create capture record", 500, ch);
    }

    const captureId = captureRecord.id as string;

    // ── Transcribe via Whisper ────────────────────────────────────────────────
    let transcript: string;
    let durationSeconds: number | null = null;

    try {
      const whisperForm = new FormData();
      whisperForm.append("file", new Blob([audioBuffer], { type: audioFile.type }), `audio.${extension}`);
      whisperForm.append("model", "whisper-1");
      whisperForm.append("language", "en");
      whisperForm.append("response_format", "verbose_json");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
        body: whisperForm,
      });

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        throw new Error(`Whisper API error: ${errText}`);
      }

      const whisperData = await whisperRes.json();
      transcript = whisperData.text?.trim() ?? "";
      durationSeconds = whisperData.duration ? Math.round(whisperData.duration) : null;
    } catch (transcribeErr) {
      const errMsg = transcribeErr instanceof Error ? transcribeErr.message : "Unknown error";
      console.error("Transcription failed:", errMsg);
      await supabaseAdmin
        .from("voice_captures")
        .update({ sync_status: "failed", sync_error: `Transcription failed: ${errMsg}` })
        .eq("id", captureId);
      return jsonError("Transcription failed. Please try again.", 500, ch);
    }

    if (!transcript) {
      await supabaseAdmin
        .from("voice_captures")
        .update({ sync_status: "failed", sync_error: "Empty transcript — no speech detected" })
        .eq("id", captureId);
      return jsonError("No speech detected in the recording. Please try again.", 422, ch);
    }

    // ── Extract structured data via OpenAI ───────────────────────────────────
    let extracted: ExtractedDealData;

    try {
      const extractionPrompt = `You are a CRM data extraction assistant for a heavy equipment dealership.
A sales rep just recorded a field note. Extract structured deal information from their transcript.

Transcript:
"""
${transcript}
"""

Extract the following fields. If a field is not mentioned, set it to null. For action_items, return an array of strings (can be empty).

Return ONLY valid JSON matching this exact structure:
{
  "customer_name": "first and last name of the customer, or null",
  "company_name": "customer's business name, or null",
  "machine_interest": "type/model of equipment discussed (e.g. 'CAT 320 excavator', 'John Deere 333G skid steer'), or null",
  "attachments_discussed": "any attachments or implements mentioned, or null",
  "deal_stage": "one of: initial_contact, follow_up, demo_scheduled, quote_sent, negotiation, closed_won, closed_lost — pick the most appropriate based on context, or null",
  "budget_range": "any budget or price range mentioned, or null",
  "key_concerns": "main objections or concerns the customer raised, or null",
  "action_items": ["list of specific next actions mentioned"],
  "next_step": "single most important next action, or null",
  "follow_up_date": "ISO date string (YYYY-MM-DD) if a specific date was mentioned, or null"
}`;

      const extractionRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Extract CRM-ready dealership field-note data. Return valid JSON only. Do not wrap the JSON in markdown fences.",
            },
            { role: "user", content: extractionPrompt },
          ],
        }),
      });

      if (!extractionRes.ok) {
        throw new Error(await extractionRes.text());
      }

      const extractionData = await extractionRes.json();
      const rawJson = extractionData.choices?.[0]?.message?.content?.trim();
      if (!rawJson) {
        throw new Error("OpenAI extraction returned no content");
      }
      // Strip markdown code fences if present
      const cleaned = rawJson.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      extracted = JSON.parse(cleaned) as ExtractedDealData;
    } catch (extractErr) {
      const errMsg = extractErr instanceof Error ? extractErr.message : "Unknown error";
      console.error("Extraction failed:", errMsg);
      // Save transcript even if extraction fails — don't lose the data
      await supabaseAdmin
        .from("voice_captures")
        .update({
          transcript,
          duration_seconds: durationSeconds,
          sync_status: "failed",
          sync_error: `Data extraction failed: ${errMsg}`,
        })
        .eq("id", captureId);
      return jsonError("Failed to extract deal data from transcript.", 500, ch);
    }

    // ── Persist transcript + extracted data ───────────────────────────────────
    await supabaseAdmin
      .from("voice_captures")
      .update({
        transcript,
        duration_seconds: durationSeconds,
        extracted_data: extracted,
        sync_status: "pending",
      })
      .eq("id", captureId);

    // ── HubSpot push (best-effort — non-fatal if not connected) ───────────────
    let hubspotSynced = false;
    let noteId: string | null = null;
    let taskId: string | null = null;
    let resolvedContactId: string | null = null;
    let resolvedDealId = hubspotDealId;

    try {
      // Find this user's active HubSpot connection
      const { data: connection } = await supabaseAdmin
        .from("hubspot_connections")
        .select("hub_id, access_token, refresh_token, token_expires_at")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .single();

      if (connection) {
        const token = await getValidToken(supabaseAdmin, connection.hub_id, connection);

        if (token) {
          // If no deal ID provided, search for the contact by extracted name
          if (!resolvedDealId && extracted.customer_name) {
            const searchRes = await fetch(
              `https://api.hubapi.com/crm/v3/objects/contacts/search`,
              {
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
              }
            );
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              const contact = searchData.results?.[0];
              if (contact) {
                resolvedContactId = contact.id;
                // Get their most recent open deal
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

          if (resolvedDealId) {
            // Create note engagement on the deal
            const noteBody = buildNoteBody(transcript, extracted);
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
                metadata: { body: noteBody },
              }),
            });

            if (noteRes.ok) {
              const noteData = await noteRes.json();
              noteId = String(noteData.engagement?.id ?? "");
            }

            // Schedule follow-up task (due tomorrow, or on the extracted follow-up date)
            const dueDate = extracted.follow_up_date
              ? new Date(extracted.follow_up_date).getTime()
              : Date.now() + 86400000; // 24 hours

            const taskTitle = extracted.next_step
              ? `Field note follow-up: ${extracted.next_step}`
              : `Follow up with ${extracted.customer_name ?? "prospect"} — field visit`;

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
              taskId = taskData.id ?? null;
            }

            // Update deal stage if we have one
            if (extracted.deal_stage) {
              await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${resolvedDealId}`, {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  properties: {
                    blackrock_last_field_note: new Date().toISOString().split("T")[0],
                    blackrock_field_note_summary: extracted.next_step ?? "",
                  },
                }),
              });
            }

            hubspotSynced = true;
          }
        }
      }
    } catch (hubspotErr) {
      // Non-fatal — log and continue
      console.error("HubSpot push error:", hubspotErr instanceof Error ? hubspotErr.message : hubspotErr);
    }

    // ── Finalize capture record ───────────────────────────────────────────────
    const finalUpdate: Record<string, unknown> = {
      sync_status: hubspotSynced ? "synced" : "pending",
    };

    if (hubspotSynced) {
      finalUpdate.hubspot_deal_id = resolvedDealId;
      finalUpdate.hubspot_contact_id = resolvedContactId;
      finalUpdate.hubspot_note_id = noteId;
      finalUpdate.hubspot_task_id = taskId;
      finalUpdate.hubspot_synced_at = new Date().toISOString();
    }

    await supabaseAdmin
      .from("voice_captures")
      .update(finalUpdate)
      .eq("id", captureId);

    // ── Return result ─────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        id: captureId,
        transcript,
        duration_seconds: durationSeconds,
        extracted_data: extracted,
        hubspot_synced: hubspotSynced,
        hubspot_deal_id: resolvedDealId,
        hubspot_note_id: noteId,
        hubspot_task_id: taskId,
      }),
      {
        status: 200,
        headers: { ...ch, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Voice capture function error:", err);
    return jsonError("Internal server error", 500, ch);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonError(message: string, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function checkVoiceCaptureRateLimit(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const rpcResult = await supabaseAdmin.rpc("check_rate_limit", {
    p_user_id: userId,
    p_endpoint: "voice-capture",
    p_max_requests: 5,
    p_window_seconds: 60,
  });

  if (!rpcResult.error) {
    return rpcResult.data !== false;
  }

  console.warn("check_rate_limit RPC unavailable, using table fallback", rpcResult.error);

  const windowStartIso = new Date(Date.now() - 60_000).toISOString();
  const countResult = await supabaseAdmin
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("endpoint", "voice-capture")
    .gte("created_at", windowStartIso);

  if (countResult.error) {
    console.error("Rate limit fallback count failed:", countResult.error);
    return true;
  }

  if ((countResult.count ?? 0) >= 5) {
    return false;
  }

  const insertResult = await supabaseAdmin
    .from("rate_limit_log")
    .insert({ user_id: userId, endpoint: "voice-capture" });

  if (insertResult.error) {
    console.error("Rate limit fallback insert failed:", insertResult.error);
  }

  return true;
}

function getAudioExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp4": "mp4",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
  };
  return map[mimeType] ?? "webm";
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
    extracted.action_items.forEach((item) => lines.push(`  • ${item}`));
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
    console.error("[voice-capture] runtime OAuth config missing", { hubId });
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
