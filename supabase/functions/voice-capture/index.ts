/**
 * Voice-to-QRM Field Capture (Module 4)
 *
 * Accepts a multipart POST with an audio blob from a sales rep in the field.
 * Pipeline:
 *   1. Validate auth (rep/manager/owner roles only)
 *   2. Upload audio to Supabase Storage
 *   3. Transcribe via OpenAI Audio API
 *   4. Extract structured deal data via OpenAI
 *   5. Persist to voice_captures table
 *   6. If HubSpot is connected: create note engagement + schedule follow-up task
 *   7. Return capture record + extracted data
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { encryptToken, decryptToken } from "../_shared/hubspot-crypto.ts";
import { resolveHubSpotRuntimeConfig } from "../_shared/hubspot-runtime-config.ts";
import {
  buildVoiceCaptureNoteBody,
  getVoiceCaptureContactName,
  getVoiceCapturePrimaryActionItems,
  normalizeVoiceCaptureExtractedDealData,
  writeVoiceCaptureToLocalCrm,
  type VoiceCaptureExtractedDealData,
} from "../_shared/voice-capture-crm.ts";
import { processVoiceNoteIntelligence } from "../_shared/voice-note-intelligence.ts";
import { safeCorsHeaders } from "../_shared/safe-cors.ts";
import {
  isGenericAudioMimeType,
  isSupportedAudioMimeType,
  resolveAudioUploadMetadata,
} from "../_shared/audio-mime.ts";
import {
  resolveVoiceCaptureModelConfig,
  WHISPER_TRANSCRIPTION_MODEL,
} from "../_shared/voice-model-config.ts";
import { generateVoiceCaptureSummaryBullets } from "../_shared/voice-capture-summary.ts";
import { ensureVoiceCaptureSpeakerSuggestions } from "../_shared/voice-speaker-labels.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import {
  analyzeTranscriptSignal,
  isLowSignalTranscript,
} from "../_shared/voice-transcript-signal.ts";
type ExtractedDealData = VoiceCaptureExtractedDealData;

interface ClientCaptureDiagnostics {
  blobSize: number | null;
  chunkCount: number | null;
  mimeType: string | null;
  elapsedSeconds: number | null;
  peakAmplitude: number | null;
  signalRatio: number | null;
}

Deno.serve(async (req) => {
  const ch = safeCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  try {
    // ── Canonical ES256-safe JWT auth, rep/admin/manager/owner role gate. ──
    const origin = req.headers.get("origin");
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) {
      return jsonError("Unauthorized", 401, ch);
    }
    const user = { id: auth.userId };
    const workspaceId = auth.workspaceId;
    const modelConfig = resolveVoiceCaptureModelConfig();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (formErr) {
      console.error("voice-capture: formData parse failed", formErr);
      return jsonError(
        "Could not read the uploaded recording. Try a shorter clip (under ~2 minutes), check your connection, and submit again.",
        400,
        ch,
      );
    }

    const audioFile = formData.get("audio") as File | null;
    const submittedDurationSeconds = parseDurationSeconds(formData.get("duration_seconds"));
    const clientCaptureDiagnostics = readClientCaptureDiagnostics(formData);
    const rawCrmDealId = (formData.get("crm_deal_id") as string | null)?.trim() || null;
    const rawLegacyHubspot = (formData.get("hubspot_deal_id") as string | null)?.trim() || null;
    const requestedCrmDealId = rawCrmDealId ?? (rawLegacyHubspot && isUuid(rawLegacyHubspot) ? rawLegacyHubspot : null);
    let hubspotDealId = rawLegacyHubspot && !isUuid(rawLegacyHubspot) ? rawLegacyHubspot : null;

    if (!audioFile || audioFile.size === 0) {
      return jsonError("audio field is required", 400, ch);
    }

    if (audioFile.size > 50 * 1024 * 1024) {
      return jsonError("Audio file exceeds 50MB limit", 400, ch);
    }

    if (requestedCrmDealId) {
      const { data: authorizedDeal, error: dealLookupError } = await supabaseAdmin
        .from("crm_deals")
        .select("id")
        .eq("id", requestedCrmDealId)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .maybeSingle();

      if (dealLookupError) {
        console.error("voice-capture: deal authorization lookup failed", dealLookupError);
        return jsonError("Could not verify the selected QRM deal.", 500, ch);
      }

      if (!authorizedDeal) {
        return jsonError("Selected QRM deal was not found in your workspace.", 404, ch);
      }

      hubspotDealId = authorizedDeal.id;
    }

    // ── Upload audio to Supabase Storage ──────────────────────────────────────
    let audioBuffer: ArrayBuffer;
    try {
      audioBuffer = await audioFile.arrayBuffer();
    } catch (bufErr) {
      console.error("voice-capture: arrayBuffer failed", bufErr);
      return jsonError(
        "Could not read the audio data. The recording may be too large for the browser or server memory limits. Try a shorter note.",
        400,
        ch,
      );
    }

    const audioMetadata = resolveAudioUploadMetadata(audioFile.type, audioFile.name, audioBuffer);
    const audioMimeType = audioMetadata.mimeType;
    const extension = audioMetadata.extension;

    if (!isSupportedAudioMimeType(audioMimeType)) {
      return jsonError(
        "The uploaded recording is not a supported audio format. Please re-record and try again.",
        415,
        ch,
      );
    }

    if (!audioMetadata.detectedMimeType && isGenericAudioMimeType(audioMetadata.declaredMimeType)) {
      return jsonError(
        "The uploaded recording does not look like a supported audio file. Please re-record and try again.",
        415,
        ch,
      );
    }

    if (
      audioMetadata.detectedMimeType &&
      audioMetadata.declaredMimeType &&
      audioMetadata.detectedMimeType !== audioMetadata.declaredMimeType
    ) {
      console.warn("voice-capture: corrected uploaded audio MIME from bytes", {
        declared: audioMetadata.declaredMimeType,
        detected: audioMetadata.detectedMimeType,
        fileName: audioFile.name,
      });
    }

    const storagePath = `${user.id}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("voice-recordings")
      .upload(storagePath, audioBuffer, {
        contentType: audioMimeType,
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
        workspace_id: workspaceId,
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

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) {
      await supabaseAdmin
        .from("voice_captures")
        .update({
          sync_status: "failed",
          sync_error: "Transcription failed: OPENAI_API_KEY is not configured for the voice-capture function",
        })
        .eq("id", captureId);
      return jsonError(
        "Voice capture is not configured. Missing OPENAI_API_KEY in Supabase edge function secrets.",
        503,
        ch,
      );
    }

    // ── Transcribe via OpenAI Audio API ───────────────────────────────────────
    let transcript: string;
    let durationSeconds: number | null = submittedDurationSeconds;

    try {
      const transcriptionModel = modelConfig.transcriptionModel;
      const transcriptionForm = new FormData();
      transcriptionForm.append("file", new Blob([audioBuffer], { type: audioMimeType }), `audio.${extension}`);
      transcriptionForm.append("model", transcriptionModel);
      if (transcriptionModel === WHISPER_TRANSCRIPTION_MODEL) {
        transcriptionForm.append("language", "en");
        transcriptionForm.append("response_format", "verbose_json");
      } else {
        transcriptionForm.append("response_format", "json");
      }

      const transcriptionRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiKey}` },
        body: transcriptionForm,
        signal: AbortSignal.timeout(120_000),
      });

      if (!transcriptionRes.ok) {
        const errText = await transcriptionRes.text();
        throw new Error(`Transcription API error: ${errText}`);
      }

      const transcriptionData = await transcriptionRes.json();
      transcript = transcriptionData.text?.trim() ?? "";
      durationSeconds = transcriptionData.duration ? Math.round(transcriptionData.duration) : submittedDurationSeconds;
    } catch (transcribeErr) {
      const errMsg = transcribeErr instanceof Error ? transcribeErr.message : "Unknown error";
      console.error("Transcription failed:", errMsg);
      await supabaseAdmin
        .from("voice_captures")
        .update({ sync_status: "failed", sync_error: `Transcription failed: ${errMsg}` })
        .eq("id", captureId);
      return jsonError(humanizeVoiceCaptureError(errMsg, "transcription"), 500, ch);
    }

    if (!transcript) {
      const syncError = buildLowSignalSyncError({
        reason: "empty transcript",
        transcript,
        durationSeconds,
        submittedDurationSeconds,
        audioFileSize: audioFile.size,
        audioMimeType,
        clientCaptureDiagnostics,
      });
      await supabaseAdmin
        .from("voice_captures")
        .update({
          duration_seconds: durationSeconds,
          sync_status: "failed",
          sync_error: syncError,
        })
        .eq("id", captureId);
      return jsonError("No speech detected in the recording. Please try again.", 422, ch, {
        capture_id: captureId,
        duration_seconds: durationSeconds,
        replay_available: true,
      });
    }

    if (isLowSignalTranscript(transcript, durationSeconds)) {
      const syncError = buildLowSignalSyncError({
        reason: "low-signal transcript",
        transcript,
        durationSeconds,
        submittedDurationSeconds,
        audioFileSize: audioFile.size,
        audioMimeType,
        clientCaptureDiagnostics,
      });
      await supabaseAdmin
        .from("voice_captures")
        .update({
          transcript,
          duration_seconds: durationSeconds,
          sync_status: "failed",
          sync_error: syncError,
        })
        .eq("id", captureId);
      return jsonError(
        "The recording only produced a one-word or very short transcript, so it was not saved as a trusted field note. Check the microphone input and re-record.",
        422,
        ch,
        {
          capture_id: captureId,
          duration_seconds: durationSeconds,
          replay_available: true,
        },
      );
    }

    // ── Extract structured data via OpenAI ───────────────────────────────────
    let extracted: ExtractedDealData;

    try {
      const extractionPrompt = `You are a QRM data extraction assistant for a heavy equipment dealership.
A sales rep just recorded a field note. Extract structured dealership QRM information from their transcript.

Transcript:
"""
${transcript}
"""

Rules:
- Return ONLY valid JSON.
- If something is not clearly stated or safely inferable, use null, unknown, false, or [].
- Do not fabricate dates, prices, machine models, or stakeholder roles.
- Keep evidence snippets short and quoted from the transcript.
- Confidence must be one of: high, medium, low, unknown.

Return ONLY valid JSON matching this exact structure:
{
  "record": {
    "contactName": "string or null",
    "contactRole": "string or null",
    "companyName": "string or null",
    "companyType": "string or null",
    "decisionMakerStatus": "decision_maker | influencer | operator | gatekeeper | unknown",
    "preferredContactChannel": "call | text | email | in_person | unknown",
    "locationContext": "string or null",
    "additionalStakeholders": ["strings"]
  },
  "opportunity": {
    "machineInterest": "string or null",
    "equipmentCategory": "string or null",
    "equipmentMake": "string or null",
    "equipmentModel": "string or null",
    "attachmentsDiscussed": ["strings"],
    "applicationUseCase": "string or null",
    "dealStage": "initial_contact | follow_up | demo_scheduled | quote_sent | negotiation | closed_won | closed_lost | null",
    "intentLevel": "curious | evaluating | quote_ready | demo_ready | ready_to_buy | unknown",
    "urgencyLevel": "low | medium | high | urgent | unknown",
    "timelineToBuy": "string or null",
    "financingInterest": "cash | finance | lease | rental | rent_to_own | unknown",
    "newVsUsedPreference": "new | used | either | unknown",
    "tradeInLikelihood": "none | possible | likely | confirmed | unknown",
    "budgetRange": "string or null",
    "budgetConfidence": "firm | soft | vague | unknown",
    "competitorsMentioned": ["strings"],
    "keyConcerns": "string or null",
    "objections": ["strings"],
    "quoteReadiness": "not_ready | partial | ready",
    "nextStep": "string or null",
    "nextStepDeadline": "YYYY-MM-DD or null",
    "actionItems": ["strings"],
    "followUpDate": "YYYY-MM-DD or null"
  },
  "operations": {
    "branchRelevance": "string or null",
    "territorySignal": "string or null",
    "serviceOpportunity": false,
    "partsOpportunity": false,
    "rentalOpportunity": false,
    "crossSellOpportunity": ["strings"],
    "existingFleetContext": "string or null",
    "replacementTrigger": "string or null",
    "availabilitySensitivity": "must_have_now | soon | flexible | unknown",
    "uptimeSensitivity": "low | medium | high | unknown",
    "jobsiteConditions": ["strings"],
    "operatorSkillLevel": "new | experienced | mixed | unknown"
  },
  "guidance": {
    "customerSentiment": "positive | neutral | cautious | skeptical | frustrated | unknown",
    "probabilitySignal": "low | medium | high | unknown",
    "stalledRisk": "low | medium | high | unknown",
    "buyerPersona": "price_first | uptime_first | growth_owner | spec_driven | rental_first | unknown",
    "managerAttentionFlag": false,
    "recommendedNextAction": "string or null",
    "recommendedFollowUpMode": "call | text | email | visit | quote | demo | unknown",
    "summaryForRep": "string or null",
    "summaryForManager": "string or null"
  },
  "evidence": {
    "snippets": [
      {
        "field": "field name",
        "quote": "short supporting quote",
        "confidence": "high | medium | low | unknown"
      }
    ],
    "confidence": {
      "fieldName": "high | medium | low | unknown"
    }
  }
}`;

      const extractionRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelConfig.extractionModel,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Extract QRM-ready dealership field-note data. Return valid JSON only. Do not wrap the JSON in markdown fences.",
            },
            { role: "user", content: extractionPrompt },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
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
      extracted = normalizeVoiceCaptureExtractedDealData(JSON.parse(cleaned));
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
      return jsonError(humanizeVoiceCaptureError(errMsg, "extraction"), 500, ch);
    }

    // ── Persist transcript + extracted data ───────────────────────────────────
    let localCrmSync: Awaited<ReturnType<typeof writeVoiceCaptureToLocalCrm>>;
    try {
      localCrmSync = await writeVoiceCaptureToLocalCrm(supabaseAdmin, {
        workspaceId,
        actorUserId: user.id,
        captureId,
        dealId: requestedCrmDealId,
        occurredAtIso: captureRecord.created_at as string,
        transcript,
        extracted,
      });
    } catch (localCrmErr) {
      const errMsg =
        localCrmErr instanceof Error ? localCrmErr.message : "Unknown error saving to QRM";
      console.error("Local QRM sync failed:", errMsg, localCrmErr);
      await supabaseAdmin
        .from("voice_captures")
        .update({
          transcript,
          duration_seconds: durationSeconds,
          extracted_data: extracted,
          sync_status: "failed",
          sync_error: `Local QRM save failed: ${errMsg}`,
        })
        .eq("id", captureId);
      void persistVoiceCaptureSummaryBulletsBestEffort(supabaseAdmin, {
        captureId,
        transcript,
        extracted,
        openAiKey,
        model: modelConfig.extractionModel,
      });
      await ensureVoiceCaptureSpeakerSuggestions(supabaseAdmin, {
        workspaceId,
        captureId,
        actorUserId: user.id,
        captureMode: "field_note",
        linkedDealId: requestedCrmDealId,
        extractedContactName: getVoiceCaptureContactName(extracted),
        extractedCompanyName: extracted.record.companyName,
      });
      return jsonError(
        "Could not attach this note to the QRM deal. If this keeps happening, contact support.",
        500,
        ch,
      );
    }

    {
      const { error: persistErr } = await supabaseAdmin
        .from("voice_captures")
        .update({
          transcript,
          duration_seconds: durationSeconds,
          extracted_data: extracted,
          sync_status: localCrmSync.saved ? "synced" : "pending",
          sync_error: null,
          qrm_activity_id: localCrmSync.noteActivityId,
          qrm_synced_at: localCrmSync.saved ? new Date().toISOString() : null,
          hubspot_deal_id: localCrmSync.dealId ?? hubspotDealId,
          hubspot_contact_id: localCrmSync.contactId,
          hubspot_synced_at: null,
        })
        .eq("id", captureId);
      if (persistErr) {
        console.error("voice-capture: failed to persist transcript/extracted_data", persistErr.message);
        return jsonError(
          "Transcription succeeded but saving the capture failed. Please try again or contact support.",
          500,
          ch,
        );
      }
    }

    await ensureVoiceCaptureSpeakerSuggestions(supabaseAdmin, {
      workspaceId,
      captureId,
      actorUserId: user.id,
      captureMode: "field_note",
      linkedCompanyId: localCrmSync.companyId,
      linkedContactId: localCrmSync.contactId,
      linkedDealId: localCrmSync.dealId ?? requestedCrmDealId,
      extractedContactName: getVoiceCaptureContactName(extracted),
      extractedCompanyName: extracted.record.companyName,
    });

    // ── Voice note intelligence (best-effort — non-fatal) ──────────────────────
    try {
      await processVoiceNoteIntelligence(supabaseAdmin, {
        captureId,
        userId: user.id,
        transcript,
        extracted,
        existingDealId: requestedCrmDealId,
        workspaceId,
      });
    } catch (intelErr) {
      console.error("voice-capture: intelligence processing failed (non-fatal)", intelErr);
    }

    // ── HubSpot push (best-effort — non-fatal if not connected) ───────────────
    let hubspotSynced = false;
    let noteId: string | null = null;
    let taskId: string | null = null;
    let resolvedContactId: string | null = null;
    let resolvedDealId = hubspotDealId;
    const externalSyncErrors: string[] = [];

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
          if (!resolvedDealId && getVoiceCaptureContactName(extracted)) {
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
                      value: getVoiceCaptureContactName(extracted),
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

          if (isHubSpotObjectId(resolvedDealId)) {
            // Create note engagement on the deal
            const noteBody = buildVoiceCaptureNoteBody(transcript, extracted);
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
            } else {
              externalSyncErrors.push("HubSpot note creation failed.");
            }

            // Schedule follow-up task (due tomorrow, or on the extracted follow-up date)
            const dueDate = extracted.opportunity.followUpDate
              ? new Date(extracted.opportunity.followUpDate).getTime()
              : Date.now() + 86400000; // 24 hours

            const taskTitle = extracted.opportunity.nextStep
              ? `Field note follow-up: ${extracted.opportunity.nextStep}`
              : `Follow up with ${getVoiceCaptureContactName(extracted) ?? "prospect"} — field visit`;

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
              taskId = taskData.id ?? null;
            } else {
              externalSyncErrors.push("HubSpot task creation failed.");
            }

            // Update deal stage if we have one
            if (extracted.opportunity.dealStage) {
              await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${resolvedDealId}`, {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  properties: {
                    blackrock_last_field_note: new Date().toISOString().split("T")[0],
                    blackrock_field_note_summary: extracted.opportunity.nextStep ?? "",
                  },
                }),
              });
            }

            hubspotSynced = Boolean(noteId) && Boolean(taskId);
          } else if (resolvedDealId) {
            externalSyncErrors.push("Skipped HubSpot sync because the resolved QRM deal is not a HubSpot object id.");
          }
        }
      }
    } catch (hubspotErr) {
      // Non-fatal — log and continue
      console.error("HubSpot push error:", hubspotErr instanceof Error ? hubspotErr.message : hubspotErr);
    }

    // ── Finalize capture record ───────────────────────────────────────────────
    const finalUpdate: Record<string, unknown> = {
      sync_status: localCrmSync.saved || hubspotSynced ? "synced" : "pending",
      sync_error: externalSyncErrors.length > 0 ? externalSyncErrors.join(" ") : null,
      qrm_activity_id: localCrmSync.noteActivityId,
      qrm_synced_at: localCrmSync.saved ? new Date().toISOString() : null,
      hubspot_deal_id: localCrmSync.dealId ?? resolvedDealId,
      hubspot_contact_id: localCrmSync.contactId ?? resolvedContactId,
      hubspot_note_id: noteId,
      hubspot_task_id: taskId,
      hubspot_synced_at: hubspotSynced
        ? new Date().toISOString()
        : null,
    };

    {
      const { error: finalizeErr } = await supabaseAdmin
        .from("voice_captures")
        .update(finalUpdate)
        .eq("id", captureId);
      if (finalizeErr) {
        console.error("voice-capture: final capture update failed", finalizeErr.message);
        // Non-fatal for the client — core data was saved in the prior update
      }
    }

    const summaryBullets = await persistVoiceCaptureSummaryBulletsBestEffort(supabaseAdmin, {
      captureId,
      transcript,
      extracted,
      openAiKey,
      model: modelConfig.extractionModel,
    });

    // ── Return result ─────────────────────────────────────────────────────────
    const payload = {
      id: captureId,
      transcript,
      duration_seconds: durationSeconds,
      extracted_data: extracted,
      hubspot_synced: hubspotSynced,
      hubspot_deal_id: localCrmSync.dealId ?? resolvedDealId,
      hubspot_note_id: noteId,
      hubspot_task_id: taskId,
      summary_bullets: summaryBullets,
      qrm_activity_id: localCrmSync.noteActivityId,
      qrm_synced_at: localCrmSync.saved ? new Date().toISOString() : null,
      local_crm_saved: localCrmSync.saved,
      local_crm_note_id: localCrmSync.noteActivityId,
      local_crm_task_id: localCrmSync.taskActivityId,
    };
    let body: string;
    try {
      body = JSON.stringify(payload);
    } catch (serializeErr) {
      console.error("voice-capture: JSON.stringify failed", serializeErr);
      const safeTranscript =
        transcript.length > 50_000 ? `${transcript.slice(0, 50_000)}…` : transcript;
      body = JSON.stringify({
        id: captureId,
        transcript: safeTranscript,
        duration_seconds: durationSeconds,
        extracted_data: {},
        hubspot_synced: hubspotSynced,
        hubspot_deal_id: localCrmSync.dealId ?? resolvedDealId,
        hubspot_note_id: noteId,
        hubspot_task_id: taskId,
        summary_bullets: summaryBullets,
        qrm_activity_id: localCrmSync.noteActivityId,
        qrm_synced_at: localCrmSync.saved ? new Date().toISOString() : null,
        local_crm_saved: localCrmSync.saved,
        local_crm_note_id: localCrmSync.noteActivityId,
        local_crm_task_id: localCrmSync.taskActivityId,
        _warning:
          "Response was trimmed due to serialization limits; your capture may still be stored server-side.",
      });
    }

    return new Response(body, {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  } catch (err) {
    captureEdgeException(err, { fn: "voice-capture", req });
    const raw = err instanceof Error ? err.message : String(err);
    console.error("Voice capture function error:", raw, err);
    const lower = raw.toLowerCase();
    let message = "Internal server error";
    if (
      lower.includes("memory") ||
      lower.includes("allocation") ||
      lower.includes("out of memory") ||
      lower.includes("oom")
    ) {
      message =
        "The server ran out of memory processing this recording. Try a much shorter field note (under 2 minutes) or re-record at a lower quality.";
    } else if (
      lower.includes("formdata") ||
      lower.includes("multipart") ||
      lower.includes("boundary") ||
      lower.includes("unexpected end")
    ) {
      message =
        "The upload was incomplete or corrupted. Check your connection and try again with a shorter recording if it keeps happening.";
    } else if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline")) {
      message = "Processing timed out. Try a shorter recording and submit again.";
    }
    return jsonError(message, 500, ch);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isHubSpotObjectId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value);
}

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function jsonError(
  message: string,
  status: number,
  headers: Record<string, string>,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function isMissingSummaryBulletsColumnError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return message.includes("summary_bullets") && (
    code === "PGRST204" ||
    code === "42703" ||
    /schema cache|column|does not exist/i.test(message)
  );
}

async function persistVoiceCaptureSummaryBulletsBestEffort(
  supabaseAdmin: SupabaseClient,
  input: {
    captureId: string;
    transcript: string;
    extracted: ExtractedDealData;
    openAiKey: string | null | undefined;
    model: string;
  },
): Promise<string[] | null> {
  const summaryResult = await generateVoiceCaptureSummaryBullets({
    transcript: input.transcript,
    extracted: input.extracted,
    openAiKey: input.openAiKey,
    model: input.model,
    timeoutMs: 20_000,
  });

  if (summaryResult.error) {
    console.warn("voice-capture: summary generation skipped", summaryResult.error);
    return null;
  }

  if (!summaryResult.bullets) return null;

  const { error } = await supabaseAdmin
    .from("voice_captures")
    .update({ summary_bullets: summaryResult.bullets })
    .eq("id", input.captureId);

  if (error) {
    if (isMissingSummaryBulletsColumnError(error)) {
      console.warn("voice-capture: summary_bullets column unavailable; skipped summary persistence");
    } else {
      console.error("voice-capture: failed to persist summary bullets", error.message);
    }
    return null;
  }

  return summaryResult.bullets;
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

function parseDurationSeconds(value: FormDataEntryValue | null): number | null {
  return parsePositiveNumber(value, { round: true });
}

function parsePositiveNumber(
  value: FormDataEntryValue | null,
  opts: { round?: boolean; allowZero?: boolean } = {},
): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (opts.allowZero ? parsed < 0 : parsed <= 0)) return null;
  return opts.round ? Math.round(parsed) : parsed;
}

function readClientCaptureDiagnostics(formData: FormData): ClientCaptureDiagnostics {
  return {
    blobSize: parsePositiveNumber(formData.get("client_blob_size"), { round: true }),
    chunkCount: parsePositiveNumber(formData.get("client_chunk_count"), { round: true }),
    mimeType: typeof formData.get("client_mime_type") === "string"
      ? String(formData.get("client_mime_type")).slice(0, 120)
      : null,
    elapsedSeconds: parsePositiveNumber(formData.get("client_elapsed_seconds"), { round: true }),
    peakAmplitude: parsePositiveNumber(formData.get("client_peak_amplitude"), { allowZero: true }),
    signalRatio: parsePositiveNumber(formData.get("client_signal_ratio"), { allowZero: true }),
  };
}

function formatNullableNumber(value: number | null, digits = 2): string {
  return value === null ? "unknown" : value.toFixed(digits);
}

function buildLowSignalSyncError(input: {
  reason: string;
  transcript: string;
  durationSeconds: number | null;
  submittedDurationSeconds: number | null;
  audioFileSize: number;
  audioMimeType: string;
  clientCaptureDiagnostics: ClientCaptureDiagnostics;
}): string {
  const signal = analyzeTranscriptSignal(input.transcript);
  const client = input.clientCaptureDiagnostics;
  const serverDuration = input.durationSeconds ?? input.submittedDurationSeconds;
  return [
    "Low-confidence transcript — recording produced too little usable speech text, but audio was retained for replay/debug.",
    `reason=${input.reason}`,
    `words=${signal.wordCount}`,
    `generic_noise=${signal.isGenericNoise}`,
    `duration_seconds=${serverDuration ?? "unknown"}`,
    `submitted_duration_seconds=${input.submittedDurationSeconds ?? "unknown"}`,
    `audio_bytes=${input.audioFileSize}`,
    `audio_mime=${input.audioMimeType}`,
    `client_blob_bytes=${client.blobSize ?? "unknown"}`,
    `client_chunks=${client.chunkCount ?? "unknown"}`,
    `client_mime=${client.mimeType ?? "unknown"}`,
    `client_elapsed_seconds=${client.elapsedSeconds ?? "unknown"}`,
    `client_peak_amplitude=${formatNullableNumber(client.peakAmplitude, 4)}`,
    `client_signal_ratio=${formatNullableNumber(client.signalRatio, 4)}`,
  ].join(" | ");
}

function humanizeVoiceCaptureError(
  rawMessage: string,
  stage: "transcription" | "extraction",
): string {
  const lower = rawMessage.toLowerCase();
  const shortRaw = rawMessage.length > 500 ? `${rawMessage.slice(0, 500)}…` : rawMessage;
  if (
    lower.includes("incorrect api key") ||
    lower.includes("invalid api key") ||
    lower.includes("unauthorized") ||
    lower.includes("401")
  ) {
    return `Voice capture ${stage} is not authorized. Check OPENAI_API_KEY in Supabase edge function secrets. Details: ${shortRaw}`;
  }
  if (
    lower.includes("model") && (
      lower.includes("not found") ||
      lower.includes("does not exist") ||
      lower.includes("unsupported")
    )
  ) {
    return `Voice capture ${stage} is using an unavailable OpenAI model. Update the function configuration and redeploy. Details: ${shortRaw}`;
  }
  if (
    lower.includes("invalid file format") ||
    lower.includes("unsupported media type") ||
    lower.includes("audio file") ||
    lower.includes("codec") ||
    lower.includes("unrecognized file format")
  ) {
    return `This recording format could not be processed. Try a shorter recording or a different browser/device. Details: ${shortRaw}`;
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("capacity") ||
    lower.includes("quota")
  ) {
    return `OpenAI is rate limiting voice capture ${stage} right now. Please wait a minute and try again. Details: ${shortRaw}`;
  }
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("error sending request") ||
    lower.includes("dns error") ||
    lower.includes("connection reset")
  ) {
    return `Voice capture ${stage} could not reach OpenAI. Please try again in a moment. Details: ${shortRaw}`;
  }
  return stage === "transcription"
    ? `Transcription failed. Details: ${shortRaw}`
    : `Failed to extract deal data from the transcript. Details: ${shortRaw}`;
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
