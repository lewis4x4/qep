const PUBLIC_DISCOUNT_REASON_CODES = new Set([
  "competitive_match",
  "volume_buyer",
  "aged_inventory",
  "loyalty",
  "other",
]);
const TAX_EXEMPT_PROFILES = new Set([
  "agriculture_exempt",
  "fire_mitigation_exempt",
  "government_exempt",
  "resale_exempt",
]);
const PUBLIC_ACCEPT_STATUSES = new Set([
  "sent",
  "viewed",
  "countered",
  "approved",
  "approved_with_conditions",
]);
const TERMINAL_PUBLIC_ACCEPT_STATUSES = new Set([
  "accepted",
  "converted_to_deal",
  "archived",
  "rejected",
  "expired",
]);

export type QuoteCustomerContentReadyResult =
  | { ok: true }
  | {
    ok: false;
    message: string;
    blockers: Array<{ code: string; message: string }>;
  };

export type PublicQuoteAccessReadyResult =
  | { ok: true }
  | {
    ok: false;
    message: string;
    status: number;
    blockers?: Array<{ code: string; message: string }>;
  };

export type PublicSignatureDataUrlResult =
  | { ok: true; value: string }
  | { ok: false; message: string; status: number };

export interface CustomerProposalEmailInput {
  contactName: string;
  quoteNumber?: string | null;
  customerTotal?: unknown;
  amountFinanced?: unknown;
  selectedFinanceScenario?: string | null;
  whyThisMachine?: string | null;
  whyThisMachineConfirmed?: boolean;
  specialTerms?: string | null;
  expiresAt?: string | null;
  publicUrl?: string | null;
  branch?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function isExpiredAt(value: unknown, now = Date.now()): boolean {
  const raw = text(value, 120);
  if (!raw) return false;
  const expiresAt = Date.parse(raw);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function validatePublicSignatureDataUrl(
  value: unknown,
): PublicSignatureDataUrlResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, message: "Signature is required.", status: 400 };
  }
  if (value.length > 250_000) {
    return { ok: false, message: "Signature image too large.", status: 413 };
  }
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !match[1].startsWith("iVBORw0KGgo")) {
    return { ok: false, message: "Signature must be a PNG image.", status: 400 };
  }
  return { ok: true, value };
}

function stringArray(value: unknown, maxItems = 12, maxChars = 240): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const safe = text(item, maxChars);
      return safe ? [safe] : [];
    })
    .slice(0, maxItems);
}

function publicFacts(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = text(item.label, 120);
    const factValue = text(item.value, 240);
    return label && factValue ? [{ label, value: factValue }] : [];
  }).slice(0, 12);
}

function publicTranscriptHighlights(
  value: unknown,
): Array<{ quote: string; supports: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const supports = text(item.supports, 240);
    return supports ? [{ quote: "", supports }] : [];
  }).slice(0, 8);
}

function publicLegacyEquipment(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      make: text(item.make, 80),
      model: text(item.model, 120),
      year: numberValue(item.year),
      price: numberValue(
        item.price ?? item.unit_price ?? item.quoted_list_price,
      ),
      title: text(item.title ?? item.description ?? item.name, 180),
    }];
  });
}

function publicLegacyAttachments(
  value: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      name: text(item.name ?? item.title ?? item.description, 180),
      price: numberValue(
        item.price ?? item.unit_price ?? item.quoted_list_price,
      ),
    }];
  });
}

function publicFinanceScenarios(
  value: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      label: text(item.label ?? item.scenario_label, 160),
      type: text(item.type ?? item.kind, 40),
      kind: text(item.kind, 40),
      term_months: numberValue(item.term_months ?? item.termMonths),
      apr: numberValue(item.apr ?? item.rate),
      rate: numberValue(item.rate ?? item.apr),
      monthly_payment: numberValue(item.monthly_payment ?? item.monthlyPayment),
      total_cost: numberValue(item.total_cost ?? item.totalCost),
      down_payment: numberValue(item.down_payment ?? item.downPayment),
      residual_amount: numberValue(item.residual_amount ?? item.residualAmount),
      lender: text(item.lender, 160),
    }];
  }).slice(0, 8);
}

export function buildPublicQuoteLineItems(
  value: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const reasonCode = text(item.reason_code ?? item.reasonCode, 80);
    const safeReasonCode =
      reasonCode && PUBLIC_DISCOUNT_REASON_CODES.has(reasonCode)
        ? reasonCode
        : null;
    return [{
      line_type: text(item.line_type ?? item.kind, 40),
      description: text(item.description ?? item.title ?? item.name, 240),
      make: text(item.make, 80),
      model: text(item.model, 120),
      year: numberValue(item.year),
      quantity: numberValue(item.quantity),
      unit_price: numberValue(
        item.unit_price ?? item.price ?? item.quoted_list_price,
      ),
      extended_price: numberValue(item.extended_price),
      display_order: numberValue(item.display_order),
      ...(safeReasonCode ? { reason_code: safeReasonCode } : {}),
    }];
  });
}

