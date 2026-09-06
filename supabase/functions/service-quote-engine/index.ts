/**
 * Service Quote Engine — Generate, update, send, approve, reject service quotes.
 *
 * Auth: user JWT only
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  requireServiceUser,
  SERVICE_QUOTE_ROLES,
} from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonErrorWithFields,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { notifyAfterStageChange } from "../_shared/service-lifecycle-notify.ts";
import {
  normalizeMileageMiles,
  normalizeServiceMileageSource,
  serviceMileageSourceLabel,
} from "../_shared/service-mileage-source.ts";
import {
  deriveWorkOrderStatus,
  evaluateLaborMargin,
  type LaborMarginEvaluation,
  normalizeServiceEquipmentClass,
  resolveLaborCostRate,
  resolveLaborRate,
  selectApplicableLaborPricingRule,
  type ServiceLaborPricingRule,
} from "../_shared/service-labor-pricing.ts";
import {
  evaluateScopeIncrease,
  normalizeEstimateApprovalKind,
} from "../_shared/service-estimate-authorization.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
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
  approval_kind?: string;
  method?: string;
  approved_by?: string;
  signature_url?: string;
  notes?: string;
  labor_rate?: number;
  labor_type_code?: string;
  premium_code?: string;
  customer_group_label?: string;
  equipment_class_code?: string;
  field_mileage_miles?: number;
  field_mileage_source?: string;
  field_mileage_provider_trip_id?: string;
  field_mileage_metadata?: Record<string, unknown>;
}

type LaborCostContext = {
  rate: number;
  source:
    | "technician_profile"
    | "pricing_rule"
    | "branch_default"
    | "target_margin_fallback";
};

type MarginSummary = {
  status: "not_applicable" | LaborMarginEvaluation["status"];
  warnings: string[];
  floor_blocked: boolean;
  target_margin_pct: number | null;
  floor_margin_pct: number | null;
  worst_margin_pct: number | null;
};

function numericValue(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumericValue(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dollarsFromCents(value: unknown): number | null {
  const cents = nonNegativeNumericValue(value);
  return cents == null ? null : Math.round((cents / 100) * 100) / 100;
}

function formatHaulMiles(value: unknown): string | null {
  const miles = nonNegativeNumericValue(value);
  if (miles == null || miles === 0) return null;
  return `${Math.round(miles * 100) / 100} round-trip mi`;
}

function resolveFieldMileage(input: {
  body: QuoteRequest;
  job: Record<string, unknown>;
}): {
  miles: number | null;
  source: ReturnType<typeof normalizeServiceMileageSource>;
  sourceFrom: "request" | "job" | "none";
  providerTripId: string | null;
  metadata: Record<string, unknown>;
} {
  const requestMiles = normalizeMileageMiles(input.body.field_mileage_miles);
  const jobMiles = normalizeMileageMiles(input.job.field_mileage_miles);
  const miles = requestMiles ?? jobMiles;
  const sourceFrom = requestMiles != null ? "request" : jobMiles != null
    ? "job"
    : "none";
  const source = normalizeServiceMileageSource(
    requestMiles != null
      ? input.body.field_mileage_source
      : input.job.field_mileage_source,
    "manual",
  );
  const requestMetadata = typeof input.body.field_mileage_metadata ===
      "object" && input.body.field_mileage_metadata !== null
    ? input.body.field_mileage_metadata
    : {};
  const jobMetadata = typeof input.job.field_mileage_metadata === "object" &&
      input.job.field_mileage_metadata !== null
    ? input.job.field_mileage_metadata as Record<string, unknown>
    : {};

  return {
    miles,
    source: miles == null ? "none" : source,
    sourceFrom,
    providerTripId: typeof input.body.field_mileage_provider_trip_id ===
        "string" && input.body.field_mileage_provider_trip_id.trim()
      ? input.body.field_mileage_provider_trip_id.trim()
      : typeof input.job.field_mileage_provider_trip_id === "string" &&
          input.job.field_mileage_provider_trip_id.trim()
      ? input.job.field_mileage_provider_trip_id.trim()
      : null,
    metadata: {
      ...jobMetadata,
      ...requestMetadata,
    },
  };
}

function statusRank(status: MarginSummary["status"]): number {
  switch (status) {
    case "blocked_below_floor":
      return 4;
    case "near_floor":
      return 3;
    case "below_target":
      return 2;
    case "target_met":
      return 1;
    case "not_applicable":
      return 0;
  }
}

function summarizeMarginEvaluations(
  evaluations: LaborMarginEvaluation[],
): MarginSummary {
  if (evaluations.length === 0) {
    return {
      status: "not_applicable",
      warnings: [],
      floor_blocked: false,
      target_margin_pct: null,
      floor_margin_pct: null,
      worst_margin_pct: null,
    };
  }

  const worst = [...evaluations].sort((a, b) => a.marginPct - b.marginPct)[0];
  const status = evaluations
    .map((evaluation) => evaluation.status)
    .sort((a, b) => statusRank(b) - statusRank(a))[0];
  return {
    status,
    warnings: evaluations.map((evaluation) => evaluation.warning).filter((
      warning,
    ): warning is string => Boolean(warning)),
    floor_blocked: evaluations.some((evaluation) => evaluation.floorBlocked),
    target_margin_pct: worst.targetMarginPct,
    floor_margin_pct: worst.floorMarginPct,
    worst_margin_pct: worst.marginPct,
  };
}

function marginFields(
  evaluation: LaborMarginEvaluation,
  cost: LaborCostContext,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return {
    labor_cost_rate: cost.rate,
    margin_cost_basis: evaluation.cost,
    margin_amount: evaluation.marginAmount,
    margin_pct: evaluation.marginPct,
    margin_status: evaluation.status,
    margin_warning: evaluation.warning,
    margin_floor_blocked: evaluation.floorBlocked,
    margin_metadata: {
      target_margin_pct: evaluation.targetMarginPct,
      floor_margin_pct: evaluation.floorMarginPct,
      labor_cost_source: cost.source,
      ...metadata,
    },
  };
}

async function resolveTechnicianLaborCostRate(
  supabase: SupabaseClient,
  workspaceId: string,
  technicianUserId: string | null | undefined,
): Promise<number | null> {
  if (!technicianUserId) return null;
  const { data } = await supabase
    .from("technician_profiles")
    .select("work_order_cost_per_hour_cents")
    .eq("workspace_id", workspaceId)
    .eq("user_id", technicianUserId)
    .maybeSingle();
  const cents = numericValue(data?.work_order_cost_per_hour_cents);
  return cents == null ? null : Math.round((cents / 100) * 100) / 100;
}

function resolveLaborCostContext(input: {
  technicianCostRate?: number | null;
  selectedRule: ServiceLaborPricingRule | null;
  branchDefaultCostRate?: number | null;
  laborRate: number;
}): LaborCostContext {
  const technician = numericValue(input.technicianCostRate);
  if (technician != null) {
    return { rate: technician, source: "technician_profile" };
  }

  const rule = numericValue(input.selectedRule?.labor_cost_rate);
  if (rule != null) return { rate: rule, source: "pricing_rule" };

  const branch = numericValue(input.branchDefaultCostRate);
  if (branch != null) return { rate: branch, source: "branch_default" };

  return {
    rate: resolveLaborCostRate({
      rule: input.selectedRule,
      laborRate: input.laborRate,
      targetMarginPct: input.selectedRule?.target_margin_pct,
    }),
    source: "target_margin_fallback",
  };
}

async function resolveJobEquipmentClass(
  supabase: SupabaseClient,
  job: Record<string, unknown>,
  explicitEquipmentClass: string | null | undefined,
): Promise<{ equipmentClassCode: string | null; source: string }> {
  const explicit = normalizeServiceEquipmentClass(explicitEquipmentClass);
  if (explicit) return { equipmentClassCode: explicit, source: "request" };

  const machineId = job.machine_id as string | null | undefined;
  if (!machineId) return { equipmentClassCode: null, source: "none" };

  const { data: machine } = await supabase
    .from("crm_equipment")
    .select("category, make, model, name, metadata")
    .eq("id", machineId)
    .maybeSingle();

  const metadata = (machine?.metadata ?? {}) as Record<string, unknown>;
  const hints = [
    metadata.service_equipment_class,
    metadata.equipment_class,
    metadata.class_code,
    machine?.category,
    machine?.name,
    [machine?.make, machine?.model].filter(Boolean).join(" "),
  ];
  for (const hint of hints) {
    if (typeof hint !== "string") continue;
    const normalized = normalizeServiceEquipmentClass(hint);
    if (normalized) {
      return { equipmentClassCode: normalized, source: "crm_equipment" };
    }
  }
  return { equipmentClassCode: null, source: "none" };
}

function marginFloorResponse(
  summary: MarginSummary,
  origin: string | null,
  extra: Record<string, unknown>,
): Response {
  return safeJsonErrorWithFields(
    "Service labor margin is below the 35% hard floor",
    422,
    origin,
    { margin_guardrail: summary, ...extra },
  );
}

function estimateReauthorizationUpdate(
  job: Record<string, unknown> | null | undefined,
  proposedTotal: number,
): Record<string, unknown> | null {
  if (!job || job.estimate_authorization_required !== true) return null;

  const scope = evaluateScopeIncrease({
    approvedAmount: job.approved_estimate_amount,
    proposedAmount: proposedTotal,
    thresholdPct: job.estimate_reauth_threshold_pct,
  });

  if (scope.approvedAmount == null) return null;

  if (scope.requiresReauthorization) {
    return {
      estimate_authorization_status: "reauthorization_required",
      estimate_reauthorization_required_at: new Date().toISOString(),
      estimate_reauthorization_reason: `Current estimate $${
        proposedTotal.toFixed(2)
      } exceeds approved estimate $${
        scope.approvedAmount.toFixed(2)
      } by more than ${scope.thresholdPct}%.`,
    };
  }

  if (job.estimate_authorization_status === "reauthorization_required") {
    return {
      estimate_authorization_status: "approved",
      estimate_reauthorization_required_at: null,
      estimate_reauthorization_reason: null,
    };
  }

  return null;
}

async function updateJobQuoteTotalAndAuthorization(
  supabase: SupabaseClient,
  jobId: string,
  job: Record<string, unknown> | null | undefined,
  total: number,
): Promise<string | null> {
  const authUpdate = estimateReauthorizationUpdate(job, total) ?? {};
  const { error } = await supabase
    .from("service_jobs")
    .update({ quote_total: total, ...authUpdate })
    .eq("id", jobId);
  return error?.message ?? null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(
      req.headers.get("Authorization"),
      origin,
      SERVICE_QUOTE_ROLES,
    );
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
    captureEdgeException(err, { fn: "service-quote-engine", req });
    console.error("service-quote-engine error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError(
      "Internal server error",
      500,
      req.headers.get("Origin"),
    );
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
    .select(
      "id, workspace_id, haul_required, traffic_ticket_id, selected_job_code_id, branch_id, customer_id, status_flags, machine_id, shop_or_field, technician_id, estimate_authorization_required, estimate_authorization_status, approved_estimate_amount, estimate_reauth_threshold_pct, hour_meter_reading, odometer_miles, field_mileage_miles, field_mileage_source, field_mileage_provider_trip_id, field_mileage_metadata",
    )
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
    estimatedHours = jc?.shop_average_hours ??
      jc?.manufacturer_estimated_hours ?? 0;
  }

  // Fetch parts requirements for parts lines
  const { data: parts } = await supabase
    .from("service_parts_requirements")
    .select("id, part_number, description, quantity, unit_cost")
    .eq("job_id", body.job_id)
    .neq("status", "cancelled");

  const { data: branchConfig } = await supabase
    .from("service_branch_config")
    .select("default_labor_rate, default_labor_cost_rate")
    .eq("branch_id", job.branch_id)
    .maybeSingle();

  const { data: rules } = await supabase
    .from("service_labor_pricing_rules")
    .select(
      "id, rate_key, location_code, customer_id, customer_group_label, work_order_status, equipment_class_code, labor_type_code, premium_code, default_premium_code, pricing_code, pricing_value, field_mileage_rate, labor_cost_rate, target_margin_pct, floor_margin_pct, internal_discount_pct, effective_start_on, effective_end_on, active, created_at",
    )
    .eq("workspace_id", job.workspace_id);

  const workOrderStatus = deriveWorkOrderStatus(
    (job.status_flags as string[] | null) ?? [],
  );
  const equipmentClass = await resolveJobEquipmentClass(
    supabase,
    job as Record<string, unknown>,
    body.equipment_class_code ?? null,
  );
  const laborTypeCode = body.labor_type_code ??
    ((job.shop_or_field as string | null) === "field" ? "field" : null);
  const baseLaborRate = Number(branchConfig?.default_labor_rate ?? 150);
  const selectedRule = selectApplicableLaborPricingRule(
    (rules ?? []) as ServiceLaborPricingRule[],
    {
      locationCode: (job.branch_id as string | null) ?? null,
      customerId: (job.customer_id as string | null) ?? null,
      customerGroupLabel: body.customer_group_label ?? null,
      workOrderStatus,
      equipmentClassCode: equipmentClass.equipmentClassCode,
      laborTypeCode,
      premiumCode: body.premium_code ?? null,
    },
  );

  const laborRate = body.labor_rate ??
    resolveLaborRate(baseLaborRate, selectedRule, { workOrderStatus });
  const technicianCostRate = await resolveTechnicianLaborCostRate(
    supabase,
    job.workspace_id as string,
    job.technician_id as string | null,
  );
  const laborCost = resolveLaborCostContext({
    technicianCostRate,
    selectedRule,
    branchDefaultCostRate: Number(branchConfig?.default_labor_cost_rate ?? 0),
    laborRate,
  });
  const shopSuppliesRate = 0.08;
  const laborEvaluations: LaborMarginEvaluation[] = [];

  const lines: Array<Record<string, unknown>> = [];
  let sortOrder = 0;

  // Labor line
  if (estimatedHours > 0) {
    const laborMargin = evaluateLaborMargin({
      quantity: estimatedHours,
      unitPrice: laborRate,
      costRate: laborCost.rate,
      targetMarginPct: selectedRule?.target_margin_pct,
      floorMarginPct: selectedRule?.floor_margin_pct,
    });
    laborEvaluations.push(laborMargin);
    const marginSummary = summarizeMarginEvaluations(laborEvaluations);
    if (marginSummary.floor_blocked) {
      return marginFloorResponse(marginSummary, origin, {
        labor_rate: laborRate,
        labor_cost_rate: laborCost.rate,
        labor_rate_source: body.labor_rate != null
          ? "manual_override"
          : selectedRule?.rate_key ?? selectedRule?.id ?? "branch_default",
      });
    }
    lines.push({
      workspace_id: job.workspace_id,
      line_type: "labor",
      description: "Service Labor",
      quantity: estimatedHours,
      unit_price: laborRate,
      extended_price: Math.round(estimatedHours * laborRate * 100) / 100,
      ...marginFields(laborMargin, laborCost, {
        labor_rate_source: body.labor_rate != null
          ? "manual_override"
          : selectedRule?.rate_key ?? selectedRule?.id ?? "branch_default",
        equipment_class_code: equipmentClass.equipmentClassCode,
        equipment_class_source: equipmentClass.source,
        labor_type_code: laborTypeCode,
        work_order_status: workOrderStatus,
        field_mileage_rate: Number(selectedRule?.field_mileage_rate ?? 0),
        internal_discount_pct: workOrderStatus === "internal"
          ? Number(selectedRule?.internal_discount_pct ?? 10)
          : 0,
      }),
      sort_order: sortOrder++,
    });
  }

  const fieldMileage = resolveFieldMileage({
    body,
    job: job as Record<string, unknown>,
  });
  const fieldMileageRate = Number(selectedRule?.field_mileage_rate ?? 0);
  const isFieldService = (job.shop_or_field as string | null) === "field" ||
    laborTypeCode === "field";
  if (
    isFieldService && fieldMileage.miles != null && fieldMileageRate > 0
  ) {
    const extendedPrice = Math.round(
      fieldMileage.miles * fieldMileageRate * 100,
    ) / 100;
    const sourceLabel = serviceMileageSourceLabel(fieldMileage.source);
    lines.push({
      workspace_id: job.workspace_id,
      line_type: "optional",
      description: `Field Mileage - ${sourceLabel}`,
      quantity: fieldMileage.miles,
      unit_price: fieldMileageRate,
      extended_price: extendedPrice,
      margin_metadata: {
        ...fieldMileage.metadata,
        h15_gate: "reveal_gps_manual_fallback",
        mileage_source: fieldMileage.source,
        mileage_source_from: fieldMileage.sourceFrom,
        manual_fallback: fieldMileage.source === "manual",
        provider_trip_id: fieldMileage.providerTripId,
        odometer_miles: job.odometer_miles ?? null,
        hour_meter_reading: job.hour_meter_reading ?? null,
        field_mileage_rate: fieldMileageRate,
      },
      sort_order: sortOrder++,
    });
  }

  // Parts lines — N3.1: quote at parts_catalog RETAIL (list price, tier and
  // last-known fallbacks), not the requirement's unit_cost (usually unset,
  // which quoted parts at $0). unit_cost remains the last-resort fallback.
  const partNumbersForPricing = [...new Set((parts ?? []).map((p) => String(p.part_number ?? "").trim()).filter(Boolean))];
  const retailByPart = new Map<string, number>();
  if (partNumbersForPricing.length > 0) {
    const { data: catalogRows } = await supabase
      .from("parts_catalog")
      .select("part_number, list_price, pricing_level_1, last_known_price")
      .eq("workspace_id", job.workspace_id)
      .in("part_number", partNumbersForPricing);
    for (const row of catalogRows ?? []) {
      const pn = String(row.part_number ?? "").trim();
      const retail = Number(row.list_price ?? 0) || Number(row.pricing_level_1 ?? 0) || Number(row.last_known_price ?? 0);
      if (pn && retail > 0 && !retailByPart.has(pn)) retailByPart.set(pn, retail);
    }
  }

  for (const part of (parts ?? [])) {
    const retail = retailByPart.get(String(part.part_number ?? "").trim());
    const unitPrice = retail ?? (part.unit_cost ?? 0);
    lines.push({
      workspace_id: job.workspace_id,
      line_type: "part",
      description: `${part.part_number}${
        part.description ? ` — ${part.description}` : ""
      }`,
      quantity: part.quantity,
      unit_price: unitPrice,
      extended_price: Math.round(part.quantity * unitPrice * 100) / 100,
      part_requirement_id: part.id,
      sort_order: sortOrder++,
    });
  }

  // Haul line
  if (job.haul_required) {
    let haulTicket: Record<string, unknown> | null = null;
    if (job.traffic_ticket_id) {
      const { data } = await supabase
        .from("traffic_tickets")
        .select(
          "id, truck_class, rate_type, mileage_one_way, round_trip_miles, haul_total_cents, haul_cost_cents, rate_calc",
        )
        .eq("id", job.traffic_ticket_id)
        .maybeSingle();
      haulTicket = (data ?? null) as Record<string, unknown> | null;
    }
    const ticketTotal = dollarsFromCents(haulTicket?.haul_total_cents);
    if (ticketTotal == null) return safeJsonError("Hauling needs a confirmed truck-class rate and transport request before a quote can be generated. No default haul charge was added.", 409, origin);
    const haulAmount = ticketTotal;
    const roundTripMiles = nonNegativeNumericValue(
      haulTicket?.round_trip_miles,
    );
    const quantity = roundTripMiles && roundTripMiles > 0
      ? Math.round(roundTripMiles * 100) / 100
      : 1;
    const unitPrice = quantity > 0
      ? Math.round((haulAmount / quantity) * 100) / 100
      : haulAmount;
    const truckClass = typeof haulTicket?.truck_class === "string" &&
        haulTicket.truck_class.trim()
      ? haulTicket.truck_class.trim()
      : "standard";
    const mileageLabel = formatHaulMiles(haulTicket?.round_trip_miles);
    lines.push({
      workspace_id: job.workspace_id,
      line_type: "haul",
      description: [
        `Equipment Transport - ${truckClass}`,
        mileageLabel,
      ].filter(Boolean).join(", "),
      quantity,
      unit_price: unitPrice,
      extended_price: haulAmount,
      margin_metadata: {
        h7_gate: "hauling_transport_dispatch",
        source: "traffic_ticket_rate_calc",
        traffic_ticket_id: haulTicket?.id ?? null,
        rate_type: haulTicket?.rate_type ?? null,
        truck_class: haulTicket?.truck_class ?? null,
        mileage_one_way: haulTicket?.mileage_one_way ?? null,
        round_trip_miles: haulTicket?.round_trip_miles ?? null,
        haul_total_cents: haulTicket?.haul_total_cents ?? null,
        haul_cost_cents: haulTicket?.haul_cost_cents ?? null,
        rate_calc: haulTicket?.rate_calc ?? null,
      },
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
  const optionalTotal = lines
    .filter((l) => l.line_type === "optional")
    .reduce((s, l) => s + (l.extended_price as number), 0);
  const shopSupplies = Math.round(partsTotal * shopSuppliesRate * 100) / 100;
  const total =
    Math.round(
      (laborTotal + partsTotal + haulTotal + optionalTotal + shopSupplies) *
        100,
    ) /
    100;

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

  const marginSummary = summarizeMarginEvaluations(laborEvaluations);

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
      margin_guardrail_status: marginSummary.status,
      margin_guardrail_summary: marginSummary,
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

  const jobUpdateError = await updateJobQuoteTotalAndAuthorization(
    supabase,
    body.job_id,
    job as Record<string, unknown>,
    total,
  );
  if (jobUpdateError) return safeJsonError(jobUpdateError, 400, origin);

  return safeJsonOk(
    {
      quote,
      lines: lineInserts,
      labor_rate: laborRate,
      labor_rate_source: body.labor_rate != null
        ? "manual_override"
        : selectedRule?.rate_key ?? selectedRule?.id ?? "branch_default",
      labor_cost_rate: laborCost.rate,
      labor_cost_source: laborCost.source,
      equipment_class_code: equipmentClass.equipmentClassCode,
      field_mileage_miles: fieldMileage.miles,
      field_mileage_source: fieldMileage.source,
      field_mileage_rate: Number(selectedRule?.field_mileage_rate ?? 0),
      margin_guardrail: marginSummary,
    },
    origin,
    201,
  );
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
    .select("workspace_id, job_id")
    .eq("id", body.quote_id)
    .single();
  if (qhErr || !quoteHeader) {
    return safeJsonError("Quote not found", 404, origin);
  }
  const wsId = quoteHeader.workspace_id as string;

  const { data: job } = await supabase
    .from("service_jobs")
    .select(
      "id, workspace_id, branch_id, customer_id, status_flags, machine_id, shop_or_field, technician_id, estimate_authorization_required, estimate_authorization_status, approved_estimate_amount, estimate_reauth_threshold_pct, hour_meter_reading, odometer_miles, field_mileage_miles, field_mileage_source, field_mileage_provider_trip_id, field_mileage_metadata",
    )
    .eq("id", quoteHeader.job_id)
    .maybeSingle();

  const { data: branchConfig } = await supabase
    .from("service_branch_config")
    .select("default_labor_rate, default_labor_cost_rate")
    .eq("branch_id", job?.branch_id ?? null)
    .maybeSingle();

  const { data: rules } = await supabase
    .from("service_labor_pricing_rules")
    .select(
      "id, rate_key, location_code, customer_id, customer_group_label, work_order_status, equipment_class_code, labor_type_code, premium_code, default_premium_code, pricing_code, pricing_value, field_mileage_rate, labor_cost_rate, target_margin_pct, floor_margin_pct, internal_discount_pct, effective_start_on, effective_end_on, active, created_at",
    )
    .eq("workspace_id", wsId);

  const workOrderStatus = deriveWorkOrderStatus(
    (job?.status_flags as string[] | null) ?? [],
  );
  const equipmentClass = job
    ? await resolveJobEquipmentClass(
      supabase,
      job as Record<string, unknown>,
      body.equipment_class_code ?? null,
    )
    : {
      equipmentClassCode: normalizeServiceEquipmentClass(
        body.equipment_class_code,
      ),
      source: "request",
    };
  const laborTypeCode = body.labor_type_code ??
    ((job?.shop_or_field as string | null) === "field" ? "field" : null);
  const selectedRule = selectApplicableLaborPricingRule(
    (rules ?? []) as ServiceLaborPricingRule[],
    {
      locationCode: (job?.branch_id as string | null) ?? null,
      customerId: (job?.customer_id as string | null) ?? null,
      customerGroupLabel: body.customer_group_label ?? null,
      workOrderStatus,
      equipmentClassCode: equipmentClass.equipmentClassCode,
      laborTypeCode,
      premiumCode: body.premium_code ?? null,
    },
  );
  const technicianCostRate = await resolveTechnicianLaborCostRate(
    supabase,
    wsId,
    job?.technician_id as string | null,
  );

  let total = 0;
  let laborTotal = 0;
  let partsTotal = 0;
  let haulTotal = 0;
  let shopSupplies = 0;
  const laborEvaluations: LaborMarginEvaluation[] = [];
  const lineInserts: Array<Record<string, unknown>> = [];

  for (let i = 0; i < body.lines.length; i++) {
    const l = body.lines[i];
    const ext = Math.round(l.quantity * l.unit_price * 100) / 100;
    total += ext;
    if (l.line_type === "labor") laborTotal += ext;
    if (l.line_type === "part") partsTotal += ext;
    if (l.line_type === "haul") haulTotal += ext;
    if (l.line_type === "shop_supply") shopSupplies += ext;

    const lineInsert: Record<string, unknown> = {
      workspace_id: wsId,
      quote_id: body.quote_id,
      line_type: l.line_type,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      extended_price: ext,
      sort_order: i,
    };

    if (l.line_type === "labor") {
      const laborCost = resolveLaborCostContext({
        technicianCostRate,
        selectedRule,
        branchDefaultCostRate: Number(
          branchConfig?.default_labor_cost_rate ?? 0,
        ),
        laborRate: l.unit_price,
      });
      const laborMargin = evaluateLaborMargin({
        quantity: l.quantity,
        unitPrice: l.unit_price,
        costRate: laborCost.rate,
        targetMarginPct: selectedRule?.target_margin_pct,
        floorMarginPct: selectedRule?.floor_margin_pct,
      });
      laborEvaluations.push(laborMargin);
      Object.assign(
        lineInsert,
        marginFields(laborMargin, laborCost, {
          labor_rate_source: "manual_update",
          equipment_class_code: equipmentClass.equipmentClassCode,
          equipment_class_source: equipmentClass.source,
          labor_type_code: laborTypeCode,
          work_order_status: workOrderStatus,
          field_mileage_rate: Number(selectedRule?.field_mileage_rate ?? 0),
        }),
      );
    }

    lineInserts.push(lineInsert);
  }

  const marginSummary = summarizeMarginEvaluations(laborEvaluations);
  if (marginSummary.floor_blocked) {
    return marginFloorResponse(marginSummary, origin, {
      quote_id: body.quote_id,
    });
  }

  // Delete old lines and re-insert only after the hard-floor check passes.
  await supabase.from("service_quote_lines").delete().eq(
    "quote_id",
    body.quote_id,
  );

  await supabase.from("service_quote_lines").insert(lineInserts);
  const { data: quote } = await supabase
    .from("service_quotes")
    .update({
      labor_total: laborTotal,
      parts_total: partsTotal,
      haul_total: haulTotal,
      shop_supplies: shopSupplies,
      total,
      margin_guardrail_status: marginSummary.status,
      margin_guardrail_summary: marginSummary,
    })
    .eq("id", body.quote_id)
    .select()
    .single();

  const jobUpdateError = await updateJobQuoteTotalAndAuthorization(
    supabase,
    quoteHeader.job_id as string,
    job as Record<string, unknown> | null,
    Math.round(total * 100) / 100,
  );
  if (jobUpdateError) return safeJsonError(jobUpdateError, 400, origin);

  return safeJsonOk({ quote, margin_guardrail: marginSummary }, origin);
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
    if (fullJob) {
      await notifyAfterStageChange(
        supabase,
        fullJob as Record<string, unknown>,
        "quote_sent",
      );
    }
  }

  return safeJsonOk({ quote }, origin);
}

async function handleApprove(
  supabase: SupabaseClient,
  body: QuoteRequest,
  origin: string | null,
) {
  if (!body.quote_id) return safeJsonError("quote_id required", 400, origin);

  const { data: quoteBefore, error: fetchError } = await supabase
    .from("service_quotes")
    .select(
      "*, job:service_jobs(id, current_stage, estimate_authorization_required, estimate_authorization_status, approved_estimate_amount, estimate_reauth_threshold_pct)",
    )
    .eq("id", body.quote_id)
    .single();

  if (fetchError || !quoteBefore) {
    return safeJsonError(fetchError?.message ?? "Quote not found", 404, origin);
  }

  const job = quoteBefore.job as Record<string, unknown> | null;
  const quoteTotal = Math.round(Number(quoteBefore.total ?? 0) * 100) / 100;
  const scope = evaluateScopeIncrease({
    approvedAmount: job?.approved_estimate_amount,
    proposedAmount: quoteTotal,
    thresholdPct: job?.estimate_reauth_threshold_pct,
  });
  const requestedApprovalKind = normalizeEstimateApprovalKind(
    body.approval_kind,
  );

  if (body.approval_kind != null && requestedApprovalKind == null) {
    return safeJsonErrorWithFields(
      "approval_kind must be initial_estimate or scope_increase_reauthorization",
      422,
      origin,
      { code: "invalid_approval_kind" },
    );
  }

  if (
    scope.requiresReauthorization &&
    requestedApprovalKind !== "scope_increase_reauthorization"
  ) {
    return safeJsonErrorWithFields(
      "Scope increase exceeds the approved estimate by more than 10%; document customer re-authorization before approving this estimate.",
      422,
      origin,
      {
        code: "estimate_reauthorization_required",
        approved_amount: scope.approvedAmount,
        proposed_amount: scope.proposedAmount,
        threshold_amount: scope.thresholdAmount,
        threshold_pct: scope.thresholdPct,
        scope_increase_pct: scope.scopeIncreasePct,
        required_approval_kind: "scope_increase_reauthorization",
      },
    );
  }

  const approvalKind = requestedApprovalKind ?? "initial_estimate";
  const { data: quote, error } = await supabase
    .from("service_quotes")
    .update({ status: "approved" })
    .eq("id", body.quote_id)
    .select(
      "*, job:service_jobs(id, current_stage, estimate_authorization_required)",
    )
    .single();

  if (error) return safeJsonError(error.message, 400, origin);

  const ws = quote.workspace_id as string;

  const { data: approval, error: approvalError } = await supabase
    .from("service_quote_approvals")
    .insert({
      workspace_id: ws,
      quote_id: body.quote_id,
      approved_by: body.approved_by || "customer",
      approval_type: body.approval_type || "customer",
      approval_kind: approvalKind,
      method: body.method || "phone",
      signature_url: body.signature_url || null,
      notes: body.notes || null,
      approved_amount: quoteTotal,
      scope_increase_pct: scope.scopeIncreasePct,
      approval_metadata: {
        h3_gate: "estimate_authorization",
        previous_approved_amount: scope.approvedAmount,
        threshold_amount: scope.thresholdAmount,
        threshold_pct: scope.thresholdPct,
        portal_esign: "future_path_not_built_in_h3",
      },
    })
    .select("id")
    .single();

  if (approvalError) return safeJsonError(approvalError.message, 400, origin);

  const authorizationRequired = job?.estimate_authorization_required === false
    ? false
    : true;
  const stageNow = new Date().toISOString();
  const authorizationUpdate: Record<string, unknown> = authorizationRequired
    ? {
      quote_total: quoteTotal,
      estimate_authorization_required: true,
      estimate_authorization_status: "approved",
      approved_estimate_quote_id: body.quote_id,
      approved_estimate_approval_id: approval?.id ?? null,
      approved_estimate_amount: quoteTotal,
      approved_estimate_authorized_at: stageNow,
      estimate_reauthorization_required_at: null,
      estimate_reauthorization_reason: null,
    }
    : {
      quote_total: quoteTotal,
      estimate_authorization_required: false,
      estimate_authorization_status: "not_required",
      approved_estimate_quote_id: body.quote_id,
      approved_estimate_approval_id: approval?.id ?? null,
      approved_estimate_amount: quoteTotal,
      approved_estimate_authorized_at: stageNow,
      estimate_reauthorization_required_at: null,
      estimate_reauthorization_reason: null,
    };

  const { error: authorizationUpdateError } = await supabase
    .from("service_jobs")
    .update(authorizationUpdate)
    .eq("id", quote.job_id);
  if (authorizationUpdateError) {
    return safeJsonError(authorizationUpdateError.message, 400, origin);
  }

  // Transition job to approved if at quote_sent
  if (quoteBefore.job?.current_stage === "quote_sent") {
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
    if (fullJob) {
      await notifyAfterStageChange(
        supabase,
        fullJob as Record<string, unknown>,
        "approved",
      );
    }
  }

  return safeJsonOk({ quote, approval_kind: approvalKind }, origin);
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
