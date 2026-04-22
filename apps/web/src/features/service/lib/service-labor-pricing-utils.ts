export type ServiceLaborPricingRuleRow = {
  contract?: never;
  location_code: string | null;
  customer_id: string | null;
  customer_group_label: string | null;
  work_order_status: "all" | "customer" | "warranty" | "internal";
  labor_type_code: string | null;
  premium_code: string | null;
  default_premium_code: string | null;
  comment: string | null;
  pricing_code:
    | "fixed_price"
    | "list_plus_pct"
    | "list_minus_pct"
    | "cost_plus_pct"
    | "cost_minus_pct";
  pricing_value: number;
  active: boolean;
};

export function formatLaborPricingRule(rule: ServiceLaborPricingRuleRow): string {
  if (rule.pricing_code === "fixed_price") {
    return `$${Number(rule.pricing_value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}/hr fixed`;
  }
  const sign = rule.pricing_code.endsWith("minus_pct") ? "-" : "+";
  return `${sign}${Number(rule.pricing_value).toLocaleString()}% ${rule.pricing_code.startsWith("cost") ? "cost" : "list"}`;
}
