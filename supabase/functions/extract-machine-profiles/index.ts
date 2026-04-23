// ============================================================
// Edge Function: extract-machine-profiles
// Purpose: Admin-only onboarding tool. Extracts structured machine
// profile data from manufacturer PDFs ingested into the Knowledge
// Assistant. Uses Claude API to parse specs, maintenance schedules,
// fluid capacities, and common wear parts.
// ============================================================

import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

// ── Types ───────────────────────────────────────────────────

interface ExtractionRequest {
  manufacturer: string;
  document_ids: string[];
  dry_run?: boolean;
}

interface ExtractedProfile {
  manufacturer: string;
  model: string;
  model_family?: string;
  year_range_start?: number;
  year_range_end?: number;
  category: string;
  specs: Record<string, unknown>;
  maintenance_schedule: Array<{
    interval_hours: number;
    tasks: string[];
    parts?: string[];
  }>;
  fluid_capacities: Record<
    string,
    { capacity: string; spec: string }
  >;
  common_wear_parts: Record<
    string,
    Array<{
      part_number: string;
      description: string;
      avg_replace_hours?: number;
    }>
  >;
}

interface ExtractionResult {
  profiles_created: number;
  profiles_updated: number;
  parts_extracted: number;
  documents_processed: number;
  documents_failed: number;
  errors: string[];
  profiles: Array<{
    manufacturer: string;
    model: string;
    status: "created" | "updated" | "failed";
    confidence: number;
  }>;
}

// ── Extraction Prompt ───────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a parts and equipment data extraction specialist. Given manufacturer documentation text, extract structured machine profile data.

Return a JSON array of machine profiles. Each profile should have:
- manufacturer: string (the manufacturer name)
- model: string (the model number/name)
- model_family: string (optional - product line grouping)
- year_range_start: number (optional - first production year)
- year_range_end: number (optional - null if still in production)
- category: string (one of: forestry_loader, chipper, compact_track_loader, mulcher, excavator, wheel_loader, crane, shear, grinder, carrier)
- specs: object with key specs (weight_lbs, horsepower, operating_capacity_lbs, boom_reach_ft, etc.)
- maintenance_schedule: array of { interval_hours, tasks: string[], parts: string[] }
- fluid_capacities: object like { engine_oil: { capacity: "16 qt", spec: "15W-40 CK-4" } }
- common_wear_parts: object grouped by system like { engine: [{ part_number, description, avg_replace_hours }], hydraulic: [...] }