export function buildPublicRecommendationPayload(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const alternative = isRecord(value.alternative)
    ? {
      machine: text(value.alternative.machine, 180),
      attachments: stringArray(value.alternative.attachments),
      reasoning: text(value.alternative.reasoning, 1200),
      whyNotChosen: text(value.alternative.whyNotChosen, 1200),
    }
    : null;
  return {
    machine: text(value.machine, 180),
    attachments: stringArray(value.attachments),
    reasoning: text(value.reasoning, 2000),
    alternative,
    jobConsiderations: stringArray(value.jobConsiderations, 12, 300),
    jobFacts: publicFacts(value.jobFacts),
    transcriptHighlights: publicTranscriptHighlights(
      value.transcriptHighlights,
    ),
  };
}

export function buildPublicDealRoomPayload(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const pickString = (v: unknown) => text(v, 500);
  const pickNumber = (v: unknown) => numberValue(v);
  const confirmedNarrative = booleanValue(row.why_this_machine_confirmed) && text(row.why_this_machine, 4000);
  return {
    id: pickString(row.id),
    quote_number: pickString(row.quote_number),
    status: pickString(row.status) ?? "draft",
    customer_name: pickString(row.customer_name),
    customer_company: pickString(row.customer_company),
    branch_slug: pickString(row.branch_slug),
    equipment: publicLegacyEquipment(row.equipment),
    attachments_included: publicLegacyAttachments(row.attachments_included),
    quote_package_line_items: buildPublicQuoteLineItems(
      row.quote_package_line_items,
    ),
    subtotal: pickNumber(row.subtotal),
    equipment_total: pickNumber(row.equipment_total),
    attachment_total: pickNumber(row.attachment_total),
    discount_total: pickNumber(row.discount_total),
    trade_credit: pickNumber(row.trade_credit),
    net_total: pickNumber(row.net_total),
    tax_total: pickNumber(row.tax_total),
    cash_down: pickNumber(row.cash_down),
    amount_financed: pickNumber(row.amount_financed),
    customer_total: pickNumber(row.customer_total),
    financing_scenarios: publicFinanceScenarios(row.financing_scenarios),
    selected_finance_scenario: pickString(row.selected_finance_scenario),
    ai_recommendation: confirmedNarrative ? buildPublicRecommendationPayload(row.ai_recommendation) : null,
    why_this_machine: pickString(row.why_this_machine),
    why_this_machine_confirmed: booleanValue(row.why_this_machine_confirmed),
    special_terms: pickString(row.special_terms),
    delivery_eta: pickString(row.delivery_eta),
    deposit_required_amount: pickNumber(row.deposit_required_amount),
    tax_profile: pickString(row.tax_profile),
    tax_override_reason: pickString(row.tax_override_reason),
    follow_up_at: pickString(row.follow_up_at),
    created_at: pickString(row.created_at),
    updated_at: pickString(row.updated_at),
    expires_at: pickString(row.expires_at),
    sent_at: pickString(row.sent_at),
    viewed_at: pickString(row.viewed_at),
  };
}

export function assertQuoteCustomerContentReady(
  row: Record<string, unknown>,
): QuoteCustomerContentReadyResult {
  const blockers: Array<{ code: string; message: string }> = [];
  const whyThisMachine = text(row.why_this_machine, 4000);
  const recommendation = isRecord(row.ai_recommendation)
    ? row.ai_recommendation
    : null;
  const recommendationReasoning = recommendation
    ? text(recommendation.reasoning, 4000)
    : null;
  const confirmed = row.why_this_machine_confirmed === true;
  if ((confirmed || recommendationReasoning) && !whyThisMachine) {
    blockers.push({
      code: "why_this_machine_missing",
      message: "Add the confirmed customer-facing Why this machine narrative before sharing or sending this proposal.",
    });
  }
  if ((whyThisMachine || recommendationReasoning) && !confirmed) {
    blockers.push({
      code: "why_this_machine_unconfirmed",
      message:
        "Confirm the customer-facing Why this machine narrative before sharing or sending this proposal.",
    });
  }

  const hasTaxOverride = row.tax_override_amount != null &&
    row.tax_override_amount !== "";
  if (hasTaxOverride && !text(row.tax_override_reason, 500)) {
    blockers.push({
      code: "tax_override_reason_missing",
      message:
        "Record a tax override reason before sharing or sending this proposal.",
    });
  }

  const taxProfile = text(row.tax_profile, 80) ?? "standard";
  const isTaxExempt = TAX_EXEMPT_PROFILES.has(taxProfile);
  if (!isTaxExempt && numberValue(row.tax_total) == null) {
    blockers.push({
      code: "tax_total_missing",
      message: "Resolve estimated tax before sharing or sending this proposal.",
    });
  }

  if (blockers.length === 0) return { ok: true };
  return {
    ok: false,
    blockers,
    message: blockers.length === 1
      ? blockers[0].message
      : "Resolve customer-facing proposal readiness blockers before sharing or sending.",
  };
}

