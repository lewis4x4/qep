export type ServiceLaborPricingRule = {
  id: string;
  rate_key?: string | null;
  location_code: string | null;
  customer_id: string | null;
  customer_group_label: string | null;
  work_order_status: "all" | "customer" | "warranty" | "internal";
  equipment_class_code?: string | null;
  labor_type_code: string | null;
  premium_code: string | null;
  default_premium_code: string | null;
  pricing_code:
    | "fixed_price"
    | "list_plus_pct"
    | "list_minus_pct"
    | "cost_plus_pct"
    | "cost_minus_pct";
  pricing_value: number;
  field_mileage_rate?: number | null;
  labor_cost_rate?: number | null;
  target_margin_pct?: number | null;
  floor_margin_pct?: number | null;
  internal_discount_pct?: number | null;
  effective_start_on: string | null;
  effective_end_on: string | null;
  active: boolean;
  created_at?: string | null;
};

export type LaborPricingContext = {
  locationCode: string | null;
  customerId: string | null;
  customerGroupLabel?: string | null;
  workOrderStatus: "customer" | "warranty" | "internal";
  equipmentClassCode?: string | null;
  laborTypeCode?: string | null;
  premiumCode?: string | null;
  now?: Date;
};

export type LaborMarginEvaluation = {
  revenue: number;
  cost: number;
  marginAmount: number;
  marginPct: number;
  targetMarginPct: number;
  floorMarginPct: number;
  status: "target_met" | "below_target" | "near_floor" | "blocked_below_floor";
  warning: string | null;
  floorBlocked: boolean;
};

const DEFAULT_TARGET_MARGIN_PCT = 55;
const DEFAULT_FLOOR_MARGIN_PCT = 35;
const FLOOR_WARNING_BAND_PCT = 5;
const DEFAULT_INTERNAL_DISCOUNT_PCT = 10;

export function deriveWorkOrderStatus(
  statusFlags: string[] | null | undefined,
): "customer" | "warranty" | "internal" {
  const flags = statusFlags ?? [];
  if (flags.includes("internal")) return "internal";
  if (flags.includes("warranty_recall")) return "warranty";
  return "customer";
}

function normalizeCode(value: string | null | undefined): string | null {
  const normalized =
    value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
      /^_+|_+$/g,
      "",
    ) ?? "";
  return normalized.length > 0 ? normalized : null;
}

/**
 * Maps existing CRM equipment category/class/name hints into the H1 service
 * door-rate buckets. Unknown classes intentionally return null so branch/rule
 * defaults can still price the job without inventing a class.
 */
export function normalizeServiceEquipmentClass(
  input: string | null | undefined,
): string | null {
  const code = normalizeCode(input);
  if (!code) return null;

  if (code.includes("grapple")) return "grapple";
  if (code.includes("forestry") || code.includes("mulcher")) return "forestry";
  if (
    code.includes("compact") ||
    code.includes("skid_steer") ||
    code.includes("skidsteer") ||
    code.includes("mini_excavator") ||
    code.includes("compact_track_loader") ||
    code === "ctl"
  ) return "compact_construction";
  if (
    code.includes("large_construction") ||
    code.includes("construction") ||
    code.includes("excavator") ||
    code.includes("dozer") ||
    code.includes("loader") ||
    code.includes("backhoe") ||
    code.includes("crane") ||
    code.includes("telehandler")
  ) return "large_construction";
  if (code.includes("lube")) return "lube";
  if (code.includes("specialty")) return "specialty";

  return null;
}

function withinDateWindow(rule: ServiceLaborPricingRule, now: Date): boolean {
  const current = now.toISOString().slice(0, 10);
  if (rule.effective_start_on && rule.effective_start_on > current) {
    return false;
  }
  if (rule.effective_end_on && rule.effective_end_on < current) return false;
  return true;
}

function matchesOptional(
  expected: string | null | undefined,
  actual: string | null | undefined,
): boolean {
  const expectedCode = normalizeCode(expected);
  if (!expectedCode) return true;
  return expectedCode === normalizeCode(actual);
}

function scoreRule(
  rule: ServiceLaborPricingRule,
  ctx: LaborPricingContext,
): number {
  let score = 0;
  if (rule.customer_id && matchesOptional(rule.customer_id, ctx.customerId)) {
    score += 64;
  }
  if (
    rule.customer_group_label &&
    matchesOptional(rule.customer_group_label, ctx.customerGroupLabel ?? null)
  ) score += 32;
  if (
    rule.location_code && matchesOptional(rule.location_code, ctx.locationCode)
  ) {
    score += 16;
  }
  if (rule.work_order_status !== "all") score += 8;
  // Labor type intentionally outranks equipment class so field/lube/specialty
  // rates win over the underlying machine class when explicitly requested.
  if (rule.labor_type_code) score += 4;
  if (rule.equipment_class_code) score += 2;
  if (rule.premium_code) score += 1;
  return score;
}

