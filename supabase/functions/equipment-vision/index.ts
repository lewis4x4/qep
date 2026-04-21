/**
 * Equipment Vision Edge Function
 *
 * Accepts a photo of equipment and uses OpenAI's vision capabilities to:
 * 1. Identify make, model, year, and equipment category
 * 2. Assess visible condition (exterior, wear, damage)
 * 3. Cross-reference against QRM equipment inventory and market valuations
 * 4. Return a structured analysis with estimated value range
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureEdgeException } from "../_shared/sentry.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

const VISION_MODEL = "gpt-5.4-mini";

interface VisionAnalysis {
  equipment: {
    make: string | null;
    model: string | null;
    year: string | null;
    category: string | null;
    serial_visible: string | null;
  };
  condition: {
    overall: "excellent" | "good" | "fair" | "poor" | "unknown";
    exterior: string | null;
    wear_indicators: string[];
    damage_noted: string[];
    hours_estimate: string | null;
  };
  identification_confidence: "high" | "medium" | "low";
  description: string;
  key_features: string[];
  potential_issues: string[];
  recommended_next_steps: string[];
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    // Canonical JWT auth — validates against GoTrue (ES256-safe) and
    // returns a supabase client bound to the caller's JWT + their role.
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    const user = { id: auth.userId };

    const contentType = req.headers.get("content-type") ?? "";
    let imageBase64: string;
    let imageMimeType: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const imageFile = formData.get("image") as File | null;
      if (!imageFile || imageFile.size === 0) {
        return safeJsonError("image field is required", 400, origin);
      }
      if (imageFile.size > 20 * 1024 * 1024) {
        return safeJsonError("Image exceeds 20MB limit", 400, origin);
      }
      imageMimeType = imageFile.type || "image/jpeg";
      const buffer = await imageFile.arrayBuffer();
      imageBase64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
      );
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      if (!body.image_base64) {
        return safeJsonError("image_base64 field is required", 400, origin);
      }
      imageBase64 = body.image_base64;
      imageMimeType = body.mime_type || "image/jpeg";
    } else {
      return safeJsonError("Expected multipart/form-data or application/json with image_base64", 400, origin);
    }

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) {
      return safeJsonError("OPENAI_API_KEY not configured", 503, origin);
    }

    // Vision analysis
    const visionRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        response_format: { type: "json_object" },
        max_completion_tokens: 1500,
        messages: [
          {
            role: "system",
            content: `You are an expert heavy equipment appraiser for a dealership. Analyze the provided photo and return a JSON object with this exact structure:
{
  "equipment": {
    "make": "manufacturer name or null",
    "model": "model name/number or null",
    "year": "estimated year or range or null",
    "category": "e.g. Excavator, Wheel Loader, Skid Steer, Forestry, Crane, etc. or null",
    "serial_visible": "serial number if visible or null"
  },
  "condition": {
    "overall": "excellent | good | fair | poor | unknown",
    "exterior": "description of exterior condition",
    "wear_indicators": ["list of visible wear signs"],
    "damage_noted": ["list of any visible damage"],
    "hours_estimate": "estimated operating hours based on condition or null"
  },
  "identification_confidence": "high | medium | low",
  "description": "2-3 sentence description of what you see",
  "key_features": ["notable features, attachments, or configurations visible"],
  "potential_issues": ["any concerns a buyer or appraiser should investigate"],
  "recommended_next_steps": ["specific actions for the sales rep"]
}

Be specific about make/model when identifiable. Note any brand logos, model numbers, or distinctive features. If you cannot identify the equipment, say so clearly with low confidence.`,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${imageMimeType};base64,${imageBase64}`,
                  detail: "high",
                },
              },
              {
                type: "text",
                text: "Analyze this equipment photo. Identify the make, model, condition, and provide your assessment.",
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!visionRes.ok) {
      const errText = await visionRes.text();
      console.error("OpenAI vision error:", errText);
      return safeJsonError("Equipment analysis failed. Please try again.", 500, origin);
    }

    const visionData = await visionRes.json();
    const rawContent = visionData.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      return safeJsonError("No analysis returned", 500, origin);
    }

    let analysis: VisionAnalysis;
    try {
      const cleaned = rawContent.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      analysis = JSON.parse(cleaned);
    } catch {
      return safeJsonError("Failed to parse equipment analysis", 500, origin);
    }

    // Cross-reference with QRM equipment and market data
    const adminDb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Save the photo to Supabase Storage so it persists across page refreshes
    let savedImageUrl: string | null = null;
    const equipmentId = new URL(req.url).searchParams.get("equipmentId");
    try {
      const ext = imageMimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
      const fileName = `${equipmentId ?? user.id}/${crypto.randomUUID()}.${ext}`;
      const binaryString = atob(imageBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { error: uploadErr } = await adminDb.storage
        .from("equipment-photos")
        .upload(fileName, bytes.buffer, {
          contentType: imageMimeType,
          upsert: false,
        });

      if (!uploadErr) {
        const { data: urlData } = adminDb.storage
          .from("equipment-photos")
          .getPublicUrl(fileName);
        savedImageUrl = urlData?.publicUrl ?? null;
      } else {
        console.error("Photo upload error:", uploadErr.message);
      }
    } catch (uploadEx) {
      console.error("Photo upload exception:", uploadEx);
    }

    // If equipmentId provided, auto-update the equipment record with photo + analysis fields
    if (equipmentId && savedImageUrl) {
      try {
        const { data: existing } = await adminDb
          .from("crm_equipment")
          .select("photo_urls")
          .eq("id", equipmentId)
          .maybeSingle();

        const currentPhotos = Array.isArray(existing?.photo_urls) ? existing.photo_urls : [];
        const updatedPhotos = [...currentPhotos, savedImageUrl];

        const updateFields: Record<string, unknown> = {
          photo_urls: updatedPhotos,
        };

        if (analysis.equipment.make) updateFields.make = analysis.equipment.make;
        if (analysis.equipment.model) updateFields.model = analysis.equipment.model;
        if (analysis.equipment.year) {
          const yearNum = parseInt(analysis.equipment.year, 10);
          if (yearNum > 1900 && yearNum < 2100) updateFields.year = yearNum;
        }
        if (analysis.equipment.category) {
          const catMap: Record<string, string> = {
            "excavator": "excavator", "wheel loader": "loader", "loader": "loader",
            "backhoe": "backhoe", "dozer": "dozer", "bulldozer": "dozer",
            "skid steer": "skid_steer", "crane": "crane", "forklift": "forklift",
            "telehandler": "telehandler", "truck": "truck", "trailer": "trailer",
            "dump truck": "dump_truck", "aerial lift": "aerial_lift",
            "boom lift": "boom_lift", "scissor lift": "scissor_lift",
            "compactor": "compactor", "roller": "roller", "generator": "generator",
            "compressor": "compressor", "pump": "pump", "welder": "welder",
            "compact track loader": "skid_steer",
            "track loader": "loader",
          };
          const normalized = analysis.equipment.category.toLowerCase();
          const mapped = catMap[normalized];
          if (mapped) updateFields.category = mapped;
        }
        if (analysis.condition.overall && analysis.condition.overall !== "unknown") {
          updateFields.condition = analysis.condition.overall;
        }
        if (analysis.condition.hours_estimate) {
          const hoursMatch = analysis.condition.hours_estimate.match(/[\d,]+/);
          if (hoursMatch) {
            const hours = parseFloat(hoursMatch[0].replace(/,/g, ""));
            if (hours > 0) updateFields.engine_hours = hours;
          }
        }

        await adminDb
          .from("crm_equipment")
          .update(updateFields)
          .eq("id", equipmentId);
      } catch (patchEx) {
        console.error("Equipment auto-update error:", patchEx);
      }
    }

    let matchingInventory: unknown[] = [];
    let marketValuations: unknown[] = [];

    const makeModel = [analysis.equipment.make, analysis.equipment.model]
      .filter(Boolean)
      .join(" ");

    if (makeModel) {
      const [inventoryResult, valuationResult] = await Promise.all([
        adminDb
          .from("crm_equipment")
          .select("id, name, make, model, year, serial_number, condition, status, list_price, rental_rate_daily")
          .or(`make.ilike.%${analysis.equipment.make ?? ""}%,model.ilike.%${analysis.equipment.model ?? ""}%`)
          .is("deleted_at", null)
          .limit(5),
        adminDb
          .from("market_valuations")
          .select("id, equipment_description, estimated_value_low, estimated_value_high, valuation_date, source")
          .ilike("equipment_description", `%${makeModel}%`)
          .order("valuation_date", { ascending: false })
          .limit(5),
      ]);

      matchingInventory = inventoryResult.data ?? [];
      marketValuations = valuationResult.data ?? [];
    }

    return safeJsonOk({
      analysis,
      image_url: savedImageUrl,
      crm_matches: {
        inventory: matchingInventory,
        valuations: marketValuations,
      },
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "equipment-vision", req });
    console.error("equipment-vision error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
});
