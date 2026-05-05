import { supabase } from "@/lib/supabase";
import type { QuoteTaxProfile } from "../../../../../../shared/qep-moonshot-contracts";

const TAX_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tax-calculator`;

export interface TaxLine {
  description: string;
  rate: number;
  amount: number;
  applies_to: string;
  jurisdiction_id?: string | null;
  cap_applied?: number | null;
}

export interface Section179Result {
  deduction: number;
  bonus: number;
  total_deduction: number;
  tax_savings: number;
  net_cost: number;
}

export interface TaxCalculation {
  tax_lines: TaxLine[];
  total_tax: number;
  state_tax: number;
  county_tax: number;
  taxable_basis: number;
  exemptions_applied: string[];
  manual_override_applied?: boolean;
  section_179: Section179Result | null;
  equipment_cost: number;
}

export async function calculateTax(params: {
  deal_id?: string;
  company_id?: string;
  branch_slug?: string;
  subtotal: number;
  discount_total: number;
  trade_allowance: number;
  tax_profile: QuoteTaxProfile;
  delivery_state?: string;
  delivery_county?: string;
  tax_override_amount?: number | null;
  tax_override_reason?: string | null;
  include_179?: boolean;
  tax_year?: number;
  effective_tax_rate?: number;
}): Promise<TaxCalculation> {
  const session = (await supabase.auth.getSession()).data.session;
  const res = await fetch(TAX_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Tax calculation failed" }));
    throw new Error(err.error || `Tax calculation failed (${res.status})`);
  }
  return res.json();
}
