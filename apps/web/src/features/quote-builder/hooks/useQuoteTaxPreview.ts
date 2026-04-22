import { useQuery } from "@tanstack/react-query";
import { calculateTax, type TaxCalculation } from "../lib/tax-api";
import type { QuoteTaxProfile } from "../../../../../../shared/qep-moonshot-contracts";

export interface QuoteTaxPreviewInput {
  dealId?: string;
  companyId?: string;
  branchSlug?: string;
  subtotal: number;
  discountTotal: number;
  tradeAllowance: number;
  taxProfile: QuoteTaxProfile;
  include179?: boolean;
  taxYear?: number;
  effectiveTaxRate?: number;
}

export function useQuoteTaxPreview(input: QuoteTaxPreviewInput) {
  const enabled = Boolean(input.branchSlug) && input.subtotal > 0;

  return useQuery<TaxCalculation>({
    queryKey: [
      "quote-builder",
      "tax-preview",
      input.dealId ?? null,
      input.companyId ?? null,
      input.branchSlug ?? null,
      input.subtotal,
      input.discountTotal,
      input.tradeAllowance,
      input.taxProfile,
      input.include179 ?? true,
      input.taxYear ?? null,
      input.effectiveTaxRate ?? null,
    ],
    queryFn: () => calculateTax({
      deal_id: input.dealId,
      company_id: input.companyId,
      branch_slug: input.branchSlug,
      subtotal: input.subtotal,
      discount_total: input.discountTotal,
      trade_allowance: input.tradeAllowance,
      tax_profile: input.taxProfile,
      include_179: input.include179,
      tax_year: input.taxYear,
      effective_tax_rate: input.effectiveTaxRate,
    }),
    enabled,
    staleTime: 60_000,
  });
}
