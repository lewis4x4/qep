/**
 * Voice-to-Parts-Order — field-tech voice input → parts order.
 *
 * Input: transcript text (or audio blob for future Whisper integration).
 * Processing:
 *   1. AI extracts: part descriptions, quantities, equipment context, urgency
 *   2. Fuzzy matches against parts_catalog
 *   3. Checks inventory across branches
 *   4. Creates draft parts_order with order_source: 'voice'
 *   5. Machine-down orders get expedited routing
 *
 * Auth: user JWT (requireServiceUser).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface VoicePartsExtraction {
  parts: Array<{
    description: string;
    part_number_guess: string | null;
    quantity: number;
    urgency: string | null;
  }>;
  equipment_context: {
    make: string | null;
    model: string | null;
    serial: string | null;
    location: string | null;
  } | null;
  is_machine_down: boolean;
  customer_name: string | null;
  notes: string | null;
}

const EXTRACTION_PROMPT = (transcript: string) => `You are a parts extraction AI for a heavy equipment dealership. A field technician or parts counter person just described what they need via voice.

Transcript:
"""
${transcript}
"""

Extract the following information. If something is not explicitly stated, use null. Do NOT fabricate.

Return ONLY valid JSON:
{
  "parts": [
    {
      "description": "human-readable part description",
      "part_number_guess": "if they mentioned a part number or code, otherwise null",
      "quantity": 1,
      "urgency": "machine_down | urgent | normal | null"
    }
  ],
  "equipment_context": {
    "make": "manufacturer like Caterpillar, Komatsu, Yanmar, etc. or null",
    "model": "model number/name or null",
    "serial": "serial number if mentioned or null",
    "location": "job site or location if mentioned or null"
  },
  "is_machine_down": false,
  "customer_name": "customer or company name if mentioned, or null",
  "notes": "any additional context the technician mentioned"
}`;

async function extractFromTranscript(
  transcript: string,
): Promise<VoicePartsExtraction> {
  if (!OPENAI_API_KEY) {
    return heuristicExtract(transcript);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 1024,
        messages: [
          { role: "system", content: "You extract structured parts order data from voice transcripts. Return only valid JSON." },
          { role: "user", content: EXTRACTION_PROMPT(transcript) },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("voice-to-parts-order OpenAI error:", res.status);
      return heuristicExtract(transcript);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return heuristicExtract(transcript);

    return JSON.parse(jsonMatch[0]) as VoicePartsExtraction;
  } catch (e) {
    console.warn("voice-to-parts-order extraction fallback:", e);
    return heuristicExtract(transcript);
  }
}

function heuristicExtract(transcript: string): VoicePartsExtraction {
  const lower = transcript.toLowerCase();
  const isMachineDown =
    lower.includes("machine down") ||
    lower.includes("machine-down") ||
    lower.includes("broken down") ||
    lower.includes("emergency");

  const quantityMatch = lower.match(/(\d+)\s+(of|x|units?|pieces?|pcs?)/);
  const quantity = quantityMatch ? parseInt(quantityMatch[1], 10) : 1;

  return {
    parts: [
      {
        description: transcript.slice(0, 200),
        part_number_guess: null,
        quantity: Math.max(1, Math.min(quantity, 999)),
        urgency: isMachineDown ? "machine_down" : null,
      },
    ],
    equipment_context: null,
    is_machine_down: isMachineDown,
    customer_name: null,
    notes: transcript,
  };
}

async function fuzzyMatchCatalog(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  workspaceId: string,
  parts: VoicePartsExtraction["parts"],
): Promise<
  Array<{
    input: VoicePartsExtraction["parts"][number];
    match: { part_number: string; description: string; list_price: number | null } | null;
    inventory: Array<{ branch_id: string; qty_on_hand: number }>;
  }>
> {
  const { data: catalog } = await supabase
    .from("parts_catalog")
    .select("part_number, description, list_price, category")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(2000);

  const catalogRows = (catalog ?? []) as Array<{
    part_number: string;
    description: string;
    list_price: number | null;
    category: string | null;
  }>;

  const results = [];

  for (const part of parts) {
    let bestMatch: (typeof catalogRows)[number] | null = null;
    let bestScore = 0;

    const searchTerms = [
      part.part_number_guess?.toLowerCase(),
      part.description.toLowerCase(),
    ].filter(Boolean) as string[];

    for (const row of catalogRows) {
      let score = 0;
      const pn = row.part_number.toLowerCase();
      const desc = row.description?.toLowerCase() ?? "";

      for (const term of searchTerms) {
        if (pn === term) { score += 100; continue; }
        if (pn.includes(term) || term.includes(pn)) score += 60;

        const words = term.split(/\s+/);
        for (const word of words) {
          if (word.length < 3) continue;
          if (pn.includes(word)) score += 30;
          if (desc.includes(word)) score += 20;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = row;
      }
    }

    const matchedPart = bestScore >= 20 ? bestMatch : null;

    let inventory: Array<{ branch_id: string; qty_on_hand: number }> = [];
    if (matchedPart) {
      const { data: inv } = await supabase
        .from("parts_inventory")
        .select("branch_id, qty_on_hand")
        .eq("workspace_id", workspaceId)
        .eq("part_number", matchedPart.part_number)
        .is("deleted_at", null)
        .gt("qty_on_hand", 0);
      inventory = (inv ?? []) as Array<{ branch_id: string; qty_on_hand: number }>;
    }

    results.push({
      input: part,
      match: matchedPart
        ? {
          part_number: matchedPart.part_number,
          description: matchedPart.description,
          list_price: matchedPart.list_price,
        }
        : null,
      inventory,
    });
  }

  return results;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  const supabase = auth.supabase;
  const userId = auth.userId;

  let body: {
    transcript: string;
    crm_company_id?: string;
    auto_submit?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }

  const MAX_TRANSCRIPT_LENGTH = 32_000;
  const rawTranscript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!rawTranscript || rawTranscript.length < 5) {
    return safeJsonError("transcript is required (min 5 chars)", 400, origin);
  }
  const transcript = rawTranscript.slice(0, MAX_TRANSCRIPT_LENGTH);

  // Get workspace
  const { data: pw } = await supabase
    .from("profile_workspaces")
    .select("workspace_id")
    .eq("profile_id", userId)
    .maybeSingle();
  const workspaceId = pw?.workspace_id ?? "default";

  // 1. AI extraction
  const extraction = await extractFromTranscript(transcript);

  // 2. Fuzzy match + inventory check
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const matchResults = await fuzzyMatchCatalog(adminClient, workspaceId, extraction.parts);

  // 3. Build line items from matches
  const lineItems = matchResults.map((r, idx) => ({
    part_number: r.match?.part_number ?? `VOICE-${idx + 1}`,
    description: r.match?.description ?? r.input.description.slice(0, 500),
    quantity: r.input.quantity,
    unit_price: r.match?.list_price ?? null,
    is_ai_suggested: true,
  }));

  // 4. Resolve company (if provided or extracted)
  let crmCompanyId = typeof body.crm_company_id === "string" ? body.crm_company_id.trim() : "";
  if (!crmCompanyId && extraction.customer_name) {
    const { data: companyMatch } = await adminClient
      .from("crm_companies")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("name", `%${extraction.customer_name}%`)
      .limit(1)
      .maybeSingle();
    if (companyMatch?.id) crmCompanyId = companyMatch.id;
  }

  // 5. Create draft order
  const totals = lineItems.reduce(
    (acc, li) => {
      const lineTotal = (li.unit_price ?? 0) * li.quantity;
      return { subtotal: acc.subtotal + lineTotal, total: acc.total + lineTotal };
    },
    { subtotal: 0, total: 0 },
  );

  const orderPayload: Record<string, unknown> = {
    workspace_id: workspaceId,
    status: "draft",
    order_source: "voice",
    created_by: userId,
    is_machine_down: extraction.is_machine_down,
    voice_transcript: transcript,
    voice_extraction: extraction,
    line_items: lineItems,
    notes: extraction.notes ?? null,
    subtotal: totals.subtotal,
    tax: 0,
    shipping: 0,
    total: totals.total,
  };

  if (crmCompanyId) {
    orderPayload.crm_company_id = crmCompanyId;
  }

  const { data: order, error: orderErr } = await adminClient
    .from("parts_orders")
    .insert(orderPayload)
    .select()
    .single();

  if (orderErr) {
    console.error("voice-to-parts-order create:", orderErr);
    return safeJsonError("Failed to create voice order", 400, origin);
  }

  const orderId = order?.id as string;

  // Insert relational line items
  const lineRows = lineItems.map((li, idx) => ({
    parts_order_id: orderId,
    part_number: li.part_number,
    description: li.description,
    quantity: li.quantity,
    unit_price: li.unit_price,
    line_total: li.unit_price != null ? li.unit_price * li.quantity : null,
    sort_order: idx,
  }));

  if (lineRows.length > 0) {
    const { error: lineErr } = await adminClient
      .from("parts_order_lines")
      .insert(lineRows);
    if (lineErr) {
      console.warn("voice-to-parts-order lines:", lineErr);
    }
  }

  // Emit order event
  try {
    await adminClient.from("parts_order_events").insert({
      workspace_id: workspaceId,
      parts_order_id: orderId,
      event_type: "created",
      source: "system",
      actor_id: userId,
      to_status: "draft",
      metadata: {
        order_source: "voice",
        is_machine_down: extraction.is_machine_down,
        parts_matched: matchResults.filter((r) => r.match).length,
        parts_unmatched: matchResults.filter((r) => !r.match).length,
      },
    });
  } catch { /* non-blocking */ }

  // If machine-down + auto_submit + company resolved, auto-submit
  if (body.auto_submit && extraction.is_machine_down && crmCompanyId) {
    try {
      const { data: run } = await adminClient
        .from("parts_fulfillment_runs")
        .insert({ workspace_id: workspaceId, status: "submitted" })
        .select("id")
        .single();

      if (run?.id) {
        await adminClient
          .from("parts_orders")
          .update({ status: "submitted", fulfillment_run_id: run.id })
          .eq("id", orderId);

        await adminClient.from("parts_order_events").insert({
          workspace_id: workspaceId,
          parts_order_id: orderId,
          event_type: "submitted",
          source: "system",
          actor_id: userId,
          from_status: "draft",
          to_status: "submitted",
          metadata: { auto_submit: true, machine_down: true },
        });
      }
    } catch (e) {
      console.warn("voice-to-parts-order auto-submit:", e);
    }
  }

  return safeJsonOk(
    {
      order_id: orderId,
      extraction,
      matches: matchResults.map((r) => ({
        input_description: r.input.description,
        matched_part: r.match?.part_number ?? null,
        confidence: r.match ? "matched" : "unmatched",
        inventory: r.inventory,
      })),
      is_machine_down: extraction.is_machine_down,
      auto_submitted: body.auto_submit && extraction.is_machine_down && !!crmCompanyId,
    },
    origin,
    201,
  );
});