export function assertPublicQuoteReadReady(
  row: Record<string, unknown>,
  now = Date.now(),
): PublicQuoteAccessReadyResult {
  if (isExpiredAt(row.expires_at, now)) {
    return { ok: false, message: "This quote link has expired.", status: 410 };
  }

  const contentGate = assertQuoteCustomerContentReady(row);
  if (!contentGate.ok) {
    return {
      ok: false,
      message: contentGate.message,
      status: 403,
      blockers: contentGate.blockers,
    };
  }

  return { ok: true };
}

export function assertPublicQuoteAcceptReady(
  row: Record<string, unknown>,
  now = Date.now(),
): PublicQuoteAccessReadyResult {
  if (isExpiredAt(row.expires_at, now)) {
    return { ok: false, message: "This quote has expired and cannot be signed.", status: 409 };
  }

  const status = text(row.status, 80) ?? "draft";
  if (TERMINAL_PUBLIC_ACCEPT_STATUSES.has(status)) {
    return {
      ok: false,
      message: status === "accepted"
        ? "This quote has already been accepted."
        : `This quote is ${status} and cannot be signed.`,
      status: 409,
    };
  }
  if (!PUBLIC_ACCEPT_STATUSES.has(status)) {
    return {
      ok: false,
      message: `This quote cannot be signed while status is ${status}.`,
      status: 409,
    };
  }

  return assertPublicQuoteReadReady(row, now);
}

function formatCurrency(value: unknown): string | null {
  const numeric = numberValue(value);
  if (numeric == null) return null;
  return `$${Math.round(numeric).toLocaleString()}`;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function buildCustomerProposalEmailText(
  input: CustomerProposalEmailInput,
): string {
  const contactName = text(input.contactName, 160) ?? "Valued Customer";
  const customerTotal = formatCurrency(input.customerTotal);
  const amountFinancedValue = numberValue(input.amountFinanced);
  const amountFinanced = amountFinancedValue != null && amountFinancedValue > 0
    ? formatCurrency(amountFinancedValue)
    : null;
  const confirmedNarrative = input.whyThisMachineConfirmed
    ? text(input.whyThisMachine, 4000)
    : null;
  const branchName = text(input.branch?.name, 180) ??
    "Quality Equipment & Parts";
  const branchPhone = text(input.branch?.phone, 80);
  const branchEmail = text(input.branch?.email, 160);
  const branchWebsite = text(input.branch?.website, 200);

  const lines = [
    `Dear ${contactName},`,
    "",
    "Thank you for working with Quality Equipment & Parts. Your equipment proposal is ready for review.",
    "",
    input.quoteNumber ? `Quote: ${input.quoteNumber}` : null,
    customerTotal ? `Customer total: ${customerTotal}` : null,
    amountFinanced ? `Estimated amount financed: ${amountFinanced}` : null,
    input.selectedFinanceScenario
      ? `Payment option reviewed: ${input.selectedFinanceScenario}`
      : null,
    "",
    confirmedNarrative ? "Why this setup fits your work:" : null,
    confirmedNarrative,
    confirmedNarrative ? "" : null,
    input.specialTerms ? "Notes from your QEP team:" : null,
    input.specialTerms ? text(input.specialTerms, 4000) : null,
    input.specialTerms ? "" : null,
    input.expiresAt
      ? `Proposal valid through: ${formatDate(input.expiresAt)}`
      : "Proposal validity and final terms are shown in the proposal.",
    input.publicUrl ? `Review the proposal and next steps: ${input.publicUrl}` : null,
    "",
    "Payment figures are estimates until lender approval, taxes, title, registration, documentation, and signed agreements are complete.",
    "",
    `Questions? Reply to this email or contact ${branchName}.`,
    branchPhone,
    branchEmail,
    branchWebsite,
  ];

  return lines.filter((line): line is string =>
    typeof line === "string" && line.length > 0
  ).join("\n");
}
