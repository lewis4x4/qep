/**
 * Parts Photo Identification — snap a photo of a worn/damaged part → get catalog matches.
 *
 * Input: base64 image + optional equipment context (make, model).
 * Processing:
 *   1. Vision model (GPT-4o) extracts part type, OEM markings, condition
 *   2. Cross-references against parts_catalog + parts_cross_references
 *   3. Returns ranked list of matching catalog entries with confidence
 *
 * Auth: user JWT (requireServiceUser).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { resolveProfileActiveWorkspaceId } from "../_shared/workspace.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface PhotoIdentification {
  identified_parts: Array<{
    description: string;
    part_type: string | null;
    oem_markings: string | null;
    visible_part_number: string | null;
    condition: string | null;
    wear_indicators: string[];
    confidence: number;
  }>;
  equipment_context: {
    make: string | null;
    model: string | null;
    system: string | null;
  } | null;
  notes: string | null;
}

interface CatalogMatch {
  part_number: string;
  description: string;
  category: string | null;
  list_price: number | null;
  match_score: number;
  match_reason: string;
  inventory: Array<{ branch_id: string; qty_on_hand: number }>;
  substitutes: Array<{ part_number: string; relationship: string }>;
}

async function identifyFromPhoto(
  imageBase64: string,
  mimeType: string,
  equipmentContext: string | null,
): Promise<PhotoIdentification> {
  if (!OPENAI_API_KEY) {
    return {
      identified_parts: [{
        description: "Photo identification requires OPENAI_API_KEY configuration",
        part_type: null,
        oem_markings: null,
        visible_part_number: null,
        condition: null,
        wear_indicators: [],
        confidence: 0,
      }],
      equipment_context: null,
      notes: "AI service unavailable — configure OPENAI_API_KEY",
    };
  }

  const contextHint = equipmentContext
    ? `\nEquipment context provided by user: ${equipmentContext}`
    : "";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.1,
        max_tokens: 2048,
        messages: [
          {
            role: "system",
            content: `You are a heavy equipment parts identification specialist. Analyze the photo to identify parts, OEM markings, part numbers, wear condition, and compatible equipment. Return ONLY valid JSON.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Identify the part(s) in this photo. For each part, provide:
- What type of part it is (hydraulic filter, seal kit, track pad, blade edge, etc.)
- Any visible OEM markings or part numbers
- Condition assessment (new, worn, damaged, failed)
- Wear indicators (scoring, deformation, discoloration, leaking, cracked, etc.)
- What equipment system it likely belongs to (hydraulic, undercarriage, engine, etc.)
- Your confidence (0.0-1.0) in the identification${contextHint}

Return ONLY valid JSON:
{
  "identified_parts": [{
    "description": "detailed description",
    "part_type": "hydraulic_filter | seal_kit | track_pad | blade_edge | bucket_teeth | belt | hose | bearing | gasket | other",
    "oem_markings": "any visible markings or null",
    "visible_part_number": "if readable or null",
    "condition": "new | worn | damaged | failed",
    "wear_indicators": ["list of observed wear signs"],
    "confidence": 0.85
  }],
  "equipment_context": {
    "make": "manufacturer if identifiable or null",
    "model": "model if identifiable or null",
    "system": "hydraulic | undercarriage | engine | electrical | structural | other"
  },
  "notes": "any additional observations"
}`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("parts-identify-photo OpenAI error:", res.status);
      throw new Error(`OpenAI API error: ${res.status}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    return JSON.parse(jsonMatch[0]) as PhotoIdentification;
  } catch (e) {
    console.error("parts-identify-photo identification:", e);
    return {
      identified_parts: [{
        description: "Photo analysis failed — try again or enter part details manually",
        part_type: null,
        oem_markings: null,
        visible_part_number: null,
        condition: null,
        wear_indicators: [],
        confidence: 0,
      }],
      equipment_context: null,
      notes: `Error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function matchAgainstCatalog(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  workspaceId: string,
  identification: PhotoIdentification,
): Promise<CatalogMatch[]> {
  const { data: catalog } = await supabase
    .from("parts_catalog")
    .select("part_number, description, category, list_price")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(2000);

  const catalogRows = (catalog ?? []) as Array<{
    part_number: string;
    description: string;
    category: string | null;
    list_price: number | null;
  }>;

  const results: CatalogMatch[] = [];

  for (const part of identification.identified_parts) {
    if (part.confidence < 0.1) continue;

    const scored: Array<{ row: (typeof catalogRows)[number]; score: number; reason: string }> = [];

    for (const row of catalogRows) {
      let score = 0;
      const reasons: string[] = [];
      const pn = row.part_number.toLowerCase();
      const desc = row.description?.toLowerCase() ?? "";
      const cat = row.category?.toLowerCase() ?? "";

      // Direct part number match
      if (part.visible_part_number) {
        const visiblePn = part.visible_part_number.toLowerCase();
        if (pn === visiblePn) {
          score += 100;
          reasons.push("exact_part_number");
        } else if (pn.includes(visiblePn) || visiblePn.includes(pn)) {
          score += 70;
          reasons.push("partial_part_number");
        }
      }

      // OEM marking match
      if (part.oem_markings) {
        const markings = part.oem_markings.toLowerCase();
        if (pn.includes(markings) || desc.includes(markings)) {
          score += 50;
          reasons.push("oem_marking");
        }
      }

      // Part type match against category/description
      if (part.part_type) {
        const typeWords = part.part_type.replace(/_/g, " ").split(/\s+/);
        for (const word of typeWords) {
          if (word.length < 3) continue;
          if (cat.includes(word)) { score += 25; reasons.push("category_match"); }
          if (desc.includes(word)) { score += 15; reasons.push("description_match"); }
          if (pn.includes(word)) { score += 20; reasons.push("part_number_keyword"); }
        }
      }

      // Description keyword match
      const descWords = part.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length < 3) continue;
        if (desc.includes(word)) score += 5;
        if (pn.includes(word)) score += 8;
      }

      // Confidence weighting
      score *= part.confidence;

      if (score >= 10) {
        scored.push({ row, score, reason: [...new Set(reasons)].join(", ") || "keyword" });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    for (const { row, score, reason } of scored.slice(0, 5)) {
      const { data: inv } = await supabase
        .from("parts_inventory")
        .select("branch_id, qty_on_hand")
        .eq("workspace_id", workspaceId)
        .eq("part_number", row.part_number)
        .is("deleted_at", null)
        .gt("qty_on_hand", 0);

      let subs: Array<{ part_number: string; relationship: string }> = [];
      try {
        const { data: xrefs } = await supabase
          .from("parts_cross_references")
          .select("part_number_b, relationship")
          .eq("workspace_id", workspaceId)
          .eq("part_number_a", row.part_number)
          .limit(5);
        subs = (xrefs ?? []).map((x: { part_number_b: string; relationship: string }) => ({
          part_number: x.part_number_b,
          relationship: x.relationship,
        }));
      } catch { /* cross-ref table may not exist yet */ }

      results.push({
        part_number: row.part_number,
        description: row.description,
        category: row.category,
        list_price: row.list_price,
        match_score: Math.round(score),
        match_reason: reason,
        inventory: (inv ?? []) as Array<{ branch_id: string; qty_on_hand: number }>,
        substitutes: subs,
      });
    }
  }

  results.sort((a, b) => b.match_score - a.match_score);
  return results.slice(0, 10);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  let body: {
    image_base64: string;
    mime_type?: string;
    equipment_context?: string;
  };
  try {
    body = await req.json();
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }

  const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // ~15 MB base64
  const imageBase64 = typeof body.image_base64 === "string" ? body.image_base64.trim() : "";
  if (!imageBase64 || imageBase64.length < 100) {
    return safeJsonError("image_base64 is required", 400, origin);
  }
  if (imageBase64.length > MAX_IMAGE_SIZE) {
    return safeJsonError("Image too large (max ~10 MB)", 400, origin);
  }

  const mimeType = body.mime_type ?? "image/jpeg";
  const equipmentContext = typeof body.equipment_context === "string"
    ? body.equipment_context.trim() || null
    : null;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const workspaceId = await resolveProfileActiveWorkspaceId(adminClient, auth.userId);

  // 1. Vision identification
  const identification = await identifyFromPhoto(imageBase64, mimeType, equipmentContext);

  // 2. Match against catalog
  const catalogMatches = await matchAgainstCatalog(adminClient, workspaceId, identification);

  return safeJsonOk(
    {
      identification,
      catalog_matches: catalogMatches,
      has_matches: catalogMatches.length > 0,
      top_match: catalogMatches[0] ?? null,
    },
    origin,
  );
});
