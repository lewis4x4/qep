/**
 * Trade Valuation Edge Function
 *
 * Photo upload → Equipment Vision AI → market comp pull → pricing formula →
 * preliminary value. Target: <60 seconds.
 *
 * Pricing formula (from SOP):
 *   Auction Value × 0.92 (8% discount) - Reconditioning = Preliminary Value
 *
 * POST: Create trade valuation with photos + equipment details
 * GET:  ?deal_id=... → list valuations for deal
 * PUT:  Update valuation (approval, final value)
 *
 * Auth: rep/admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface TradeValuationInput {
  deal_id?: string;
  make: string;
  model: string;
  year?: number;
  serial_number?: string;
  hours?: number;
  photos?: Array<{ type: string; url: string }>;
  video_url?: string;
  operational_status?: string;
  last_full_service?: string;
  needed_repairs?: string;
  attachments_included?: string[];
}

async function aiConditionAssessment(photos: Array<{ type: string; url: string }>): Promise<{
  score: number;
  notes: string;
  detected_damage: string[];
}> {
  if (!OPENAI_API_KEY || photos.length === 0) {
    return { score: 70, notes: "AI assessment unavailable — manual review required", detected_damage: [] };
  }

  try {
    const imageMessages = photos.slice(0, 4).map((p) => ({
      type: "image_url" as const,
      image_url: { url: p.url },
    }));

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an equipment condition assessment AI for a heavy equipment dealership. Analyze the photos and return a JSON object with:
- "score": number 0-100 (100 = pristine, 0 = scrap)
- "notes": string (2-3 sentence condition summary)
- "detected_damage": string[] (list of visible issues)
Be conservative in scoring. Note any rust, leaks, tire wear, structural damage, paint condition, and attachment wear.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Assess the condition of this equipment from these photos:" },
              ...imageMessages,
            ],
          },
        ],
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.error("Vision AI error:", await res.text());
      return { score: 70, notes: "AI assessment failed — manual review required", detected_damage: [] };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { score: 70, notes: "AI returned no assessment", detected_damage: [] };
    }

    return JSON.parse(content);
  } catch (err) {
    console.error("AI condition assessment error:", err);
    return { score: 70, notes: "AI assessment error — manual review required", detected_damage: [] };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    // ── GET: list valuations ─────────────────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const dealId = url.searchParams.get("deal_id");

      let query = supabase.from("trade_valuations").select("*").order("created_at", { ascending: false });
      if (dealId) query = query.eq("deal_id", dealId);

      const { data, error } = await query;
      if (error) {
        return safeJsonError("Failed to fetch valuations", 500, origin);
      }

      return safeJsonOk({ valuations: data }, origin);
    }

    // ── POST: create valuation ───────────────────────────────────────────
    if (req.method === "POST") {
      const pipelineStart = Date.now();
      const body: TradeValuationInput = await req.json();

      if (!body.make || !body.model) {
        return safeJsonError("make and model are required", 400, origin);
      }

      // Step 1: AI condition assessment from photos
      const aiAssessment = await aiConditionAssessment(body.photos || []);

      // Step 2: Create valuation record (pricing auto-calculated by DB trigger)
      const { data: valuation, error: valError } = await supabase
        .from("trade_valuations")
        .insert({
          deal_id: body.deal_id || null,
          make: body.make,
          model: body.model,
          year: body.year,
          serial_number: body.serial_number,
          hours: body.hours,
          photos: body.photos || [],
          video_url: body.video_url,
          operational_status: body.operational_status,
          last_full_service: body.last_full_service,
          needed_repairs: body.needed_repairs,
          attachments_included: body.attachments_included || [],
          ai_condition_score: aiAssessment.score,
          ai_condition_notes: aiAssessment.notes,
          ai_detected_damage: aiAssessment.detected_damage,
          status: "preliminary",
          created_by: user.id,
        })
        .select()
        .single();

      if (valError) {
        console.error("trade-valuation POST error:", valError);
        return safeJsonError("Failed to create valuation", 500, origin);
      }

      const duration = Date.now() - pipelineStart;

      return safeJsonOk({
        valuation,
        ai_assessment: aiAssessment,
        pipeline_duration_ms: duration,
      }, origin, 201);
    }

    // ── PUT: update valuation (approval, final value, market comps) ──────
    if (req.method === "PUT") {
      const body = await req.json();

      if (!body.id) {
        return safeJsonError("id is required", 400, origin);
      }

      const { id, ...updates } = body;

      // If approving, record the approver
      if (updates.status === "approved") {
        updates.approved_by = user.id;
      }

      const { data, error } = await supabase
        .from("trade_valuations")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return safeJsonError("Failed to update valuation", 500, origin);
      }

      return safeJsonOk({ valuation: data }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    console.error("trade-valuation error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
