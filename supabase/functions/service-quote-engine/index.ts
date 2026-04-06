/**
 * Service Quote Engine — Generate, update, send, approve, reject service quotes.
 *
 * Auth: user JWT only
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { notifyAfterStageChange } from "../_shared/service-lifecycle-notify.ts";

interface QuoteRequest {
  action: string;
  job_id?: string;
  quote_id?: string;
  lines?: Array<{
    line_type: string;
    description: string;
    quantity: number;
    unit_price: number;
  }>;
  approval_type?: string;
  method?: string;
  approved_by?: string;
  signature_url?: string;
  notes?: string;
  labor_rate?: number;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const actorId = auth.userId;

    const body: QuoteRequest = await req.json();

    switch (body.action) {
      case "generate":
        return await handleGenerate(supabase, body, actorId, origin);
      case "update":
        return await handleUpdate(supabase, body, origin);
      case "send":
        return await handleSend(supabase, body, origin);
      case "approve":
        return await handleApprove(supabase, body, origin);
      case "reject":
        return await handleReject(supabase, body, origin);
      default:
        return safeJsonError(`Unknown action: ${body.action}`, 400, origin);
    }
  } catch (err) {
    console.error("service-quote-engine error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});

async function handleGenerate(
  supabase: SupabaseClient,
  body: QuoteRequest,
  actorId: string,
  origin: string | null,
) {
  if (!body.job_id) return safeJsonError("job_id required", 400, origin);

  const { data: job } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, haul_required, selected_job_code_id")
    .eq("id", body.job_id)
    .single();
  if (!job) return safeJsonError("Job not found", 404, origin);

  // Fetch job code for labor estimate
  let estimatedHours = 0;
  if (job.selected_job_code_id) {
    const { data: jc } = await supabase
      .from("job_codes")
      .select("shop_average_hours, manufacturer_estimated_hours")
      .eq("id", job.selected_job_code_id)
      .single();
    estimatedHours = jc?.shop_average_hours ?? jc?.manufacturer_estimated_hours ?? 0;
  }

  // Fetch parts requirements for parts lines
  const { data: parts } = await supabase
    .from("service_parts_requirements")
    .select("id, part_number, description, quantity, unit_cost")
    .eq("job_id", body.job_id)
    .neq("status", "cancelled");

  const laborRate = body.labor_rate ?? 150;
  const shopSuppliesRate = 0.08;

  const lines: Array<Record<string, unknown>> = [];
  let sortOrder = 0;

  // Labor line
  if (estimatedHours > 0) {
    lines.push({
      workspace_id: job.workspace_id,
      line_type: "labor",
      description: "Service Labor",
      quantity: estimatedHours,
      unit_price: laborRate,
      extended_price: Math.round(estimatedHours * laborRate * 100) / 100,
      sort_order: sortOrder++,
    });
  }

  // Parts lines
  for (const part of (parts ?? [])) {
    const unitCost = part.unit_cost ?? 0;
    lines.push({
      workspace_id: job.workspace_id,
      line_type: "part",
      description: `${part.part_number}${part.description ? ` — ${part.description}` : ""}`,
      quantity: part.quantity,
      unit_price: unitCost,
      extended_price: Math.round(part.quantity * unitCost * 100) / 100,
      part_requirement_id: part.id,
      sort_order: sortOrder++,
    });
  }

  // Haul line
  if (job.haul_required) {
    lines.push({
      workspace_id: job.workspace_id,
      line_type: "haul",
      description: "Equipment Transport",
      quantity: 1,
      unit_price: 500,
      extended_price: 500,
      sort_order: sortOrder++,
    });
  }

  const laborTotal = lines
    .filter((l) => l.line_type === "labor")
    .reduce((s, l) => s + (l.extended_price as number), 0);
  const partsTotal = lines
    .filter((l) => l.line_type === "part")
    .reduce((s, l) => s + (l.extended_price as number), 0);
  const haulTotal = lines
    .filter((l) => l.line_type === "haul")
    .reduce((s, l) => s + (l.extended_price as number), 0);
  const shopSupplies = Math.round(partsTotal * shopSuppliesRate * 100) / 100;
  const total = Math.round((laborTotal + partsTotal + haulTotal + shopSupplies) * 100) / 100;

  // Shop supplies line
  if (shopSupplies > 0) {
    lines.push({
      workspace_id: job.workspace_id,
      line_type: "shop_supply",
      description: "Shop Supplies (8%)",
      quantity: 1,
      unit_price: shopSupplies,
      extended_price: shopSupplies,
      sort_order: sortOrder++,
    });
  }

  // Supersede any existing draft quotes
  await supabase
    .from("service_quotes")
    .update({ status: "superseded" })
    .eq("job_id", body.job_id)
    .eq("status", "draft");

  // Get next version
  const { data: existing } = await supabase
    .from("service_quotes")
    .select("version")
    .eq("job_id", body.job_id)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = (existing?.[0]?.version ?? 0) + 1;

  // Insert quote
  const { data: quote, error: quoteErr } = await supabase
    .from("service_quotes")
    .insert({
      workspace_id: job.workspace_id,
      job_id: body.job_id,
      version: nextVersion,
      labor_total: laborTotal,
      parts_total: partsTotal,
      haul_total: haulTotal,
      shop_supplies: shopSupplies,
      total,
      status: "draft",
      notes: body.notes || null,
      created_by: actorId,
    })
    .select()
    .single();

  if (quoteErr) return safeJsonError(quoteErr.message, 400, origin);

  // Insert lines
  const lineInserts = lines.map((l) => ({ ...l, quote_id: quote.id }));
  if (lineInserts.length > 0) {
    await supabase.from("service_quote_lines").insert(lineInserts);
  }

  // Update job quote_total
  await supabase
    .from("service_jobs")
    .update({ quote_total: total })
    .eq("id", body.job_id);

  return safeJsonOk({ quote, lines: lineInserts }, origin, 201);
}

async function handleUpdate(
  supabase: SupabaseClient,
  body: QuoteRequest,
  origin: string | null,
) {
  if (!body.quote_id) return safeJsonError("quote_id required", 400, origin);
  if (!body.lines) return safeJsonError("lines required", 400, origin);

  const { data: quoteHeader, error: qhErr } = await supabase
    .from("service_quotes")
    .select("workspace_id")
    .eq("id", body.quote_id)
    .single();
  if (qhErr || !quoteHeader) return safeJsonError("Quote not found", 404, origin);
  const wsId = quoteHeader.workspace_id as string;

  // Delete old lines and re-insert
  await supabase.from("service_quote_lines").delete().eq("quote_id", body.quote_id);

  let total = 0;
  let laborTotal = 0;
  let partsTotal = 0;
  let haulTotal = 0;
  let shopSupplies = 0;
  const lineInserts = body.lines.map((l, i) => {
    const ext = Math.round(l.quantity * l.unit_price * 100) / 100;
    total += ext;
    if (l.line_type === "labor") laborTotal += ext;
    if (l.line_type === "part") partsTotal += ext;
    if (l.line_type === "haul") haulTotal += ext;
    if (l.line_type === "shop_supply") shopSupplies += ext;
    return {
      workspace_id: wsId,
      quote_id: body.quote_id,
      line_type: l.line_type,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      extended_price: ext,
      sort_order: i,
    };
  });

  await supabase.from("service_quote_lines").insert(lineInserts);
  const { data: quote } = await supabase
    .from("service_quotes")
    .update({ labor_total: laborTotal, parts_total: partsTotal, haul_total: haulTotal, shop_supplies: shopSupplies, total })
    .eq("id", body.quote_id)
    .select()
    .single();

  return safeJsonOk({ quote }, origin);
}

async function handleSend(
  supabase: SupabaseClient,
  body: QuoteRequest,
  origin: string | null,
) {
  if (!body.quote_id) return safeJsonError("quote_id required", 400, origin);

  const { data: quote, error } = await supabase
    .from("service_quotes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", body.quote_id)
    .select("*, job:service_jobs(id, current_stage)")
    .single();

  if (error) return safeJsonError(error.message, 400, origin);

  const stageNow = new Date().toISOString();

  // Transition job to quote_sent if at quote_drafted
  if (quote.job?.current_stage === "quote_drafted") {
    await supabase
      .from("service_jobs")
      .update({
        current_stage: "quote_sent",
        current_stage_entered_at: stageNow,
      })
      .eq("id", quote.job_id);

    const { data: fullJob } = await supabase
      .from("service_jobs")
      .select("*")
      .eq("id", quote.job_id)
      .single();
    if (fullJob) await notifyAfterStageChange(supabase, fullJob as Record<string, unknown>, "quote_sent");
  }

  return safeJsonOk({ quote }, origin);
}

async function handleApprove(
  supabase: SupabaseClient,
  body: QuoteRequest,
  origin: string | null,
) {
  if (!body.quote_id) return safeJsonError("quote_id required", 400, origin);

  const { data: quote, error } = await supabase
    .from("service_quotes")
    .update({ status: "approved" })
    .eq("id", body.quote_id)
    .select("*, job:service_jobs(id, current_stage)")
    .single();

  if (error) return safeJsonError(error.message, 400, origin);

  const ws = quote.workspace_id as string;

  // Record approval
  await supabase.from("service_quote_approvals").insert({
    workspace_id: ws,
    quote_id: body.quote_id,
    approved_by: body.approved_by || "customer",
    approval_type: body.approval_type || "customer",
    method: body.method || "phone",
    signature_url: body.signature_url || null,
    notes: body.notes || null,
  });

  const stageNow = new Date().toISOString();

  // Transition job to approved if at quote_sent
  if (quote.job?.current_stage === "quote_sent") {
    await supabase
      .from("service_jobs")
      .update({
        current_stage: "approved",
        current_stage_entered_at: stageNow,
      })
      .eq("id", quote.job_id);

    const { data: fullJob } = await supabase
      .from("service_jobs")
      .select("*")
      .eq("id", quote.job_id)
      .single();
    if (fullJob) await notifyAfterStageChange(supabase, fullJob as Record<string, unknown>, "approved");
  }

  return safeJsonOk({ quote }, origin);
}

async function handleReject(
  supabase: SupabaseClient,
  body: QuoteRequest,
  origin: string | null,
) {
  if (!body.quote_id) return safeJsonError("quote_id required", 400, origin);

  const { data: quote, error } = await supabase
    .from("service_quotes")
    .update({ status: "rejected" })
    .eq("id", body.quote_id)
    .select()
    .single();

  if (error) return safeJsonError(error.message, 400, origin);

  return safeJsonOk({ quote }, origin);
}
