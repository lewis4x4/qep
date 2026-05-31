export const H8_COMEBACK_FAULT_ATTRIBUTIONS = [
  "qep_fault",
  "customer_fault",
  "oem_fault",
  "vendor_fault",
  "parts_defect",
  "other",
  "unknown",
] as const;

export type H8ComebackFaultAttribution =
  typeof H8_COMEBACK_FAULT_ATTRIBUTIONS[number];

export const H8_PAYER_TYPES = [
  "customer",
  "warranty_claim",
  "qep_internal",
  "oem_policy",
  "goodwill",
  "other",
] as const;

export type H8PayerType = typeof H8_PAYER_TYPES[number];

export const H8_WARRANTY_CLAIM_STATUSES = [
  "draft",
  "submitted",
  "oem_evaluation",
  "approved",
  "paid",
  "denied",
  "cancelled",
] as const;

export type H8WarrantyClaimStatus = typeof H8_WARRANTY_CLAIM_STATUSES[number];

const WARRANTY_STATUS_TRANSITIONS: Record<
  H8WarrantyClaimStatus,
  H8WarrantyClaimStatus[]
> = {
  draft: ["submitted", "cancelled"],
  submitted: ["oem_evaluation", "approved", "denied", "cancelled"],
  oem_evaluation: ["approved", "denied", "cancelled"],
  approved: ["paid", "denied", "cancelled"],
  paid: [],
  denied: [],
  cancelled: [],
};

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

export function normalizeH8PayerType(value: unknown): H8PayerType | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  if (
    normalized === "warranty" || normalized === "warranty_oem" ||
    normalized === "oem_warranty"
  ) {
    return "warranty_claim";
  }
  if (
    normalized === "internal" || normalized === "qep" ||
    normalized === "qep_fault"
  ) {
    return "qep_internal";
  }
  return (H8_PAYER_TYPES as readonly string[]).includes(normalized)
    ? normalized as H8PayerType
    : null;
}

export function normalizeH8ComebackFaultAttribution(
  value: unknown,
): H8ComebackFaultAttribution | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  if (
    ["qep", "shop", "technician", "tech", "dealer", "our_fault"].includes(
      normalized,
    )
  ) {
    return "qep_fault";
  }
  if (
    ["customer", "operator", "customer_damage", "operator_error"].includes(
      normalized,
    )
  ) {
    return "customer_fault";
  }
  if (["warranty", "manufacturer", "oem", "factory"].includes(normalized)) {
    return "oem_fault";
  }
  if (["vendor", "sublet", "supplier"].includes(normalized)) {
    return "vendor_fault";
  }
  if (["part", "parts", "failed_part", "defective_part"].includes(normalized)) {
    return "parts_defect";
  }
  return (H8_COMEBACK_FAULT_ATTRIBUTIONS as readonly string[]).includes(
      normalized,
    )
    ? normalized as H8ComebackFaultAttribution
    : null;
}

export function normalizeH8WarrantyClaimStatus(
  value: unknown,
): H8WarrantyClaimStatus | null {
  const normalized = normalizeToken(value);
  return normalized &&
      (H8_WARRANTY_CLAIM_STATUSES as readonly string[]).includes(normalized)
    ? normalized as H8WarrantyClaimStatus
    : null;
}

export function canTransitionH8WarrantyClaim(
  from: H8WarrantyClaimStatus,
  to: H8WarrantyClaimStatus,
): boolean {
  if (from === to) return true;
  return WARRANTY_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function h8PayerBillingFields(payerType: H8PayerType): {
  revenue_type?: "customer" | "warranty" | "internal" | "policy" | "goodwill";
  billing_basis?: "time_and_material" | "warranty" | "internal" | "no_charge";
  billed_status?: "unbilled" | "billing_hold";
} {
  switch (payerType) {
    case "warranty_claim":
      return {
        revenue_type: "warranty",
        billing_basis: "warranty",
        billed_status: "unbilled",
      };
    case "qep_internal":
      return {
        revenue_type: "internal",
        billing_basis: "no_charge",
        billed_status: "billing_hold",
      };
    case "oem_policy":
      return {
        revenue_type: "policy",
        billing_basis: "warranty",
        billed_status: "unbilled",
      };
    case "goodwill":
      return {
        revenue_type: "goodwill",
        billing_basis: "no_charge",
        billed_status: "billing_hold",
      };
    case "customer":
      return {
        revenue_type: "customer",
        billing_basis: "time_and_material",
        billed_status: "unbilled",
      };
    default:
      return {};
  }
}

export function h8NoRebillFieldsForFault(
  fault: H8ComebackFaultAttribution,
): {
  comeback_no_rebill: boolean;
  revenue_type?: "internal";
  billing_basis?: "no_charge";
  billed_status?: "billing_hold";
} {
  if (fault !== "qep_fault") return { comeback_no_rebill: false };
  return {
    comeback_no_rebill: true,
    revenue_type: "internal",
    billing_basis: "no_charge",
    billed_status: "billing_hold",
  };
}
