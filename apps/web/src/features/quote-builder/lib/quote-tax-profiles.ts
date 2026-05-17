import type { QuoteTaxProfile } from "../../../../../../shared/qep-moonshot-contracts";

export const QUOTE_TAX_PROFILES: Array<{ value: QuoteTaxProfile; label: string; detail: string }> = [
  { value: "standard", label: "Standard taxable", detail: "Calculate estimated sales tax normally." },
  { value: "agriculture_exempt", label: "Agriculture exempt", detail: "Use when the quoted application is agricultural." },
  { value: "fire_mitigation_exempt", label: "Fire mitigation exempt", detail: "Use when the quoted application is fire suppression or mitigation." },
  { value: "government_exempt", label: "Government exempt", detail: "Use for exempt public-sector entities." },
  { value: "resale_exempt", label: "Resale exempt", detail: "Use when the customer is buying for resale." },
];
