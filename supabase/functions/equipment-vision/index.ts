/**
 * Equipment Vision Edge Function
 *
 * Accepts a photo of equipment and uses OpenAI's vision capabilities to:
 * 1. Identify make, model, year, and equipment category
 * 2. Assess visible condition (exterior, wear, damage)
 * 3. Cross-reference against CRM equipment inventory and market valuations
 * 4. Return a structured analysis with estimated value range
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

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
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return jsonError("Unauthorized", 401, ch);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonError("Unauthorized", 401, ch);
    }

    const contentType = req.headers.get("content-type") ?? "";
    let imageBase64: string;
    let imageMimeType: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const imageFile = formData.get("image") as File | null;
      if (!imageFile || imageFile.size === 0) {
        return jsonError("image field is required", 400, ch);
      }
      if (imageFile.size > 20 * 1024 * 1024) {
        return jsonError("Image exceeds 20MB limit", 400, ch);
      }
      imageMimeType = imageFile.type || "image/jpeg";
      const buffer = await imageFile.arrayBuffer();
      imageBase64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
      );
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      if (!body.image_base64) {
        return jsonError("image_base64 field is required", 400, ch);
      }
      imageBase64 = body.image_base64;
      imageMimeType = body.mime_type || "image/jpeg";
    } else {
      return jsonError("Expected multipart/form-data or application/json with image_base64", 400, ch);
    }

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) {
      return jsonError("OPENAI_API_KEY not configured", 503, ch);
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
    });

    if (!visionRes.ok) {
      const errText = await visionRes.text();
      console.error("OpenAI vision error:", errText);
      return jsonError("Equipment analysis failed. Please try again.", 500, ch);
    }

    const visionData = await visionRes.json();
    const rawContent = visionData.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      return jsonError("No analysis returned", 500, ch);
    }

    let analysis: VisionAnalysis;
    try {
      const cleaned = rawContent.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      analysis = JSON.parse(cleaned);
    } catch {
      return jsonError("Failed to parse equipment analysis", 500, ch);
    }

    // Cross-reference with CRM equipment and market data
    const adminDb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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

    return new Response(JSON.stringify({
      analysis,
      crm_matches: {
        inventory: matchingInventory,
        valuations: marketValuations,
      },
    }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("equipment-vision error:", err);
    return jsonError("Internal server error", 500, ch);
  }
});

function jsonError(message: string, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