Extract ALL machine models mentioned in the text. Include part numbers exactly as written in the documentation. If a value is uncertain, include it with a note. Return valid JSON only.`;

// ── Claude API Call ─────────────────────────────────────────

async function extractFromDocument(
  documentText: string,
  manufacturer: string,
): Promise<{ profiles: ExtractedProfile[]; confidence: number }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract machine profiles for manufacturer "${manufacturer}" from the following documentation:\n\n${documentText.slice(0, 30000)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const content = result.content?.[0]?.text || "";

  // Extract JSON from response (may be wrapped in markdown code blocks)
  // Try code block first, then fall back to finding a JSON array
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1].trim() : content;
  const arrayStart = jsonText.indexOf("[");
  const arrayEnd = jsonText.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) {
    throw new Error("No valid JSON array found in extraction response");
  }

  const profiles: ExtractedProfile[] = JSON.parse(jsonText.slice(arrayStart, arrayEnd + 1));

  // Estimate confidence based on completeness
  let totalFields = 0;
  let filledFields = 0;
  for (const p of profiles) {
    totalFields += 7; // core fields
    if (p.model) filledFields++;
    if (p.category) filledFields++;
    if (p.specs && Object.keys(p.specs).length > 0) filledFields++;
    if (p.maintenance_schedule?.length > 0) filledFields++;
    if (p.fluid_capacities && Object.keys(p.fluid_capacities).length > 0)
      filledFields++;
    if (p.common_wear_parts && Object.keys(p.common_wear_parts).length > 0)
      filledFields++;
    if (p.year_range_start) filledFields++;
  }
  const confidence =
    totalFields > 0 ? Math.round((filledFields / totalFields) * 100) / 100 : 0;

  return { profiles, confidence };
}

// ── Main Handler ────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST")
    return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(
    req.headers.get("Authorization"),
    origin,
  );
  if (!auth.ok) return auth.response;

  const { supabase, userId, role } = auth;

  // Admin/owner only
  if (!["admin", "owner"].includes(role)) {
    return safeJsonError(
      "Only admin or owner can run profile extraction",
      403,
      origin,
    );
  }

  let body: ExtractionRequest;
  try {
    body = (await req.json()) as ExtractionRequest;
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }

  const { manufacturer, document_ids, dry_run } = body;

  if (!manufacturer || typeof manufacturer !== "string") {
    return safeJsonError("manufacturer is required", 400, origin);
  }
  if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
    return safeJsonError("document_ids array is required", 400, origin);
  }

  const result: ExtractionResult = {
    profiles_created: 0,
    profiles_updated: 0,
    parts_extracted: 0,
    documents_processed: 0,
    documents_failed: 0,
    errors: [],
    profiles: [],
  };

  // Process each document
  for (const docId of document_ids) {
    try {
      // Fetch document chunks from the canonical `chunks` table.
      // (The legacy `kb_chunks` table referenced here previously never
      // existed in this schema, so the function 404'd on every call.)
      // The real table stores body text in `content` and has no
      // section_title / page_number columns — those fields were never
      // populated, so we drop them and order by chunk_index only.
      const { data: chunks, error: chunkError } = await supabase
        .from("chunks")
        .select("content, chunk_index")
        .eq("document_id", docId)
        .order("chunk_index", { ascending: true });

      if (chunkError || !chunks || chunks.length === 0) {
        result.documents_failed++;
        result.errors.push(
          `Document ${docId}: ${chunkError?.message || "no chunks found"}`,
        );
        continue;
      }

      // Combine chunks into a single document text
      const documentText = chunks
        .map((c: { content: string | null }) => c.content ?? "")
        .filter((text) => text.length > 0)
        .join("\n\n");

      // Extract profiles via Claude
      const { profiles, confidence } = await extractFromDocument(
        documentText,
        manufacturer,
      );

      result.documents_processed++;

      if (dry_run) {
        // In dry run, just report what would be created
        for (const profile of profiles) {
          result.profiles.push({
            manufacturer: profile.manufacturer || manufacturer,
            model: profile.model,
            status: "created",
            confidence,
          });
        }
        continue;
      }

      // Upsert profiles
      for (const profile of profiles) {
        try {
          const profileData = {
            manufacturer: profile.manufacturer || manufacturer,
            model: profile.model,
            model_family: profile.model_family || null,
            year_range_start: profile.year_range_start || null,
            year_range_end: profile.year_range_end || null,
            category: profile.category || "other",
            specs: profile.specs || {},
            maintenance_schedule: profile.maintenance_schedule || [],
            fluid_capacities: profile.fluid_capacities || {},
            common_wear_parts: profile.common_wear_parts || {},
            source_documents: [docId],
            extraction_confidence: confidence,
            manually_verified: false,
          };

          // Check for existing profile
          const { data: existing } = await supabase
            .from("machine_profiles")
            .select("id, source_documents")
            .eq("manufacturer", profileData.manufacturer)
            .eq("model", profileData.model)
            .limit(1)
            .single();

          if (existing) {
            // Update existing — merge source documents
            const mergedDocs = Array.from(
              new Set([...(existing.source_documents || []), docId]),
            );
            await supabase
              .from("machine_profiles")
              .update({
                ...profileData,
                source_documents: mergedDocs,
              })
              .eq("id", existing.id);

            result.profiles_updated++;
            result.profiles.push({
              manufacturer: profileData.manufacturer,
              model: profileData.model,
              status: "updated",
              confidence,
            });
          } else {
            // Create new
            await supabase
              .from("machine_profiles")
              .insert(profileData);

            result.profiles_created++;
            result.profiles.push({
              manufacturer: profileData.manufacturer,
              model: profileData.model,
              status: "created",
              confidence,
            });
          }

          // Extract and link parts to catalog
          const allParts = Object.values(profile.common_wear_parts || {}).flat();
          for (const part of allParts as Array<{ part_number: string; description: string }>) {
            if (part.part_number) {
              // Try to find existing catalog entry
              const { data: existingPart } = await supabase
                .from("parts_catalog")
                .select("id")
                .eq("part_number", part.part_number)
                .limit(1)
                .single();

              if (!existingPart) {
                // Create new catalog entry
                await supabase.from("parts_catalog").insert({
                  part_number: part.part_number,
                  description: part.description || null,
                  manufacturer: profileData.manufacturer,
                  source_documents: [docId],
                  extraction_confidence: confidence,
                });
              }

              result.parts_extracted++;
            }
          }
        } catch (profileErr) {
          const msg = profileErr instanceof Error ? profileErr.message : String(profileErr);
          result.errors.push(
            `Profile ${profile.model}: ${msg}`,
          );
          result.profiles.push({
            manufacturer: profile.manufacturer || manufacturer,
            model: profile.model,
            status: "failed",
            confidence: 0,
          });
        }
      }
    } catch (docErr) {
      result.documents_failed++;
      const msg = docErr instanceof Error ? docErr.message : String(docErr);
      result.errors.push(`Document ${docId}: ${msg}`);
    }
  }

  return safeJsonOk(result, origin);
});
