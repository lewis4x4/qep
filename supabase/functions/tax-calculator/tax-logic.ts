export type QuoteTaxProfile =
  | "standard"
  | "agriculture_exempt"
  | "fire_mitigation_exempt"
  | "government_exempt"
  | "resale_exempt";

export interface TaxLine {
  description: string;
  rate: number;
  amount: number;
  applies_to: string;
  jurisdiction_id?: string | null;
  cap_applied?: number | null;
}

export interface TaxJurisdictionInput {
  id?: string | null;
  state_code?: string | null;
  county_name?: string | null;
  jurisdiction_name?: string | null;
  state_rate?: number | string | null;
  county_surtax_rate?: number | string | null;
  surtax_cap_amount?: number | string | null;
}

export interface TaxComputationInput {
  subtotal: number;
  discountTotal: number;
  tradeAllowance: number;
  taxProfile: QuoteTaxProfile;
  stateCode?: string | null;
  countyName?: string | null;
  jurisdiction?: TaxJurisdictionInput | null;
  exemptionsApplied?: string[];
  taxOverrideAmount?: number | null;
  taxOverrideReason?: string | null;
}

export interface TaxComputationResult {
  tax_lines: TaxLine[];
  total_tax: number;
  state_tax: number;
  county_tax: number;
  taxable_basis: number;
  exemptions_applied: string[];
  manual_override_applied: boolean;
}

export interface FetComputationInput {
  taxableBasis: number;
  applicable: boolean;
  rate?: number | string | null;
  exemptionApplied?: boolean;
  exemptionLabel?: string | null;
  certificateId?: string | null;
}

export interface FetComputationResult {
  fet_lines: TaxLine[];
  fet_rate: number;
  fet_amount: number;
  fet_taxable_basis: number;
  fet_exemption_applied: boolean;
  fet_certificate_id: string | null;
}

export function clampCurrency(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, numeric) * 100) / 100;
}

function normalizeState(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function roundedTax(value: number): number {
  return Math.round(value * 100) / 100;
}

function numericOr(value: unknown, fallback: number): number {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function computeFederalExciseTax(input: FetComputationInput): FetComputationResult {
  const taxableBasis = clampCurrency(input.taxableBasis);
  const rate = input.applicable ? numericOr(input.rate, 0.12) : 0;
  const certificateId = input.certificateId ?? null;

  if (!input.applicable || taxableBasis <= 0) {
    return {
      fet_lines: [],
      fet_rate: rate,
      fet_amount: 0,
      fet_taxable_basis: taxableBasis,
      fet_exemption_applied: false,
      fet_certificate_id: certificateId,
    };
  }

  if (input.exemptionApplied) {
    return {
      fet_lines: [{
        description: input.exemptionLabel ?? "Federal excise tax exemption",
        rate,
        amount: 0,
        applies_to: "federal_excise_tax_exemption",
        jurisdiction_id: certificateId,
      }],
      fet_rate: rate,
      fet_amount: 0,
      fet_taxable_basis: taxableBasis,
      fet_exemption_applied: true,
      fet_certificate_id: certificateId,
    };
  }

  const amount = roundedTax(taxableBasis * rate);
  return {
    fet_lines: amount > 0
      ? [{
        description: "Federal excise tax",
        rate,
        amount,
        applies_to: "federal_excise_tax",
      }]
      : [],
    fet_rate: rate,
    fet_amount: amount,
    fet_taxable_basis: taxableBasis,
    fet_exemption_applied: false,
    fet_certificate_id: certificateId,
  };
}

export function computeQuoteTax(input: TaxComputationInput): TaxComputationResult {
  const subtotal = clampCurrency(input.subtotal);
  const discountTotal = clampCurrency(input.discountTotal);
  const tradeAllowance = clampCurrency(input.tradeAllowance);
  const taxableBasis = clampCurrency(subtotal - discountTotal - tradeAllowance);
  const exemptionsApplied = input.exemptionsApplied ?? [];

  if (exemptionsApplied.length > 0) {
    return {
      tax_lines: [],
      total_tax: 0,
      state_tax: 0,
      county_tax: 0,
      taxable_basis: taxableBasis,
      exemptions_applied: exemptionsApplied,
      manual_override_applied: false,
    };
  }

  if (input.taxOverrideAmount != null) {
    const overrideAmount = clampCurrency(input.taxOverrideAmount);
    return {
      tax_lines: [{
        description: `Manual estimated tax override${input.taxOverrideReason ? ` — ${input.taxOverrideReason}` : ""}`,
        rate: 0,
        amount: overrideAmount,
        applies_to: "manual_override",
      }],
      total_tax: overrideAmount,
      state_tax: 0,
      county_tax: 0,
      taxable_basis: taxableBasis,
      exemptions_applied: exemptionsApplied,
      manual_override_applied: true,
    };
  }

  const stateCode = normalizeState(input.stateCode ?? input.jurisdiction?.state_code);
  if (stateCode !== "FL") {
    return {
      tax_lines: [],
      total_tax: 0,
      state_tax: 0,
      county_tax: 0,
      taxable_basis: taxableBasis,
      exemptions_applied: exemptionsApplied,
      manual_override_applied: false,
    };
  }

  const stateRate = numericOr(input.jurisdiction?.state_rate, 0.06);
  const stateTax = roundedTax(taxableBasis * stateRate);
  const countyRate = numericOr(input.jurisdiction?.county_surtax_rate, 0);
  const cap = input.jurisdiction?.surtax_cap_amount == null
    ? null
    : clampCurrency(input.jurisdiction.surtax_cap_amount);
  const countyBasis = cap == null ? taxableBasis : Math.min(taxableBasis, cap);
  const countyTax = roundedTax(countyBasis * countyRate);
  const jurisdictionId = input.jurisdiction?.id ?? null;
  const countyLabel = input.jurisdiction?.county_name ?? input.countyName ?? "delivery county";
  const taxLines: TaxLine[] = [];

  if (stateTax > 0) {
    taxLines.push({
      description: "Florida state sales tax",
      rate: stateRate,
      amount: stateTax,
      applies_to: "taxable_basis_post_trade",
      jurisdiction_id: jurisdictionId,
    });
  }
  if (countyTax > 0) {
    taxLines.push({
      description: `${countyLabel} discretionary surtax`,
      rate: countyRate,
      amount: countyTax,
      applies_to: "county_surtax_cap",
      jurisdiction_id: jurisdictionId,
      cap_applied: cap,
    });
  }

  return {
    tax_lines: taxLines,
    total_tax: roundedTax(stateTax + countyTax),
    state_tax: stateTax,
    county_tax: countyTax,
    taxable_basis: taxableBasis,
    exemptions_applied: exemptionsApplied,
    manual_override_applied: false,
  };
}
