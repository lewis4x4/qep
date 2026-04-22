export type ServiceLaborPricingRule = {
  id: string;
  location_code: string | null;
  customer_id: string | null;
  customer_group_label: string | null;
  work_order_status: "all" | "customer" | "warranty" | "internal";
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
  laborTypeCode?: string | null;
  premiumCode?: string | null;
  now?: Date;
};

export function deriveWorkOrderStatus(statusFlags: string[] | null | undefined): "customer" | "warranty" | "internal" {
  const flags = statusFlags ?? [];
  if (flags.includes("internal")) return "internal";
  if (flags.includes("warranty_recall")) return "warranty";
  return "customer";
}

function withinDateWindow(rule: ServiceLaborPricingRule, now: Date): boolean {
  const current = now.toISOString().slice(0, 10);
  if (rule.effective_start_on && rule.effective_start_on > current) return false;
  if (rule.effective_end_on && rule.effective_end_on < current) return false;
  return true;
}

function matchesOptional(expected: string | null | undefined, actual: string | null | undefined): boolean {
  if (!expected) return true;
  return expected === (actual ?? null);
}

function scoreRule(rule: ServiceLaborPricingRule, ctx: LaborPricingContext): number {
  let score = 0;
  if (rule.customer_id && rule.customer_id === ctx.customerId) score += 32;
  if (rule.customer_group_label && rule.customer_group_label === (ctx.customerGroupLabel ?? null)) score += 16;
  if (rule.location_code && rule.location_code === ctx.locationCode) score += 8;
  if (rule.work_order_status !== "all") score += 4;
  if (rule.labor_type_code) score += 2;
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
      matchesOptional(rule.customer_group_label, ctx.customerGroupLabel ?? null) &&
      (rule.work_order_status === "all" || rule.work_order_status === ctx.workOrderStatus) &&
      matchesOptional(rule.labor_type_code, ctx.laborTypeCode ?? null) &&
      matchesOptional(rule.premium_code, ctx.premiumCode ?? null),
    )
    .sort((a, b) => {
      const scoreDiff = scoreRule(b, ctx) - scoreRule(a, ctx);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    })[0] ?? null;
}

export function resolveLaborRate(
  baseRate: number,
  rule: ServiceLaborPricingRule | null,
): number {
  if (!rule) return baseRate;
  const value = Number(rule.pricing_value ?? 0);
  switch (rule.pricing_code) {
    case "fixed_price":
      return value;
    case "list_plus_pct":
    case "cost_plus_pct":
      return Math.round(baseRate * (1 + value / 100) * 100) / 100;
    case "list_minus_pct":
    case "cost_minus_pct":
      return Math.round(baseRate * (1 - value / 100) * 100) / 100;
  }
}
