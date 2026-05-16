import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

export type PricingLineKind = Extract<
  QuoteLineItemDraft["kind"],
  | "pdi"
  | "freight"
  | "good_faith"
  | "doc_fee"
  | "title"
  | "tag"
  | "registration"
  | "discount"
  | "rebate_mfg"
  | "rebate_dealer"
  | "loyalty_discount"
  | "custom"
>;

export type CostVisibility = "internal" | "customer";

export type PricingAdderField = {
  id: string;
  kind: PricingLineKind;
  title: string;
  helper: string;
  step: number;
  costVisibility: CostVisibility;
  metadata?: Record<string, unknown>;
};

export const PRICING_ADDER_FIELDS: PricingAdderField[] = [
  {
    id: "inbound_freight",
    kind: "freight",
    title: "Inbound freight to yard",
    helper: "Internal freight from vendor to QEP yard",
    step: 100,
    costVisibility: "internal",
    metadata: { freight_direction: "inbound", pricing_field_key: "inbound_freight" },
  },
  {
    id: "outbound_delivery",
    kind: "freight",
    title: "Outbound delivery",
    helper: "Customer-facing outbound delivery charge",
    step: 100,
    costVisibility: "customer",
    metadata: { freight_direction: "outbound", pricing_field_key: "outbound_delivery" },
  },
  { id: "pdi", kind: "pdi", title: "PDI", helper: "Internal prep / inspection cost", step: 100, costVisibility: "internal" },
  { id: "good_faith", kind: "good_faith", title: "1% good faith", helper: "Internal goodwill reserve", step: 100, costVisibility: "internal" },
  { id: "doc_fee", kind: "doc_fee", title: "Doc fee", helper: "Customer-facing paperwork fee", step: 25, costVisibility: "customer" },
  { id: "title", kind: "title", title: "Title", helper: "Customer-facing title processing", step: 25, costVisibility: "customer" },
  { id: "tag", kind: "tag", title: "Tag", helper: "Customer-facing tag / plate fee", step: 25, costVisibility: "customer" },
  { id: "registration", kind: "registration", title: "Registration", helper: "Customer-facing registration support", step: 25, costVisibility: "customer" },
];

export const DISCOUNT_REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "competitive_match", label: "Competitive match" },
  { value: "volume_buyer", label: "Volume buyer" },
  { value: "aged_inventory", label: "Aged inventory" },
  { value: "loyalty", label: "Loyalty" },
  { value: "other", label: "Other" },
];