export function selectApplicableLaborPricingRule(
  rules: ServiceLaborPricingRule[],
  ctx: LaborPricingContext,
): ServiceLaborPricingRule | null {
  const now = ctx.now ?? new Date();
  return rules
    .filter((rule) =>
      rule.active &&
      withinDateWindow(rule, now) &&
      matchesOptional(rule.location_code, ctx.locationCode) &&
      matchesOptional(rule.customer_id, ctx.customerId) &&
      matchesOptional(
        rule.customer_group_label,
        ctx.customerGroupLabel ?? null,
      ) &&
      (rule.work_order_status === "all" ||
        rule.work_order_status === ctx.workOrderStatus) &&
      matchesOptional(
        rule.equipment_class_code,
        ctx.equipmentClassCode ?? null,
      ) &&
      matchesOptional(rule.labor_type_code, ctx.laborTypeCode ?? null) &&
      matchesOptional(rule.premium_code, ctx.premiumCode ?? null)
    )
    .sort((a, b) => {
      const scoreDiff = scoreRule(b, ctx) - scoreRule(a, ctx);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime();
    })[0] ?? null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveLaborRate(
  baseRate: number,
  rule: ServiceLaborPricingRule | null,
  options: { workOrderStatus?: "customer" | "warranty" | "internal" } = {},
): number {
  const value = Number(rule?.pricing_value ?? 0);
  let resolved = baseRate;
  if (rule) {
    switch (rule.pricing_code) {
      case "fixed_price":
        resolved = value;
        break;
      case "list_plus_pct":
      case "cost_plus_pct":
        resolved = baseRate * (1 + value / 100);
        break;
      case "list_minus_pct":
      case "cost_minus_pct":
        resolved = baseRate * (1 - value / 100);
        break;
    }
  }

  if (
    options.workOrderStatus === "internal" &&
    rule?.work_order_status !== "internal"
  ) {
    const discountPct = Number(
      rule?.internal_discount_pct ?? DEFAULT_INTERNAL_DISCOUNT_PCT,
    );
    resolved = resolved * (1 - discountPct / 100);
  }

  return roundMoney(resolved);
}

export function resolveLaborCostRate(input: {
  technicianCostRate?: number | null;
  rule?: ServiceLaborPricingRule | null;
  branchDefaultCostRate?: number | null;
  laborRate: number;
  targetMarginPct?: number | null;
}): number {
  const technicianCostRate = Number(input.technicianCostRate ?? 0);
  if (technicianCostRate > 0) return roundMoney(technicianCostRate);

  const ruleCostRate = Number(input.rule?.labor_cost_rate ?? 0);
  if (ruleCostRate > 0) return roundMoney(ruleCostRate);

  const branchDefaultCostRate = Number(input.branchDefaultCostRate ?? 0);
  if (branchDefaultCostRate > 0) return roundMoney(branchDefaultCostRate);

  const targetMarginPct = Number(
    input.targetMarginPct ?? input.rule?.target_margin_pct ??
      DEFAULT_TARGET_MARGIN_PCT,
  );
  return roundMoney(input.laborRate * (1 - targetMarginPct / 100));
}

export function evaluateLaborMargin(input: {
  quantity: number;
  unitPrice: number;
  costRate: number;
  targetMarginPct?: number | null;
  floorMarginPct?: number | null;
}): LaborMarginEvaluation {
  const quantity = Number(input.quantity ?? 0);
  const unitPrice = Number(input.unitPrice ?? 0);
  const costRate = Number(input.costRate ?? 0);
  const targetMarginPct = Number(
    input.targetMarginPct ?? DEFAULT_TARGET_MARGIN_PCT,
  );
  const floorMarginPct = Number(
    input.floorMarginPct ?? DEFAULT_FLOOR_MARGIN_PCT,
  );
  const revenue = roundMoney(quantity * unitPrice);
  const cost = roundMoney(quantity * costRate);
  const marginAmount = roundMoney(revenue - cost);
  const marginPct = revenue > 0
    ? Math.round(((marginAmount / revenue) * 100) * 100) / 100
    : 0;

  let status: LaborMarginEvaluation["status"] = "target_met";
  let warning: string | null = null;
  if (marginPct < floorMarginPct) {
    status = "blocked_below_floor";
    warning = `Labor margin ${marginPct.toFixed(2)}% is below the ${
      floorMarginPct.toFixed(2)
    }% hard floor.`;
  } else if (marginPct <= floorMarginPct + FLOOR_WARNING_BAND_PCT) {
    status = "near_floor";
    warning = `Labor margin ${marginPct.toFixed(2)}% is within ${
      FLOOR_WARNING_BAND_PCT.toFixed(0)
    } points of the ${floorMarginPct.toFixed(2)}% hard floor.`;
  } else if (marginPct < targetMarginPct) {
    status = "below_target";
    warning = `Labor margin ${marginPct.toFixed(2)}% is below the ${
      targetMarginPct.toFixed(2)
    }% target.`;
  }

  return {
    revenue,
    cost,
    marginAmount,
    marginPct,
    targetMarginPct,
    floorMarginPct,
    status,
    warning,
    floorBlocked: status === "blocked_below_floor",
  };
}
