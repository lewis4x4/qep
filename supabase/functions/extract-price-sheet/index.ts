/**
 * extract-price-sheet — Claude Extraction Edge Function (Slice 04)
 *
 * POST /extract-price-sheet
 * Body: { priceSheetId: string }
 *
 * Flow:
 *   1. Load qb_price_sheets row (file_url, brand_id, sheet_type, file_type).
 *   2. Download file from Supabase Storage.
 *   3. Route to correct Claude prompt based on sheet_type:
 *      - price_book or both → price book extraction prompt
 *      - retail_programs    → programs extraction prompt
 *      - both               → two-pass (models first, then programs)
 *   4. Parse JSON response. On parse failure: retry once.
 *   5. For each extracted item, call detectAction against catalog.
 *   6. Write rows to qb_price_sheet_items (models/attachments/freight) and
 *      qb_price_sheet_programs (programs).
 *   7. Per-item extraction_metadata captures raw Claude response + parsed JSON.
 *   8. Update qb_price_sheets.status = 'extracted'.
 *
 * Auth: requireServiceUser() — valid user JWT, roles: admin/manager/owner.
 *
 * Important: all relative imports use .ts extension (Deno requirement).
 * No @/ path aliases — they don't resolve in Deno.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.30.0";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonOk, safeJsonError } from "../_shared/safe-cors.ts";
import { emitAdminFlare } from "../_shared/admin-flare.ts";
import {
  detectModelAction,
  detectAttachmentAction,
  detectFreightZoneAction,
  type ExtractedModel,
  type ExtractedAttachment,
  type ExtractedFreightZone,
} from "../../../apps/web/src/lib/pricing/ingestion.ts";

// ── Claude prompt templates ───────────────────────────────────────────────────

const PRICE_BOOK_SYSTEM = `You are extracting structured data from a heavy equipment manufacturer price book for an AI-native dealership operating system at QEP USA.

The output must be valid JSON matching this schema exactly:

{
  "sheet_type": "price_book",
  "effective_from": "YYYY-MM-DD",
  "effective_to": "YYYY-MM-DD or null",
  "models": [
    {
      "model_code": "string",
      "family": "string",
      "name_display": "string",
      "standard_config": "string",
      "list_price_cents": integer,
      "specs": {},
      "notes": "string"
    }
  ],
  "attachments": [
    {
      "part_number": "string",
      "name": "string",
      "category": "string",
      "list_price_cents": integer,
      "compatible_model_codes": ["string"],
      "attachment_type": "factory_option | field_install | recommended_bucket"
    }
  ],
  "freight_zones": [
    {
      "state_codes": ["FL"],
      "zone_name": "string",
      "freight_large_cents": integer,
      "freight_small_cents": integer
    }
  ],
  "notes": ["string"]
}

Rules:
- All monetary values must be integer cents. $7,500 = 750000.
- If a price is missing or "Call", omit that item and add a note.
- Use exact model codes as printed. Do not normalize or clean up.
- If a section has a date (e.g., "Pricing Effective: 01/01/2026"), use it.
- Freight tables: each row is one zone. Multi-state zones: list every state.
- Include compatible_model_codes for attachments if listed near the attachment.
- Be exhaustive. If the document has 200 line items, return 200 items.
- Return ONLY JSON. No prose, no markdown fences.`;

const PROGRAMS_SYSTEM = `You are extracting manufacturer incentive programs from a heavy equipment dealer program document for an AI-native dealership operating system at QEP USA.

Output JSON schema exactly:

{
  "sheet_type": "retail_programs",
  "effective_from": "YYYY-MM-DD",
  "effective_to": "YYYY-MM-DD",
  "programs": [
    {
      "program_code": "string",
      "program_type": "cash_in_lieu | low_rate_financing | gmu_rebate | aged_inventory | bridge_rent_to_sales | additional_rebate",
      "name": "string",
      "details": {},
      "program_rules_notes": "string"
    }
  ],
  "stacking_notes": ["string"]
}

Rules:
- rate_pct is decimal: 0.00 for 0%, 0.0199 for 1.99%.
- dealer_participation_pct same format.
- For cash_in_lieu and aged_inventory: details.rebates = [{ model_code, amount_cents }]
- For low_rate_financing: details.terms = [{ months, rate_pct, dealer_participation_pct }], details.lenders = [{ name, customer_type, contact }]
- For gmu_rebate: details.discount_off_list_pct, details.requires_preapproval, details.eligible_customer_types
- For bridge_rent_to_sales: details.rebates = [{ model_code, amount_cents }]
- If a program lists cash amounts per model in a table, extract every row.
- Return ONLY JSON. No prose, no markdown fences.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileTypeFromUrl(fileUrl: string): string {
  const lower = fileUrl.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "excel";
  if (lower.endsWith(".csv")) return "csv";
  return "pdf";
}

type JsonRecord = Record<string, unknown>;

type ExtractedProgram = JsonRecord & {
  program_code: string;
  program_type?: string;
  name?: string;
  details?: JsonRecord;
  program_rules_notes?: string;
};

type PriceBookExtraction = {
  models: ExtractedModel[];
  attachments: ExtractedAttachment[];
  freight_zones: ExtractedFreightZone[];
  notes: string[];
};

type ProgramsExtraction = {
  programs: ExtractedProgram[];
  stacking_notes: string[];
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorRawResponse(error: unknown): unknown {
  return isJsonRecord(error) ? error.rawResponse : undefined;
}

function stringArrayField(record: JsonRecord, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayField(record: JsonRecord, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function normalizeExtractedModel(value: unknown): ExtractedModel | null {
  if (!isJsonRecord(value)) return null;
  const { model_code, family, name_display, standard_config, list_price_cents, specs, notes, ...extra } = value;
  return {
    ...extra,
    model_code: typeof model_code === "string" ? model_code : "",
    list_price_cents: typeof list_price_cents === "number" ? list_price_cents : 0,
    ...(typeof family === "string" ? { family } : {}),
    ...(typeof name_display === "string" ? { name_display } : {}),
    ...(typeof standard_config === "string" ? { standard_config } : {}),
    ...(isJsonRecord(specs) ? { specs } : {}),
    ...(typeof notes === "string" ? { notes } : {}),
  };
}

function normalizeExtractedAttachment(value: unknown): ExtractedAttachment | null {
  if (!isJsonRecord(value)) return null;
  const {
    part_number,
    name,
    category,
    list_price_cents,
    compatible_model_codes,
    attachment_type,
    ...extra
  } = value;
  return {
    ...extra,
    part_number: typeof part_number === "string" ? part_number : "",
    name: typeof name === "string" ? name : "",
    list_price_cents: typeof list_price_cents === "number" ? list_price_cents : 0,
    ...(typeof category === "string" ? { category } : {}),
    ...(Array.isArray(compatible_model_codes)
      ? { compatible_model_codes: compatible_model_codes.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(attachment_type === "factory_option" ||
        attachment_type === "field_install" ||
        attachment_type === "recommended_bucket"
      ? { attachment_type }
      : {}),
  };
}

function normalizeExtractedFreightZone(value: unknown): ExtractedFreightZone | null {
  if (!isJsonRecord(value)) return null;
  const { state_codes, zone_name, freight_large_cents, freight_small_cents, ...extra } = value;
  return {
    ...extra,
    state_codes: Array.isArray(state_codes) ? state_codes.filter((item): item is string => typeof item === "string") : [],
    freight_large_cents: typeof freight_large_cents === "number" ? freight_large_cents : 0,
    freight_small_cents: typeof freight_small_cents === "number" ? freight_small_cents : 0,
    ...(typeof zone_name === "string" ? { zone_name } : {}),
  };
}

function normalizeExtractedProgram(value: unknown): ExtractedProgram | null {
  if (!isJsonRecord(value)) return null;
  const { program_code, program_type, name, details, program_rules_notes, ...extra } = value;
  return {
    ...extra,
    program_code: typeof program_code === "string" ? program_code : "",
    ...(typeof program_type === "string" ? { program_type } : {}),
    ...(typeof name === "string" ? { name } : {}),
    ...(isJsonRecord(details) ? { details } : {}),
    ...(typeof program_rules_notes === "string" ? { program_rules_notes } : {}),
  };
}

function normalizePriceBookExtraction(parsed: unknown): PriceBookExtraction {
  const data = isJsonRecord(parsed) ? parsed : {};
  return {
    models: arrayField(data, "models").map(normalizeExtractedModel).filter(isDefined),
    attachments: arrayField(data, "attachments").map(normalizeExtractedAttachment).filter(isDefined),
    freight_zones: arrayField(data, "freight_zones").map(normalizeExtractedFreightZone).filter(isDefined),
    notes: stringArrayField(data, "notes"),
  };
}

function normalizeProgramsExtraction(parsed: unknown): ProgramsExtraction {
  const data = isJsonRecord(parsed) ? parsed : {};
  return {
    programs: arrayField(data, "programs").map(normalizeExtractedProgram).filter(isDefined),
    stacking_notes: stringArrayField(data, "stacking_notes"),
  };
}

async function callClaude(
  anthropic: Anthropic,
  systemPrompt: string,
  fileBuffer: ArrayBuffer,
  fileType: string,
  brandName: string,
  extractType: "price_book" | "retail_programs",
): Promise<{ rawResponse: string; parsed: unknown; inputTokens: number; outputTokens: number }> {
  let userContent: Anthropic.MessageParam["content"];
  const actionLabel = extractType === "price_book"
    ? "Extract all model pricing, attachments, and freight data"
    : "Extract all manufacturer incentive programs";

  if (fileType === "pdf") {
    const base64 = btoa(
      new Uint8Array(fileBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
    );
    const pdfContent = [
      {
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
      },
      {
        type: "text" as const,
        text: `${actionLabel} from this ${brandName} document. Return the JSON structure described in the system prompt.`,
      },
    ];
    userContent = pdfContent as unknown as Anthropic.MessageParam["content"];
  } else {
    // Excel/CSV: decode as text
    const text = new TextDecoder().decode(fileBuffer);
    userContent = `${actionLabel} from this ${brandName} document:\n\n${text}\n\nReturn the JSON structure described in the system prompt.`;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const rawResponse = response.content[0]?.type === "text" ? response.content[0].text : "";
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  // Parse — strip markdown fences if Claude added them despite instructions
  const jsonText = rawResponse.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(jsonText);

  return { rawResponse, parsed, inputTokens, outputTokens };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireServiceUser(req.headers.get("authorization"), origin);
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  // Restrict to admin/manager/owner (price sheets are not rep-facing)
  if (!["admin", "manager", "owner"].includes(auth.role)) {
    return safeJsonError("Price sheet extraction requires admin, manager, or owner role", 403, origin);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let priceSheetId: string;
  try {
    const body = await req.json();
    priceSheetId = isJsonRecord(body) && typeof body.priceSheetId === "string" ? body.priceSheetId : "";
    if (!priceSheetId) throw new Error("priceSheetId required");
  } catch (e: unknown) {
    return safeJsonError(`Invalid request body: ${errorMessage(e)}`, 400, origin);
  }

  // ── Load price sheet record ───────────────────────────────────────────────
  const { data: sheet, error: sheetErr } = await supabase
    .from("qb_price_sheets")
    .select("id, brand_id, file_url, file_type, sheet_type, status, workspace_id")
    .eq("id", priceSheetId)
    .single();

  if (sheetErr || !sheet) {
    return safeJsonError(`Price sheet not found: ${priceSheetId}`, 404, origin);
  }

  if (sheet.status === "extracting") {
    return safeJsonError("Extraction already in progress for this sheet", 409, origin);
  }

  // Load brand name for the prompt
  const { data: brand } = await supabase
    .from("qb_brands")
    .select("id, name")
    .eq("id", sheet.brand_id)
    .single();

  const brandName = brand?.name ?? "Unknown Brand";

  // Mark as extracting
  await supabase
    .from("qb_price_sheets")
    .update({ status: "extracting" })
    .eq("id", priceSheetId);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const pricingClient = serviceClient as unknown as Parameters<typeof detectModelAction>[2];

  // ── Download file from Storage ────────────────────────────────────────────
  // file_url is like: price-sheets/asv/2026-q1/file.pdf
  // Extract path after bucket name
  const bucketName = "price-sheets";
  const filePath = sheet.file_url.replace(new RegExp(`^.*/${bucketName}/`), "");

  const { data: fileData, error: dlErr } = await serviceClient.storage
    .from(bucketName)
    .download(filePath);

  if (dlErr || !fileData) {
    await supabase
      .from("qb_price_sheets")
      .update({
        status: "rejected",
        extraction_metadata: { error: `Download failed: ${dlErr?.message}` },
      })
      .eq("id", priceSheetId);
    await emitAdminFlare(serviceClient, {
      source: "extract-price-sheet",
      priceSheetId,
      brandId: sheet.brand_id,
      phase: "download",
      message: `Failed to download file: ${dlErr?.message ?? "unknown"}`,
      extra: { file_url: sheet.file_url },
    });
    return safeJsonError(`Failed to download file: ${dlErr?.message}`, 500, origin);
  }

  const fileBuffer = await fileData.arrayBuffer();
  const fileType = fileTypeFromUrl(sheet.file_url);

  // ── Init Anthropic ────────────────────────────────────────────────────────
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    await supabase
      .from("qb_price_sheets")
      .update({ status: "rejected", extraction_metadata: { error: "ANTHROPIC_API_KEY not configured" } })
      .eq("id", priceSheetId);
    await emitAdminFlare(serviceClient, {
      source: "extract-price-sheet",
      priceSheetId,
      brandId: sheet.brand_id,
      phase: "extract",
      message: "ANTHROPIC_API_KEY not configured in edge function env",
    });
    return safeJsonError("ANTHROPIC_API_KEY not configured", 500, origin);
  }
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // ── Extraction pass(es) ────────────────────────────────────────────────────
  const sheetType = sheet.sheet_type ?? "price_book";
  const passes: Array<"price_book" | "retail_programs"> =
    sheetType === "both"
      ? ["price_book", "retail_programs"]
      : sheetType === "retail_programs"
      ? ["retail_programs"]
      : ["price_book"];

  let totalItemsWritten = 0;
  let totalProgramsWritten = 0;
  const extractionSummary: Record<string, unknown>[] = [];

  for (const passType of passes) {
    const systemPrompt = passType === "retail_programs" ? PROGRAMS_SYSTEM : PRICE_BOOK_SYSTEM;

    // First attempt
    let callResult: Awaited<ReturnType<typeof callClaude>>;
    try {
      callResult = await callClaude(anthropic, systemPrompt, fileBuffer, fileType, brandName, passType);
    } catch (parseErr: unknown) {
      // Retry once with a stricter prompt
      console.warn(`[extract-price-sheet] First parse failed (${passType}), retrying:`, errorMessage(parseErr));
      try {
        callResult = await callClaude(
          anthropic,
          systemPrompt + "\n\nCRITICAL: Your previous response could not be parsed as JSON. Return ONLY valid JSON, nothing else.",
          fileBuffer,
          fileType,
          brandName,
          passType,
        );
      } catch (retryErr: unknown) {
        const retryMessage = errorMessage(retryErr);
        const rawResponse = errorRawResponse(retryErr);
        await supabase
          .from("qb_price_sheets")
          .update({
            status: "rejected",
            extraction_metadata: {
              error: `JSON parse failed after retry: ${retryMessage}`,
              passType,
              rawResponse: rawResponse ?? null,
            },
          })
          .eq("id", priceSheetId);
        await emitAdminFlare(serviceClient, {
          source: "extract-price-sheet",
          priceSheetId,
          brandId: sheet.brand_id,
          phase: "parse",
          message: `JSON parse failed after retry: ${retryMessage}`,
          extra: { passType, rawResponseTruncated: String(rawResponse ?? "").slice(0, 500) },
        });
        return safeJsonError(`Extraction failed: could not parse Claude response as JSON`, 422, origin);
      }
    }

    const { rawResponse, parsed, inputTokens, outputTokens } = callResult;
    const perItemMeta = { raw_response: rawResponse, model: "claude-sonnet-4-6", input_tokens: inputTokens, output_tokens: outputTokens };

    if (passType === "price_book") {
      const data = normalizePriceBookExtraction(parsed);

      // Models
      for (const item of data.models) {
        const actionResult = await detectModelAction(item, sheet.brand_id, pricingClient);
        await serviceClient.from("qb_price_sheet_items").insert({
          workspace_id: sheet.workspace_id as string,
          price_sheet_id: priceSheetId,
          item_type: "model",
          extracted: item,
          proposed_model_id: actionResult.existingId ?? null,
          action: actionResult.action,
          confidence: actionResult.confidence,
          diff: actionResult.changes ?? null,
          extraction_metadata: { ...perItemMeta, parsed: item },
          review_status: actionResult.action === "no_change" ? "approved" : "pending",
        });
        totalItemsWritten++;
      }

      // Attachments
      for (const item of data.attachments) {
        const actionResult = await detectAttachmentAction(item, sheet.brand_id, pricingClient);
        await serviceClient.from("qb_price_sheet_items").insert({
          workspace_id: sheet.workspace_id as string,
          price_sheet_id: priceSheetId,
          item_type: "attachment",
          extracted: item,
          proposed_attachment_id: actionResult.existingId ?? null,
          action: actionResult.action,
          confidence: actionResult.confidence,
          diff: actionResult.changes ?? null,
          extraction_metadata: { ...perItemMeta, parsed: item },
          review_status: actionResult.action === "no_change" ? "approved" : "pending",
        });
        totalItemsWritten++;
      }

      // Freight zones
      for (const item of data.freight_zones) {
        const actionResult = await detectFreightZoneAction(item, sheet.brand_id, pricingClient);
        await serviceClient.from("qb_price_sheet_items").insert({
          workspace_id: sheet.workspace_id as string,
          price_sheet_id: priceSheetId,
          item_type: "freight",
          extracted: item,
          action: actionResult.action,
          confidence: actionResult.confidence,
          diff: actionResult.changes ?? null,
          extraction_metadata: { ...perItemMeta, parsed: item },
          review_status: actionResult.action === "no_change" ? "approved" : "pending",
        });
        totalItemsWritten++;
      }

      // Notes
      for (const note of data.notes) {
        await serviceClient.from("qb_price_sheet_items").insert({
          workspace_id: sheet.workspace_id as string,
          price_sheet_id: priceSheetId,
          item_type: "note",
          extracted: { note },
          action: "skip",
          confidence: 1.0,
          extraction_metadata: { ...perItemMeta, parsed: { note } },
          review_status: "approved",
        });
        totalItemsWritten++;
      }

      extractionSummary.push({
        pass: "price_book",
        models: data.models.length,
        attachments: data.attachments.length,
        freight_zones: data.freight_zones.length,
        notes: data.notes.length,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });
    } else {
      // retail_programs pass
      const data = normalizeProgramsExtraction(parsed);

      for (const prog of data.programs) {
        // Check if program already exists
        const { data: existingProg } = await serviceClient
          .from("qb_programs")
          .select("id")
          .eq("brand_id", sheet.brand_id)
          .eq("program_code", prog.program_code)
          .maybeSingle();

        const action = existingProg ? "update" : "create";

        await serviceClient.from("qb_price_sheet_programs").insert({
          workspace_id: sheet.workspace_id as string,
          price_sheet_id: priceSheetId,
          program_code: prog.program_code,
          program_type: prog.program_type,
          extracted: prog,
          proposed_program_id: existingProg?.id ?? null,
          action,
          confidence: existingProg ? 0.9 : 1.0,
          extraction_metadata: { ...perItemMeta, parsed: prog },
          review_status: "pending",
        });
        totalProgramsWritten++;
      }

      extractionSummary.push({
        pass: "retail_programs",
        programs: data.programs.length,
        stacking_notes: data.stacking_notes.length,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });
    }
  }

  // ── Mark extracted ────────────────────────────────────────────────────────
  await supabase
    .from("qb_price_sheets")
    .update({
      status: "extracted",
      extraction_metadata: {
        passes: extractionSummary,
        total_items: totalItemsWritten,
        total_programs: totalProgramsWritten,
        extracted_at: new Date().toISOString(),
      },
    })
    .eq("id", priceSheetId);

  console.log(
    `[extract-price-sheet] Sheet ${priceSheetId}: ${totalItemsWritten} items, ${totalProgramsWritten} programs written.`,
  );

  return safeJsonOk(
    {
      priceSheetId,
      status: "extracted",
      itemsWritten: totalItemsWritten,
      programsWritten: totalProgramsWritten,
      summary: extractionSummary,
    },
    origin,
  );
});
