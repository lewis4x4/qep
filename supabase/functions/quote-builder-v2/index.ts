/**
 * Quote Builder V2 Edge Function
 *
 * AI equipment recommendation, margin check surfacing, financing calc.
 * Zero-blocking: works with manual catalog when IntelliDealer unavailable.
 *
 * GET /list: List quote packages for workspace (search, status filter)
 * GET ?deal_id=...: Load existing quote for deal
 * POST /recommend: AI equipment recommendation from job description
 * POST /calculate: Financing scenarios from financing_rate_matrix
 * POST /save: Save quote package (with customer fields)
 * POST /sign: Persist quote e-signature
 *
 * Auth: rep/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";
import { computeQuoteDocumentHash } from "../_shared/quote-document-hash.ts";
import { quoteManagerApproval } from "../_shared/flow-workflows/quote-manager-approval.ts";
import {
  allowedQuoteVersionScopesForConditions,
  buildQuoteVersionSnapshot,
  diffQuoteVersionScopes,
  evaluateQuoteApprovalConditions,
  isQuoteApprovalConditionType,
  isQuoteApprovalDecision,
  resolveQuoteApprovalAuthorityBand,
  type QuoteApprovalConditionDraft,
  type QuoteApprovalConditionType,
  type QuoteApprovalPolicy,
  type QuoteApprovalRouteMode,
  type QuoteVersionSnapshot,
} from "../../../shared/qep-moonshot-contracts.ts";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const QUOTE_APPROVAL_WORKFLOW_SLUG = quoteManagerApproval.slug;

function extractQuoteText(value: Record<string, unknown> | null, keyA: string, keyB: string): string | null {
  const raw = (typeof value?.[keyA] === "string" ? value[keyA] : typeof value?.[keyB] === "string" ? value[keyB] : null) as string | null;
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function extractQuoteLines(value: Record<string, unknown> | null, keyA: string, keyB: string): string[] {
  const source = value?.[keyA] ?? value?.[keyB];
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record.description === "string" && record.description.trim()) return record.description.trim();
      if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
      const combined = [record.make, record.model, record.year].filter(Boolean).join(" ").trim();
      return combined || null;
    })
    .filter((item): item is string => Boolean(item));
}

function extractQuoteFinancing(value: Record<string, unknown> | null): string[] {
  const source = value?.financing;
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const parts = [
        typeof record.type === "string" ? record.type.toUpperCase() : null,
        Number.isFinite(Number(record.monthlyPayment)) ? `$${Math.round(Number(record.monthlyPayment)).toLocaleString()}/mo` : null,
        Number.isFinite(Number(record.termMonths)) ? `${Math.round(Number(record.termMonths))} mo` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : null;
    })
    .filter((item): item is string => Boolean(item));
}

function extractQuoteTerms(value: Record<string, unknown> | null): string[] {
  const source = value?.terms ?? value?.legal_terms;
  if (typeof source === "string" && source.trim()) return [source.trim()];
  if (!Array.isArray(source)) return [];
  return source.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function comparePortalRevisionPayload(
  currentQuoteData: Record<string, unknown> | null,
  nextQuoteData: Record<string, unknown> | null,
): Record<string, unknown> {
  const currentPrice = Number(currentQuoteData?.net_total ?? currentQuoteData?.netTotal ?? 0);
  const nextPrice = Number(nextQuoteData?.net_total ?? nextQuoteData?.netTotal ?? 0);
  const priceChanges = Number.isFinite(currentPrice) && Number.isFinite(nextPrice) && currentPrice !== nextPrice
    ? [`Net total: $${currentPrice.toLocaleString()} → $${nextPrice.toLocaleString()}`]
    : [];

  const compareLists = (label: string, current: string[], next: string[]) =>
    JSON.stringify(current) === JSON.stringify(next)
      ? []
      : [`${label}: ${current.join(", ") || "none"} → ${next.join(", ") || "none"}`];

  const equipmentChanges = compareLists(
    "Equipment",
    extractQuoteLines(currentQuoteData, "equipment", "equipment"),
    extractQuoteLines(nextQuoteData, "equipment", "equipment"),
  );
  const financingChanges = compareLists(
    "Financing",
    extractQuoteFinancing(currentQuoteData),
    extractQuoteFinancing(nextQuoteData),
  );
  const termsChanges = compareLists(
    "Terms",
    extractQuoteTerms(currentQuoteData),
    extractQuoteTerms(nextQuoteData),
  );

  const currentDealerMessage = extractQuoteText(currentQuoteData, "dealer_message", "dealerMessage");
  const nextDealerMessage = extractQuoteText(nextQuoteData, "dealer_message", "dealerMessage");

  return {
    hasChanges:
      priceChanges.length > 0 ||
      equipmentChanges.length > 0 ||
      financingChanges.length > 0 ||
      termsChanges.length > 0 ||
      currentDealerMessage !== nextDealerMessage,
    priceChanges,
    equipmentChanges,
    financingChanges,
    termsChanges,
    dealerMessageChange:
      currentDealerMessage !== nextDealerMessage
        ? `${currentDealerMessage ?? "No prior dealer message"} → ${nextDealerMessage ?? "No current dealer message"}`
        : null,
  };
}

interface AiRecommendationResult {
  machine: string;
  attachments: string[];
  reasoning: string;
  alternative?: {
    machine: string;
    attachments: string[];
    reasoning: string;
    whyNotChosen?: string | null;
  } | null;
  jobConsiderations?: string[] | null;
  jobFacts?: Array<{ label: string; value: string }> | null;
  transcriptHighlights?: Array<{ quote: string; supports: string }> | null;
}

function clampCurrency(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, numeric) * 100) / 100;
}

function buildScenarioLabel(type: "cash" | "finance" | "lease", termMonths: number): string {
  if (type === "cash") return "Cash";
  if (type === "lease") return termMonths > 0 ? `Lease ${termMonths} mo` : "Lease";
  return termMonths > 0 ? `Finance ${termMonths} mo` : "Finance";
}

async function aiEquipmentRecommendation(
  jobDescription: string,
  catalogEntries: Record<string, unknown>[],
): Promise<AiRecommendationResult> {
  if (!OPENAI_API_KEY) {
    return { machine: "", attachments: [], reasoning: "AI recommendation unavailable — select equipment manually." };
  }

  try {
    const catalogSummary = catalogEntries.slice(0, 50).map((e) =>
      `${e.make} ${e.model} (${e.year || "N/A"}) - ${e.category} - $${e.list_price || "N/A"}`
    ).join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: `You are an equipment specialist for QEP, a heavy equipment dealership. You write the "why this machine" narrative on a customer-facing proposal. The customer has already spoken with their sales rep; the job description is a transcript of that conversation. Your job is to ground the recommendation in what they actually said, cite verbatim excerpts, and give an honest comparison to the alternative.

Return JSON exactly matching this shape:
{
  "machine": "Make Model",
  "attachments": ["Attachment 1", "Attachment 2"],
  "reasoning": "A concrete 2-4 sentence narrative addressed to the customer. Reference specific job details they mentioned (acreage, terrain, existing equipment, workloads, budget constraints). Explain WHY this model is the right fit for THEIR situation — not generic marketing.",
  "alternative": {
    "machine": "Make Model",
    "attachments": ["Attachment"],
    "reasoning": "1-2 sentences: what makes this a sensible second choice.",
    "whyNotChosen": "1 honest sentence: what tradeoff makes the primary a better fit for this customer specifically."
  },
  "jobConsiderations": ["Practical note 1", "Practical note 2", "Practical note 3"],
  "jobFacts": [
    { "label": "Property size", "value": "5 acres" },
    { "label": "Primary task", "value": "Mowing and light grading" },
    { "label": "Budget", "value": "~$50,000" }
  ],
  "transcriptHighlights": [
    { "quote": "five-acre property", "supports": "Size class selection" },
    { "quote": "mowing attachment and sometimes grading", "supports": "Attachment mix" }
  ]
}

Rules:
- reasoning: write to the customer (you / your), not about them. No marketing fluff.
- alternative: set to null ONLY when the catalog truly has no close second.
- jobConsiderations: 2-3 practical notes (permit, ground conditions, seasonality, operator training). Concrete, not vague.
- jobFacts: 2-5 structured extractions from the transcript. Omit fields the customer didn't mention — don't invent.
- transcriptHighlights: 2-4 short verbatim quotes (10-20 words each) from the job description. Each must appear in the input; do not paraphrase. Pair with the decision they justify.`,
        }, {
          role: "user",
          content: `Job description (transcript):\n${jobDescription}\n\nAvailable equipment:\n${catalogSummary || "No catalog entries — provide general recommendation."}`,
        }],
        max_tokens: 900,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return { machine: "", attachments: [], reasoning: "AI recommendation failed." };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { machine: "", attachments: [], reasoning: "No recommendation generated." };
    const parsed = JSON.parse(content);
    // Guard every new field so a model that skips one (or hallucinates a
    // wrong shape) can't poison the saved quote blob. Each new field is
    // optional at the contract level.
    const altRaw = parsed.alternative;
    const alternative = altRaw && typeof altRaw === "object"
      ? {
        machine: typeof altRaw.machine === "string" ? altRaw.machine : "",
        attachments: Array.isArray(altRaw.attachments) ? altRaw.attachments.filter((a: unknown) => typeof a === "string") : [],
        reasoning: typeof altRaw.reasoning === "string" ? altRaw.reasoning : "",
        whyNotChosen: typeof altRaw.whyNotChosen === "string" ? altRaw.whyNotChosen : null,
      }
      : null;
    const jobFacts = Array.isArray(parsed.jobFacts)
      ? parsed.jobFacts.flatMap((row: unknown) => {
        if (!row || typeof row !== "object") return [];
        const label = (row as { label?: unknown }).label;
        const value = (row as { value?: unknown }).value;
        if (typeof label === "string" && typeof value === "string" && label.trim() && value.trim()) {
          return [{ label: label.trim(), value: value.trim() }];
        }
        return [];
      })
      : null;
    const transcriptHighlights = Array.isArray(parsed.transcriptHighlights)
      ? parsed.transcriptHighlights.flatMap((row: unknown) => {
        if (!row || typeof row !== "object") return [];
        const quote = (row as { quote?: unknown }).quote;
        const supports = (row as { supports?: unknown }).supports;
        if (typeof quote === "string" && typeof supports === "string" && quote.trim() && supports.trim()) {
          return [{ quote: quote.trim(), supports: supports.trim() }];
        }
        return [];
      })
      : null;
    return {
      machine: parsed.machine ?? "",
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
      reasoning: parsed.reasoning ?? "",
      alternative,
      jobConsiderations: Array.isArray(parsed.jobConsiderations)
        ? parsed.jobConsiderations.filter((c: unknown) => typeof c === "string")
        : null,
      jobFacts,
      transcriptHighlights,
    };
  } catch {
    return { machine: "", attachments: [], reasoning: "AI recommendation error — select manually." };
  }
}

function calculateFinancingScenarios(
  amountFinanced: number,
  customerTotal: number,
  rates: Array<{ term_months: number; apr: number; lender_name: string; loan_type: string }>,
) {
  const scenarios: Array<{
    type: "cash" | "finance" | "lease";
    label: string;
    termMonths: number;
    apr: number;
    rate: number;
    monthlyPayment: number | null;
    totalCost: number;
    lender: string;
  }> = [];

  // Cash scenario
  scenarios.push({
    type: "cash",
    label: "Cash",
    termMonths: 0,
    apr: 0,
    rate: 0,
    monthlyPayment: null,
    totalCost: customerTotal,
    lender: "Cash",
  });

  if (amountFinanced <= 0) return scenarios;

  // Finance scenario (60-month, best rate)
  const financeRate = rates.find((r) => r.term_months === 60 && r.loan_type === "finance") || rates[0];
  if (financeRate) {
    const monthlyRate = financeRate.apr / 100 / 12;
    const months = financeRate.term_months || 60;
    const payment = monthlyRate > 0
      ? (amountFinanced * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
      : amountFinanced / months;
    scenarios.push({
      type: "finance",
      label: buildScenarioLabel("finance", months),
      termMonths: months,
      apr: financeRate.apr,
      rate: financeRate.apr,
      monthlyPayment: Math.round(payment * 100) / 100,
      totalCost: Math.round(payment * months * 100) / 100,
      lender: financeRate.lender_name,
    });
  }

  // Lease scenario (48-month)
  const leaseRate = rates.find((r) => r.term_months === 48 && r.loan_type === "lease") || rates.find((r) => r.loan_type === "lease");
  if (leaseRate) {
    const monthlyRate = leaseRate.apr / 100 / 12;
    const months = leaseRate.term_months || 48;
    const residual = amountFinanced * 0.25; // 25% residual
    const payment = monthlyRate > 0
      ? ((amountFinanced - residual) * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
      : (amountFinanced - residual) / months;
    scenarios.push({
      type: "lease",
      label: buildScenarioLabel("lease", months),
      termMonths: months,
      apr: leaseRate.apr,
      rate: leaseRate.apr,
      monthlyPayment: Math.round(payment * 100) / 100,
      totalCost: Math.round((payment * months + residual) * 100) / 100,
      lender: leaseRate.lender_name,
    });
  }

  return scenarios;
}

async function resolveFirstOpenDealStageId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string> {
  const { data, error } = await supabase
    .from("crm_deal_stages")
    .select("id")
    .neq("is_closed_won", true)
    .neq("is_closed_lost", true)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("No open CRM deal stage configured");
  return String(data.id);
}

async function createDraftDealForQuote(input: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  userId: string;
  customerName: string | null;
  customerCompany: string | null;
  contactId: string | null;
  companyId: string | null;
  amount: number;
}): Promise<string> {
  const stageId = await resolveFirstOpenDealStageId(input.supabase);
  const customerLabel = input.customerCompany || input.customerName || "Walk-in prospect";
  const dealName = `${customerLabel} Quote`;
  const { data, error } = await input.supabase
    .from("crm_deals")
    .insert({
      name: dealName,
      stage_id: stageId,
      primary_contact_id: input.contactId,
      company_id: input.companyId,
      assigned_rep_id: input.userId,
      amount: input.amount > 0 ? input.amount : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Draft CRM deal creation returned no id");
  return String(data.id);
}

function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Customer-safe projection of a quote row for the /q/:token deal room.
// Drops every field we don't want the end customer to see (margin,
// dealer cost, internal status transitions, created_by, etc.) and
// re-shapes the blob so the public API is a stable contract even if
// internal columns churn.
function buildPublicDealRoomPayload(row: Record<string, unknown>): Record<string, unknown> {
  const pickString = (v: unknown) => typeof v === "string" ? v : null;
  const pickNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const pickArray = (v: unknown) => Array.isArray(v) ? v : [];
  const pickObject = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  return {
    id: pickString(row.id),
    quote_number: pickString(row.quote_number),
    status: pickString(row.status) ?? "draft",
    customer_name: pickString(row.customer_name),
    customer_company: pickString(row.customer_company),
    branch_slug: pickString(row.branch_slug),
    equipment: pickArray(row.equipment),
    attachments_included: pickArray(row.attachments_included),
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
    financing_scenarios: pickArray(row.financing_scenarios),
    selected_finance_scenario: pickString(row.selected_finance_scenario),
    ai_recommendation: pickObject(row.ai_recommendation),
    created_at: pickString(row.created_at),
    updated_at: pickString(row.updated_at),
    expires_at: pickString(row.expires_at),
    sent_at: pickString(row.sent_at),
    viewed_at: pickString(row.viewed_at),
  };
}

async function handlePublicDealRoomRead(url: URL, origin: string | null): Promise<Response> {
  const token = url.searchParams.get("token")?.trim();
  if (!token) return safeJsonError("token required", 400, origin);
  if (token.length < 16 || token.length > 128) {
    return safeJsonError("invalid token", 400, origin);
  }

  const admin = createAdminClient();
  // Pull the quote with admin privileges (token IS the authorization) and
  // the branch so the deal-room header can render dealer contact info
  // without a second request.
  const { data: quote, error: quoteErr } = await admin
    .from("quote_packages")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();
  if (quoteErr) {
    console.error("public quote read error:", quoteErr);
    return safeJsonError("Failed to load quote", 500, origin);
  }
  if (!quote) return safeJsonError("Quote not found", 404, origin);

  // Only serve quotes the rep has explicitly progressed past draft —
  // reps can stash share_tokens earlier for setup, but we don't leak
  // in-progress drafts. If the rep wants to share a draft, they can
  // save-to-draft-then-send; status flips forward then.
  const status = typeof quote.status === "string" ? quote.status : "draft";
  const shareableStatuses = new Set([
    "draft",
    "ready",
    "sent",
    "viewed",
    "countered",
    "accepted",
    "rejected",
    "expired",
    "approved",
    "approved_with_conditions",
    "pending_approval",
    "changes_requested",
  ]);
  if (!shareableStatuses.has(status)) {
    return safeJsonError("Quote is not shareable in its current state", 403, origin);
  }

  const branchSlug = typeof quote.branch_slug === "string" ? quote.branch_slug : null;
  let branch: Record<string, unknown> | null = null;
  if (branchSlug) {
    const { data: branchRow } = await admin
      .from("branches")
      .select("name, address_line1, city, state, postal_code, phone, email, website, doc_footer_text")
      .eq("slug", branchSlug)
      .maybeSingle();
    branch = branchRow ?? null;
  }

  return safeJsonOk({
    quote: buildPublicDealRoomPayload(quote as Record<string, unknown>),
    branch,
  }, origin);
}

// Public trade-estimate handler. Token-gated like the rest of the public
// surface — validates the share_token, then looks up comps in the same
// tables the rep-side trade-book-value-range uses. Returns a low/mid/
// high range plus a suggested conservative credit. No auction data, no
// manufacturer MSRP sources are leaked to the customer — only the
// aggregate range. Limited to 30 requests/hour per token at the Postgres
// layer is a later slice; for now we bound the compute cost by capping
// recent-comp windows.
async function handlePublicTradeEstimate(
  req: Request,
  url: URL,
  origin: string | null,
): Promise<Response> {
  const token = url.searchParams.get("token")?.trim();
  if (!token) return safeJsonError("token required", 400, origin);
  if (token.length < 16 || token.length > 128) {
    return safeJsonError("invalid token", 400, origin);
  }
  const body = await req.json().catch(() => ({}));
  const make = typeof body.make === "string" ? body.make.trim().slice(0, 60) : "";
  const model = typeof body.model === "string" ? body.model.trim().slice(0, 60) : "";
  const year = typeof body.year === "number" && Number.isFinite(body.year) ? Math.floor(body.year) : null;
  const hours = typeof body.hours === "number" && Number.isFinite(body.hours) ? Math.floor(body.hours) : null;
  if (!make || !model) {
    return safeJsonError("make and model required", 400, origin);
  }

  const admin = createAdminClient();
  // Cheapest early-exit: confirm the token is real before hitting the
  // valuation tables. Costs one indexed SELECT.
  const { data: quote, error: quoteErr } = await admin
    .from("quote_packages")
    .select("id")
    .eq("share_token", token)
    .maybeSingle();
  if (quoteErr) return safeJsonError("Failed to validate token", 500, origin);
  if (!quote) return safeJsonError("Quote not found", 404, origin);

  const estimates: Array<{ low: number; mid: number; high: number; confidence: "high" | "medium" | "low" }> = [];

  // Source 1: cached market valuations — already vetted, low variance.
  {
    let q = admin
      .from("market_valuations")
      .select("estimated_fmv, low_estimate, high_estimate, confidence_score")
      .ilike("make", make)
      .ilike("model", model)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(3);
    if (year) q = q.eq("year", year);
    const { data } = await q;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const fmv = Number(row.estimated_fmv ?? 0);
      if (fmv <= 0) continue;
      const low = Number(row.low_estimate ?? fmv * 0.9);
      const high = Number(row.high_estimate ?? fmv * 1.1);
      const conf = Number(row.confidence_score ?? 0.5);
      estimates.push({
        low,
        mid: fmv,
        high,
        confidence: conf >= 0.75 ? "high" : conf >= 0.5 ? "medium" : "low",
      });
    }
  }

  // Source 2: auction comps (year band ±2). p25/p50/p75 over last 20.
  {
    let q = admin
      .from("auction_results")
      .select("hammer_price")
      .ilike("make", make)
      .ilike("model", model)
      .order("auction_date", { ascending: false })
      .limit(20);
    if (year) q = q.gte("year", year - 2).lte("year", year + 2);
    const { data } = await q;
    const prices = ((data ?? []) as Array<Record<string, unknown>>)
      .map((r) => Number(r.hammer_price ?? 0))
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    if (prices.length >= 3) {
      const pct = (p: number) => {
        const idx = Math.max(0, Math.min(prices.length - 1, Math.floor(prices.length * p)));
        return prices[idx] ?? 0;
      };
      estimates.push({
        low: pct(0.25),
        mid: pct(0.5),
        high: pct(0.75),
        confidence: prices.length >= 8 ? "high" : "medium",
      });
    }
  }

  if (estimates.length === 0) {
    return safeJsonOk({
      status: "no_data",
      message: "No recent comparable sales found. Your rep can pull a manual valuation.",
    }, origin);
  }

  // Blend the estimates — weight by confidence. High=3, medium=2, low=1.
  const confWeight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  let totalWeight = 0;
  let lowSum = 0, midSum = 0, highSum = 0;
  for (const e of estimates) {
    const w = confWeight[e.confidence] ?? 1;
    lowSum += e.low * w;
    midSum += e.mid * w;
    highSum += e.high * w;
    totalWeight += w;
  }
  const low = Math.round(lowSum / totalWeight);
  const mid = Math.round(midSum / totalWeight);
  const high = Math.round(highSum / totalWeight);

  // Hours adjustment: >5000 hrs = haircut, <2000 hrs = premium, band
  // shifts ±10% within reason. Simple heuristic until we plug in real
  // hours-depreciation curves.
  let hoursAdjustment = 0;
  if (hours != null) {
    if (hours >= 5000) hoursAdjustment = -0.1;
    else if (hours >= 3500) hoursAdjustment = -0.05;
    else if (hours <= 1500) hoursAdjustment = 0.05;
  }
  const adjust = (v: number) => Math.round(v * (1 + hoursAdjustment));

  // Dealer-side conservatism: suggested trade credit is the low end of
  // the adjusted range. Keeps the customer's expectation in line with
  // what a rep would realistically offer.
  const suggestedCredit = adjust(low);

  return safeJsonOk({
    status: "ok",
    range: {
      low: adjust(low),
      mid: adjust(mid),
      high: adjust(high),
    },
    suggestedCredit,
    comps: estimates.length,
    hoursAdjustment,
  }, origin);
}

// Public concierge chat. Token-gated like the rest of the public surface.
// Stateless server-side: the client sends the transcript back on each
// turn so we don't pay for session storage + don't retain customer text
// past the response. System prompt is grounded in the saved quote
// (primary machine, financing context, branch contact) so the model can
// only answer "about this deal" — it refuses when asked to compare to
// competitors, quote pricing outside the proposal, or commit to changes
// the rep hasn't authorized.
async function handlePublicChatTurn(
  req: Request,
  url: URL,
  origin: string | null,
): Promise<Response> {
  const token = url.searchParams.get("token")?.trim();
  if (!token) return safeJsonError("token required", 400, origin);
  if (token.length < 16 || token.length > 128) {
    return safeJsonError("invalid token", 400, origin);
  }
  if (!OPENAI_API_KEY) {
    return safeJsonError("Chat is temporarily offline. Message your rep directly.", 503, origin);
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  if (!message) return safeJsonError("message required", 400, origin);
  const historyRaw = Array.isArray(body.history) ? body.history : [];
  // Cap transcript so a malicious caller can't blow up the OpenAI
  // context via a megabyte-sized history array.
  const history = historyRaw.slice(-20).flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const r = row as { role?: unknown; content?: unknown };
    if (typeof r.role !== "string" || typeof r.content !== "string") return [];
    if (!["user", "assistant"].includes(r.role)) return [];
    const content = r.content.slice(0, 1000);
    if (!content.trim()) return [];
    return [{ role: r.role as "user" | "assistant", content }];
  });

  const admin = createAdminClient();
  const { data: quote, error: quoteErr } = await admin
    .from("quote_packages")
    .select("id, equipment, customer_name, customer_company, customer_total, amount_financed, financing_scenarios, branch_slug, ai_recommendation")
    .eq("share_token", token)
    .maybeSingle();
  if (quoteErr) return safeJsonError("Failed to load quote", 500, origin);
  if (!quote) return safeJsonError("Quote not found", 404, origin);

  const branchSlug = typeof quote.branch_slug === "string" ? quote.branch_slug : null;
  let branch: Record<string, unknown> | null = null;
  if (branchSlug) {
    const { data } = await admin
      .from("branches")
      .select("name, address_line1, city, state, phone, email, website")
      .eq("slug", branchSlug)
      .maybeSingle();
    branch = data ?? null;
  }

  // Compact quote context — enough for the model to answer spec /
  // logistics questions, small enough that most of the prompt budget
  // goes to the actual conversation.
  const equipment = Array.isArray(quote.equipment) ? quote.equipment : [];
  const primary = equipment[0] as Record<string, unknown> | undefined;
  const machineLabel = primary
    ? [primary.make, primary.model, primary.year ? `(${primary.year})` : null].filter(Boolean).join(" ")
    : "the machine on this proposal";
  const recommendationReasoning = quote.ai_recommendation && typeof quote.ai_recommendation === "object"
    ? (quote.ai_recommendation as Record<string, unknown>).reasoning
    : null;
  const scenarios = Array.isArray(quote.financing_scenarios) ? quote.financing_scenarios : [];
  const scenarioSummary = scenarios.slice(0, 3).map((s: Record<string, unknown>) => {
    const label = typeof s.label === "string" ? s.label : (typeof s.type === "string" ? s.type : "option");
    const monthly = typeof s.monthly_payment === "number" ? `$${Math.round(s.monthly_payment)}/mo` : "—";
    const term = typeof s.term_months === "number" ? `${s.term_months} mo` : "—";
    return `${label}: ${monthly}, ${term}`;
  }).join("; ");

  const systemPrompt = `You are the concierge for Quality Equipment & Parts on a customer-facing proposal page. You help the customer understand the equipment and logistics on THIS quote only.

Quote context:
- Customer: ${typeof quote.customer_name === "string" && quote.customer_name ? quote.customer_name : "(unnamed)"}
${quote.customer_company ? `- Company: ${quote.customer_company}` : ""}
- Primary equipment: ${machineLabel}
- Customer total: ${typeof quote.customer_total === "number" ? `$${Math.round(quote.customer_total).toLocaleString()}` : "—"}
${scenarioSummary ? `- Financing options: ${scenarioSummary}` : ""}
${recommendationReasoning ? `- Why we recommended this machine: ${String(recommendationReasoning).slice(0, 500)}` : ""}
${branch ? `- Dealership: ${branch.name ?? "QEP"}${branch.phone ? `, ${branch.phone}` : ""}${branch.email ? `, ${branch.email}` : ""}` : ""}

Rules:
- Answer spec questions (dimensions, weight, typical capacities) honestly; when you don't know, say "let me get your rep to confirm" and suggest they message the rep.
- Do NOT change the price, discount, or financing terms. Those are the rep's call.
- Do NOT compare this quote to a competitor dealership's price or pitch a different model not on this proposal.
- Keep answers under 100 words unless the customer asked for detail.
- If the customer wants to accept, schedule delivery, or talk financing structure, route them to the rep's phone or email shown in the quote.
- Never make up availability or delivery dates. If asked, point to the rep.`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history,
    { role: "user" as const, content: message },
  ];

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 400,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error("public chat openai error:", res.status, await res.text().catch(() => ""));
      return safeJsonError("Chat is temporarily unavailable — try again, or reach out to your rep.", 503, origin);
    }
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!reply) {
      return safeJsonError("No reply generated — try rephrasing, or contact your rep.", 502, origin);
    }
    return safeJsonOk({ reply }, origin);
  } catch (err) {
    console.error("public chat error:", err);
    return safeJsonError("Chat timed out. Please try again.", 504, origin);
  }
}

// Public accept — customer taps to sign on /q/:token. Writes a signature
// row, stores the live configuration they accepted, SHA-256-seals the
// canonicalized snapshot for integrity, and transitions the quote
// status to "accepted". Returns the status + signature id so the UI
// can switch to a confirmation state.
async function canonicalizeAndHash(payload: Record<string, unknown>): Promise<string> {
  // Stable key order so the hash of the same logical snapshot is
  // identical across re-renders. Nested objects are sorted too.
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]);
      return Object.fromEntries(entries);
    }
    return value;
  };
  const canon = JSON.stringify(canonicalize(payload));
  const bytes = new TextEncoder().encode(canon);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function handlePublicAccept(
  req: Request,
  url: URL,
  origin: string | null,
): Promise<Response> {
  const token = url.searchParams.get("token")?.trim();
  if (!token) return safeJsonError("token required", 400, origin);
  if (token.length < 16 || token.length > 128) {
    return safeJsonError("invalid token", 400, origin);
  }

  const body = await req.json().catch(() => ({}));
  const signerName = typeof body.signer_name === "string" ? body.signer_name.trim().slice(0, 200) : "";
  const signerEmail = typeof body.signer_email === "string" ? body.signer_email.trim().slice(0, 200) : "";
  const signatureDataUrl = typeof body.signature_data_url === "string" ? body.signature_data_url : "";
  const configRaw = body.customer_configuration;

  if (!signerName) return safeJsonError("Please enter your name to sign.", 400, origin);
  // Keep the signature payload reasonable — a 320×160 PNG @ base64 is
  // well under 100KB; reject anything much larger than that.
  if (!signatureDataUrl.startsWith("data:image/")) {
    return safeJsonError("Signature is required.", 400, origin);
  }
  if (signatureDataUrl.length > 250_000) {
    return safeJsonError("Signature image too large.", 413, origin);
  }
  if (!configRaw || typeof configRaw !== "object" || Array.isArray(configRaw)) {
    return safeJsonError("Missing configuration snapshot.", 400, origin);
  }

  const admin = createAdminClient();
  const { data: quote, error: quoteErr } = await admin
    .from("quote_packages")
    .select("id, workspace_id, deal_id, status")
    .eq("share_token", token)
    .maybeSingle();
  if (quoteErr) return safeJsonError("Failed to load quote", 500, origin);
  if (!quote) return safeJsonError("Quote not found", 404, origin);

  // Guard against re-accepting or overwriting a terminal state. A rep
  // rotating the token is still a safe way to re-open for acceptance.
  const terminalStates = new Set(["rejected", "expired"]);
  if (terminalStates.has(String(quote.status))) {
    return safeJsonError(`This quote is ${quote.status} and cannot be signed.`, 409, origin);
  }

  const configuration = {
    ...(configRaw as Record<string, unknown>),
    accepted_at_client: new Date().toISOString(),
  };
  const documentHash = await canonicalizeAndHash({
    quote_id: quote.id,
    configuration,
    signer_name: signerName,
  });

  const sigIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const sigUa = req.headers.get("user-agent") ?? null;

  const { data: sigRow, error: sigErr } = await admin
    .from("quote_signatures")
    .insert({
      workspace_id: typeof quote.workspace_id === "string" ? quote.workspace_id : "default",
      quote_package_id: quote.id,
      deal_id: quote.deal_id ?? null,
      signer_name: signerName,
      signer_email: signerEmail || null,
      signer_ip: sigIp,
      signer_user_agent: sigUa,
      signature_image_url: signatureDataUrl,
      signed_snapshot: configuration,
      signed_via: "deal_room",
      document_hash: documentHash,
      is_valid: true,
    })
    .select("id, signed_at")
    .single();
  if (sigErr) {
    console.error("public accept signature insert error:", sigErr);
    return safeJsonError(sigErr.message || "Failed to record signature", 500, origin);
  }

  // Flip the package to accepted if it isn't already in a post-accept
  // state. Rep-side approval flows may have moved it further along
  // (e.g. converted_to_deal); we don't clobber those.
  const preserveStatuses = new Set([
    "accepted",
    "converted_to_deal",
    "archived",
  ]);
  if (!preserveStatuses.has(String(quote.status))) {
    // quote_packages doesn't track an accepted_at of its own — the
    // signature row's signed_at is the canonical accept timestamp.
    await admin
      .from("quote_packages")
      .update({ status: "accepted" })
      .eq("id", quote.id);
  }

  return safeJsonOk({
    signature_id: sigRow?.id ?? null,
    signed_at: sigRow?.signed_at ?? null,
    status: "accepted",
    document_hash: documentHash,
  }, origin, 201);
}

function generateShareToken(): string {
  // 32 hex chars → 128 bits of entropy. UUID-shaped but dashes stripped
  // for a tidier URL. crypto.randomUUID is cryptographically random in
  // Deno (see whatwg-webcrypto).
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

// Public attachments lookup — finds the quote by token, pulls the primary
// equipment line's catalog id, and returns attachments compatible with
// that model (plus universal attachments). Matches the structure the rep
// side uses in searchCatalog() so included + also-available lists stay
// consistent with what the rep could have added.
async function handlePublicAttachmentsRead(url: URL, origin: string | null): Promise<Response> {
  const token = url.searchParams.get("token")?.trim();
  if (!token) return safeJsonError("token required", 400, origin);
  if (token.length < 16 || token.length > 128) {
    return safeJsonError("invalid token", 400, origin);
  }

  const admin = createAdminClient();
  const { data: quote, error: quoteErr } = await admin
    .from("quote_packages")
    .select("id, equipment, workspace_id")
    .eq("share_token", token)
    .maybeSingle();
  if (quoteErr) {
    console.error("public attachments quote read error:", quoteErr);
    return safeJsonError("Failed to load quote", 500, origin);
  }
  if (!quote) return safeJsonError("Quote not found", 404, origin);

  const equipment = Array.isArray(quote.equipment) ? quote.equipment : [];
  const primary = equipment[0] as Record<string, unknown> | undefined;
  const primaryId = primary && typeof primary.id === "string" ? primary.id : null;

  // Guard against malformed model id so the contains-array filter below
  // can't blow up the query.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let attachments: Array<Record<string, unknown>> = [];
  if (primaryId && UUID_RE.test(primaryId)) {
    // Fetch compatible OR universal attachments in one round trip.
    const { data, error } = await admin
      .from("qb_attachments")
      .select("id, name, category, list_price_cents, attachment_type, universal, compatible_model_ids")
      .eq("active", true)
      .is("deleted_at", null)
      .or(`universal.eq.true,compatible_model_ids.cs.{${primaryId}}`)
      .order("name", { ascending: true })
      .limit(50);
    if (error) {
      console.error("public attachments fetch error:", error);
      return safeJsonError("Failed to load attachments", 500, origin);
    }
    attachments = data ?? [];
  } else {
    // No catalog-linked primary machine — surface only universal attachments.
    const { data, error } = await admin
      .from("qb_attachments")
      .select("id, name, category, list_price_cents, attachment_type, universal, compatible_model_ids")
      .eq("active", true)
      .is("deleted_at", null)
      .eq("universal", true)
      .order("name", { ascending: true })
      .limit(30);
    if (error) {
      console.error("public universal attachments fetch error:", error);
      return safeJsonError("Failed to load attachments", 500, origin);
    }
    attachments = data ?? [];
  }

  const items = attachments.map((row) => ({
    id: typeof row.id === "string" ? row.id : null,
    name: typeof row.name === "string" ? row.name : null,
    category: typeof row.category === "string" ? row.category : null,
    attachment_type: typeof row.attachment_type === "string" ? row.attachment_type : null,
    price: typeof row.list_price_cents === "number"
      ? row.list_price_cents / 100
      : typeof row.list_price_cents === "string"
        ? Number(row.list_price_cents) / 100
        : null,
    universal: row.universal === true,
  }));

  return safeJsonOk({ attachments: items }, origin);
}

async function ensureQuoteApprovalWorkflow(
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<string> {
  const { data: existing, error: loadError } = await admin
    .from("flow_workflow_definitions")
    .select("id, enabled")
    .eq("workspace_id", "default")
    .eq("slug", QUOTE_APPROVAL_WORKFLOW_SLUG)
    .maybeSingle();

  if (loadError) throw new Error(loadError.message);
  if (existing?.id) {
    if (existing.enabled === false) {
      throw new Error("Quote approval flow is disabled in Flow Admin.");
    }
    return String(existing.id);
  }

  const { data: created, error: createError } = await admin
    .from("flow_workflow_definitions")
    .insert({
      workspace_id: "default",
      slug: quoteManagerApproval.slug,
      name: quoteManagerApproval.name,
      description: quoteManagerApproval.description,
      owner_role: quoteManagerApproval.owner_role,
      trigger_event_pattern: quoteManagerApproval.trigger_event_pattern,
      condition_dsl: quoteManagerApproval.conditions,
      action_chain: quoteManagerApproval.actions,
      affects_modules: quoteManagerApproval.affects_modules,
      enabled: quoteManagerApproval.enabled !== false,
      dry_run: quoteManagerApproval.dry_run ?? false,
      surface: quoteManagerApproval.surface ?? "automated",
    })
    .select("id")
    .single();

  if (createError) throw new Error(createError.message);
  if (!created?.id) throw new Error("Quote approval workflow registration returned no id.");
  return String(created.id);
}

async function resolveQuoteApprovalAssignee(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  workspaceId: string;
  branchSlug: string | null;
  authorityBand: "branch_manager" | "owner_admin";
  ownerEscalationRole: "owner" | "admin";
  namedBranchSalesManagerPrimary: boolean;
  namedBranchGeneralManagerFallback: boolean;
}): Promise<{
  branchSlug: string;
  branchName: string;
  assignedTo: string | null;
  assignedToName: string | null;
  assignedRole: string | null;
  routeMode: QuoteApprovalRouteMode;
}> {
  if (!input.branchSlug) {
    throw new Error("Select a quoting branch before submitting this quote for approval.");
  }

  const { data: branch, error: branchErr } = await input.admin
    .from("branches")
    .select("slug, display_name, sales_manager_id, general_manager_id, is_active, deleted_at")
    .eq("workspace_id", input.workspaceId)
    .eq("slug", input.branchSlug)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (branchErr) throw new Error(branchErr.message);
  if (!branch?.slug) {
    throw new Error("The selected quoting branch is unavailable. Update the branch on the quote and try again.");
  }

  async function resolveProfile(profileId: string | null, routeMode: "branch_sales_manager" | "branch_general_manager") {
    if (!profileId) return null;
    const { data: profile, error } = await input.admin
      .from("profiles")
      .select("id, full_name, role, is_active")
      .eq("id", profileId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile?.id || profile.is_active !== true) return null;
    if (!["manager", "admin", "owner"].includes(String(profile.role ?? ""))) return null;
    return {
      assignedTo: String(profile.id),
      assignedToName: typeof profile.full_name === "string" && profile.full_name.trim().length > 0
        ? profile.full_name.trim()
        : null,
      routeMode,
    };
  }

  if (input.authorityBand === "branch_manager") {
    if (input.namedBranchSalesManagerPrimary) {
      const salesManager = await resolveProfile(branch.sales_manager_id ?? null, "branch_sales_manager");
      if (salesManager) {
        return {
          branchSlug: String(branch.slug),
          branchName: String(branch.display_name ?? branch.slug),
          assignedTo: salesManager.assignedTo,
          assignedToName: salesManager.assignedToName,
          assignedRole: null,
          routeMode: salesManager.routeMode,
        };
      }
    }

    if (input.namedBranchGeneralManagerFallback) {
      const generalManager = await resolveProfile(branch.general_manager_id ?? null, "branch_general_manager");
      if (generalManager) {
        return {
          branchSlug: String(branch.slug),
          branchName: String(branch.display_name ?? branch.slug),
          assignedTo: generalManager.assignedTo,
          assignedToName: generalManager.assignedToName,
          assignedRole: null,
          routeMode: generalManager.routeMode,
        };
      }
    }

    return {
      branchSlug: String(branch.slug),
      branchName: String(branch.display_name ?? branch.slug),
      assignedTo: null,
      assignedToName: null,
      assignedRole: "manager",
      routeMode: "manager_queue",
    };
  }

  const { data: escalationProfiles, error: escalationErr } = await input.admin
    .from("profiles")
    .select("id, full_name, role, is_active, active_workspace_id")
    .eq("active_workspace_id", input.workspaceId)
    .eq("is_active", true)
    .in("role", input.ownerEscalationRole === "owner" ? ["owner", "admin"] : ["admin", "owner"]);
  if (escalationErr) throw new Error(escalationErr.message);

  const escalationProfile = (escalationProfiles ?? []).find((profile: { role?: string }) =>
    profile.role === input.ownerEscalationRole) ?? (escalationProfiles ?? [])[0] ?? null;

  if (escalationProfile?.id) {
    return {
      branchSlug: String(branch.slug),
      branchName: String(branch.display_name ?? branch.slug),
      assignedTo: String(escalationProfile.id),
      assignedToName: typeof escalationProfile.full_name === "string" && escalationProfile.full_name.trim().length > 0
        ? escalationProfile.full_name.trim()
        : null,
      assignedRole: null,
      routeMode: escalationProfile.role === "admin" ? "admin_direct" : "owner_direct",
    };
  }

  return {
    branchSlug: String(branch.slug),
    branchName: String(branch.display_name ?? branch.slug),
    assignedTo: null,
    assignedToName: null,
    assignedRole: input.ownerEscalationRole,
    routeMode: input.ownerEscalationRole === "admin" ? "admin_queue" : "owner_queue",
  };
}

function defaultQuoteApprovalPolicy(workspaceId: string): QuoteApprovalPolicy {
  return {
    workspaceId,
    branchManagerMinMarginPct: 8,
    standardMarginFloorPct: 10,
    branchManagerMaxQuoteAmount: 250000,
    submitSlaHours: 24,
    escalationSlaHours: 48,
    ownerEscalationRole: "owner",
    namedBranchSalesManagerPrimary: true,
    namedBranchGeneralManagerFallback: true,
    allowedConditionTypes: [
      "min_margin_pct",
      "max_trade_allowance",
      "required_cash_down",
      "required_finance_scenario",
      "remove_attachment",
      "expiry_hours",
    ],
    updatedAt: null,
    updatedBy: null,
  };
}

async function loadQuoteApprovalPolicy(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  workspaceId: string;
}): Promise<QuoteApprovalPolicy> {
  const { data, error } = await input.admin
    .from("quote_approval_policies")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return defaultQuoteApprovalPolicy(input.workspaceId);

  const defaultPolicy = defaultQuoteApprovalPolicy(input.workspaceId);
  return {
    workspaceId: String(data.workspace_id ?? input.workspaceId),
    branchManagerMinMarginPct: Number(data.branch_manager_min_margin_pct ?? defaultPolicy.branchManagerMinMarginPct),
    standardMarginFloorPct: Number(data.standard_margin_floor_pct ?? defaultPolicy.standardMarginFloorPct),
    branchManagerMaxQuoteAmount: Number(data.branch_manager_max_quote_amount ?? defaultPolicy.branchManagerMaxQuoteAmount),
    submitSlaHours: Number(data.submit_sla_hours ?? defaultPolicy.submitSlaHours),
    escalationSlaHours: Number(data.escalation_sla_hours ?? defaultPolicy.escalationSlaHours),
    ownerEscalationRole: data.owner_escalation_role === "admin" ? "admin" : "owner",
    namedBranchSalesManagerPrimary: data.named_branch_sales_manager_primary !== false,
    namedBranchGeneralManagerFallback: data.named_branch_general_manager_fallback !== false,
    allowedConditionTypes: Array.isArray(data.allowed_condition_types)
      ? data.allowed_condition_types.filter((value: unknown): value is QuoteApprovalConditionType =>
        typeof value === "string" && isQuoteApprovalConditionType(value))
      : defaultPolicy.allowedConditionTypes,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
    updatedBy: typeof data.updated_by === "string" ? data.updated_by : null,
  };
}

function buildQuoteVersionArtifacts(input: {
  body: Record<string, unknown>;
  quotePackageId?: string | null;
  dealId?: string | null;
  status?: string | null;
}): {
  snapshot: QuoteVersionSnapshot;
  computedMetrics: Record<string, unknown>;
} {
  const equipment = Array.isArray(input.body.equipment) ? input.body.equipment as Array<Record<string, unknown>> : [];
  const attachments = Array.isArray(input.body.attachments_included) ? input.body.attachments_included as Array<Record<string, unknown>> : [];
  const snapshot = buildQuoteVersionSnapshot({
    quotePackageId: input.quotePackageId ?? null,
    dealId: input.dealId ?? null,
    branchSlug: typeof input.body.branch_slug === "string" ? input.body.branch_slug : null,
    customerName: typeof input.body.customer_name === "string" ? input.body.customer_name : null,
    customerCompany: typeof input.body.customer_company === "string" ? input.body.customer_company : null,
    customerEmail: typeof input.body.customer_email === "string" ? input.body.customer_email : null,
    customerPhone: typeof input.body.customer_phone === "string" ? input.body.customer_phone : null,
    commercialDiscountType: input.body.commercial_discount_type === "percent" ? "percent" : "flat",
    commercialDiscountValue: Number(input.body.commercial_discount_value ?? 0) || 0,
    tradeAllowance: Number(input.body.trade_allowance ?? input.body.trade_credit ?? 0) || 0,
    cashDown: Number(input.body.cash_down ?? 0) || 0,
    selectedFinanceScenario: typeof input.body.selected_finance_scenario === "string" ? input.body.selected_finance_scenario : null,
    taxProfile: typeof input.body.tax_profile === "string"
      ? input.body.tax_profile as QuoteVersionSnapshot["taxProfile"]
      : "standard",
    taxTotal: Number(input.body.tax_total ?? 0) || 0,
    netTotal: Number(input.body.net_total ?? 0) || 0,
    customerTotal: Number(input.body.customer_total ?? 0) || 0,
    amountFinanced: Number(input.body.amount_financed ?? 0) || 0,
    marginPct: typeof input.body.margin_pct === "number" ? input.body.margin_pct : Number(input.body.margin_pct ?? 0),
    amount: typeof input.body.net_total === "number" ? input.body.net_total : Number(input.body.net_total ?? 0),
    equipment: equipment.map((row) => ({
      id: typeof row.id === "string" ? row.id : null,
      title: [row.make, row.model].filter(Boolean).join(" ").trim(),
      make: typeof row.make === "string" ? row.make : null,
      model: typeof row.model === "string" ? row.model : null,
      quantity: 1,
      unitPrice: Number(row.price ?? 0) || 0,
    })),
    attachments: attachments.map((row) => ({
      id: null,
      title: typeof row.name === "string" ? row.name : "",
      make: null,
      model: null,
      quantity: 1,
      unitPrice: Number(row.price ?? 0) || 0,
    })),
    quoteStatus: (typeof input.status === "string" ? input.status : "draft") as QuoteVersionSnapshot["quoteStatus"],
    savedAt: new Date().toISOString(),
  });
  return {
    snapshot,
    computedMetrics: {
      equipment_total: Number(input.body.equipment_total ?? 0) || 0,
      attachment_total: Number(input.body.attachment_total ?? 0) || 0,
      subtotal: Number(input.body.subtotal ?? 0) || 0,
      discount_total: Number(input.body.discount_total ?? 0) || 0,
      net_total: Number(input.body.net_total ?? 0) || 0,
      tax_total: Number(input.body.tax_total ?? 0) || 0,
      customer_total: Number(input.body.customer_total ?? 0) || 0,
      cash_down: Number(input.body.cash_down ?? 0) || 0,
      amount_financed: Number(input.body.amount_financed ?? 0) || 0,
      margin_amount: Number(input.body.margin_amount ?? 0) || 0,
      margin_pct: Number(input.body.margin_pct ?? 0) || 0,
      saved_at: new Date().toISOString(),
    },
  };
}

async function createQuotePackageVersion(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  workspaceId: string;
  quotePackageId: string;
  createdBy: string;
  snapshot: QuoteVersionSnapshot;
  computedMetrics: Record<string, unknown>;
}): Promise<{ id: string; versionNumber: number }> {
  const { data: latest, error: latestErr } = await input.admin
    .from("quote_package_versions")
    .select("id, version_number")
    .eq("quote_package_id", input.quotePackageId)
    .is("superseded_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(latestErr.message);

  const nextVersion = Number(latest?.version_number ?? 0) + 1;
  if (latest?.id) {
    const { error: supersedeErr } = await input.admin
      .from("quote_package_versions")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", latest.id);
    if (supersedeErr) throw new Error(supersedeErr.message);
  }

  const { data: created, error: createErr } = await input.admin
    .from("quote_package_versions")
    .insert({
      workspace_id: input.workspaceId,
      quote_package_id: input.quotePackageId,
      version_number: nextVersion,
      snapshot_json: input.snapshot,
      computed_metrics_json: input.computedMetrics,
      created_by: input.createdBy,
    })
    .select("id, version_number")
    .single();
  if (createErr || !created?.id) {
    throw new Error(createErr?.message ?? "Failed to create quote version");
  }
  return { id: String(created.id), versionNumber: Number(created.version_number ?? nextVersion) };
}

async function getLatestQuotePackageVersion(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  quotePackageId: string;
}): Promise<{ id: string; versionNumber: number; snapshot: QuoteVersionSnapshot } | null> {
  const { data, error } = await input.admin
    .from("quote_package_versions")
    .select("id, version_number, snapshot_json")
    .eq("quote_package_id", input.quotePackageId)
    .is("superseded_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id || !data.snapshot_json || typeof data.snapshot_json !== "object") return null;
  return {
    id: String(data.id),
    versionNumber: Number(data.version_number ?? 1),
    snapshot: data.snapshot_json as QuoteVersionSnapshot,
  };
}

async function getLatestQuoteApprovalCase(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  quotePackageId: string;
}): Promise<Record<string, unknown> | null> {
  const { data, error } = await input.admin
    .from("quote_approval_cases")
    .select("*")
    .eq("quote_package_id", input.quotePackageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

async function getQuoteApprovalConditions(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  approvalCaseId: string;
}): Promise<QuoteApprovalConditionDraft[]> {
  const { data, error } = await input.admin
    .from("quote_approval_case_conditions")
    .select("id, condition_type, condition_payload_json, sort_order")
    .eq("approval_case_id", input.approvalCaseId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row: Record<string, unknown>) => {
    if (typeof row.condition_type !== "string" || !isQuoteApprovalConditionType(row.condition_type)) return [];
    return [{
      id: typeof row.id === "string" ? row.id : null,
      conditionType: row.condition_type,
      conditionPayload: row.condition_payload_json && typeof row.condition_payload_json === "object"
        ? row.condition_payload_json as Record<string, unknown>
        : {},
      sortOrder: Number(row.sort_order ?? 0) || 0,
    }];
  });
}

async function invalidateQuoteApprovalCase(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  caseId: string;
  flowApprovalId?: string | null;
  reason: string;
}): Promise<void> {
  const decidedAt = new Date().toISOString();
  const { error: caseErr } = await input.admin
    .from("quote_approval_cases")
    .update({
      status: "superseded",
      decision_note: input.reason,
      decided_at: decidedAt,
    })
    .eq("id", input.caseId);
  if (caseErr) throw new Error(caseErr.message);

  if (input.flowApprovalId) {
    const { error: flowErr } = await input.admin
      .from("flow_approvals")
      .update({
        status: "cancelled",
        decision_reason: input.reason,
        decided_at: decidedAt,
      })
      .eq("id", input.flowApprovalId)
      .in("status", ["pending", "escalated"]);
    if (flowErr) throw new Error(flowErr.message);
  }
}

function normalizeDecisionConditions(input: {
  conditions: unknown;
  allowedConditionTypes: QuoteApprovalConditionType[];
}): QuoteApprovalConditionDraft[] {
  if (!Array.isArray(input.conditions)) return [];
  return input.conditions.flatMap((condition, index) => {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) return [];
    const record = condition as Record<string, unknown>;
    const type = typeof record.conditionType === "string"
      ? record.conditionType
      : typeof record.condition_type === "string"
        ? record.condition_type
        : "";
    if (!isQuoteApprovalConditionType(type)) return [];
    if (!input.allowedConditionTypes.includes(type)) return [];
    return [{
      id: typeof record.id === "string" ? record.id : null,
      conditionType: type,
      conditionPayload: record.conditionPayload && typeof record.conditionPayload === "object" && !Array.isArray(record.conditionPayload)
        ? record.conditionPayload as Record<string, unknown>
        : record.condition_payload && typeof record.condition_payload === "object" && !Array.isArray(record.condition_payload)
          ? record.condition_payload as Record<string, unknown>
          : {},
      sortOrder: Number(record.sortOrder ?? record.sort_order ?? index) || index,
    }];
  });
}

function buildQuoteApprovalReasonSummary(input: {
  policy: QuoteApprovalPolicy;
  marginPct: number | null;
  amount: number | null;
  authorityBand: "branch_manager" | "owner_admin";
}): Record<string, unknown> {
  function formatCurrencyValue(value: number): string {
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
  const actualMargin = Number(input.marginPct ?? 0) || 0;
  const amount = Number(input.amount ?? 0) || 0;
  const reasons: string[] = [];
  if (actualMargin < input.policy.standardMarginFloorPct) {
    reasons.push(`Margin ${actualMargin.toFixed(1)}% is below the ${input.policy.standardMarginFloorPct.toFixed(1)}% floor.`);
  }
  if (actualMargin < input.policy.branchManagerMinMarginPct) {
    reasons.push(`Margin ${actualMargin.toFixed(1)}% is below the branch manager band floor of ${input.policy.branchManagerMinMarginPct.toFixed(1)}%.`);
  }
  if (amount > input.policy.branchManagerMaxQuoteAmount) {
    reasons.push(`Quote total ${formatCurrencyValue(amount)} exceeds the branch manager authority band.`);
  }
  return {
    authority_band: input.authorityBand,
    branch_manager_band_floor_pct: input.policy.branchManagerMinMarginPct,
    standard_floor_pct: input.policy.standardMarginFloorPct,
    branch_manager_max_quote_amount: input.policy.branchManagerMaxQuoteAmount,
    reasons,
  };
}

async function saveQuoteApprovalConditions(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  approvalCaseId: string;
  conditions: QuoteApprovalConditionDraft[];
}): Promise<void> {
  const { error: deleteErr } = await input.admin
    .from("quote_approval_case_conditions")
    .delete()
    .eq("approval_case_id", input.approvalCaseId);
  if (deleteErr) throw new Error(deleteErr.message);

  if (input.conditions.length === 0) return;

  const { error: insertErr } = await input.admin
    .from("quote_approval_case_conditions")
    .insert(input.conditions.map((condition, index) => ({
      approval_case_id: input.approvalCaseId,
      condition_type: condition.conditionType,
      condition_payload_json: condition.conditionPayload,
      sort_order: Number(condition.sortOrder ?? index) || index,
    })));
  if (insertErr) throw new Error(insertErr.message);
}

async function buildQuoteApprovalCaseResponse(input: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  approvalCase: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const approvalCaseId = String(input.approvalCase.id);
  const quotePackageId = String(input.approvalCase.quote_package_id);
  const conditions = await getQuoteApprovalConditions({
    admin: input.admin,
    approvalCaseId,
  });
  const latestVersion = await getLatestQuotePackageVersion({
    admin: input.admin,
    quotePackageId,
  });
  const decidedAt = typeof input.approvalCase.decided_at === "string"
    ? input.approvalCase.decided_at
    : null;
  const evaluationResult = latestVersion
    ? evaluateQuoteApprovalConditions({
      snapshot: latestVersion.snapshot,
      conditions,
      decidedAt,
      now: new Date().toISOString(),
    })
    : { evaluations: [], allSatisfied: false };
  const status = String(input.approvalCase.status ?? "pending");
  const canSend = status === "approved"
    || (status === "approved_with_conditions" && evaluationResult.allSatisfied);

  return {
    id: approvalCaseId,
    quotePackageId,
    quotePackageVersionId: String(input.approvalCase.quote_package_version_id),
    versionNumber: Number(input.approvalCase.version_number ?? latestVersion?.versionNumber ?? 1),
    dealId: typeof input.approvalCase.deal_id === "string" ? input.approvalCase.deal_id : null,
    branchSlug: typeof input.approvalCase.branch_slug === "string" ? input.approvalCase.branch_slug : null,
    branchName: typeof input.approvalCase.branch_name === "string" ? input.approvalCase.branch_name : null,
    submittedBy: typeof input.approvalCase.submitted_by === "string" ? input.approvalCase.submitted_by : null,
    submittedByName: typeof input.approvalCase.submitted_by_name === "string" ? input.approvalCase.submitted_by_name : null,
    assignedTo: typeof input.approvalCase.assigned_to === "string" ? input.approvalCase.assigned_to : null,
    assignedToName: typeof input.approvalCase.assigned_to_name === "string" ? input.approvalCase.assigned_to_name : null,
    assignedRole: typeof input.approvalCase.assigned_role === "string" ? input.approvalCase.assigned_role : null,
    routeMode: typeof input.approvalCase.route_mode === "string" ? input.approvalCase.route_mode : "manager_queue",
    policySnapshot: input.approvalCase.policy_snapshot_json && typeof input.approvalCase.policy_snapshot_json === "object"
      ? input.approvalCase.policy_snapshot_json as Record<string, unknown>
      : {},
    reasonSummary: input.approvalCase.reason_summary_json && typeof input.approvalCase.reason_summary_json === "object"
      ? input.approvalCase.reason_summary_json as Record<string, unknown>
      : {},
    status,
    decisionNote: typeof input.approvalCase.decision_note === "string" ? input.approvalCase.decision_note : null,
    decidedBy: typeof input.approvalCase.decided_by === "string" ? input.approvalCase.decided_by : null,
    decidedByName: typeof input.approvalCase.decided_by_name === "string" ? input.approvalCase.decided_by_name : null,
    decidedAt,
    dueAt: typeof input.approvalCase.due_at === "string" ? input.approvalCase.due_at : null,
    escalateAt: typeof input.approvalCase.escalate_at === "string" ? input.approvalCase.escalate_at : null,
    flowApprovalId: typeof input.approvalCase.flow_approval_id === "string" ? input.approvalCase.flow_approval_id : null,
    conditions,
    evaluations: evaluationResult.evaluations,
    canSend,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  // ── Public route: GET /public?token=... ─────────────────────────────
  // Serves a customer-safe subset of the quote for the /q/:token deal
  // room. Gated only by the opaque token — no user JWT required. The
  // token itself IS the authorization. We branch before the auth gate
  // because the customer lands here from an emailed link and has no
  // portal account. Service-role client bypasses RLS; the token match
  // enforces access.
  try {
    const publicUrl = new URL(req.url);
    const publicAction = publicUrl.pathname.split("/").pop() || "";
    if (req.method === "GET" && publicAction === "public") {
      return await handlePublicDealRoomRead(publicUrl, origin);
    }
    if (req.method === "GET" && publicAction === "public-attachments") {
      return await handlePublicAttachmentsRead(publicUrl, origin);
    }
    if (req.method === "POST" && publicAction === "public-trade-estimate") {
      return await handlePublicTradeEstimate(req, publicUrl, origin);
    }
    if (req.method === "POST" && publicAction === "public-chat") {
      return await handlePublicChatTurn(req, publicUrl, origin);
    }
    if (req.method === "POST" && publicAction === "public-accept") {
      return await handlePublicAccept(req, publicUrl, origin);
    }
  } catch (err) {
    console.error("public-route dispatch error:", err);
    return safeJsonError("Failed to load public quote", 500, origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Project is on ES256 JWT signing keys; supabase-js v2's local JWT
    // verifier rejects ES256 with "Unsupported JWT algorithm ES256" and
    // 401s every legit user token. Validate by calling GoTrue's /user
    // endpoint directly — it knows its own signing key. See
    // _shared/service-auth.ts for the canonical pattern.
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : authHeader.trim();
    if (!token) {
      return safeJsonError("Missing bearer token", 401, origin);
    }
    let user: { id: string } | null = null;
    try {
      const userResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        },
      });
      if (!userResp.ok) {
        const body = await userResp.json().catch(() => ({}));
        const message =
          (body as { msg?: string; message?: string }).msg
          ?? (body as { message?: string }).message
          ?? `HTTP ${userResp.status}`;
        return safeJsonError(`Unauthorized: ${message}`, 401, origin);
      }
      const userBody = await userResp.json();
      if (!userBody || typeof userBody.id !== "string") {
        return safeJsonError("Unauthorized: malformed user", 401, origin);
      }
      user = { id: userBody.id };
    } catch (e) {
      return safeJsonError(
        `Unauthorized: ${e instanceof Error ? e.message : "token verification failed"}`,
        401,
        origin,
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, active_workspace_id")
      .eq("id", user.id)
      .maybeSingle();
    const userRole = typeof profile?.role === "string" ? profile.role : null;
    // get_my_workspace() returns active_workspace_id or 'default' as a last
    // resort. RLS on quote_packages checks workspace_id against that, so
    // writes must stamp the same value or the WITH CHECK clause rejects.
    const userWorkspaceId = typeof profile?.active_workspace_id === "string" && profile.active_workspace_id.trim()
      ? profile.active_workspace_id.trim()
      : "default";
    const canRevise = userRole !== null && ["rep", "admin", "manager", "owner"].includes(userRole);
    const canPublish = userRole !== null && ["admin", "manager", "owner"].includes(userRole);

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";

    async function getPortalReviewContext(dealId: string) {
      const { data: review, error: reviewErr } = await supabase
        .from("portal_quote_reviews")
        .select("id, workspace_id, deal_id, status, counter_notes, quote_data, quote_pdf_url, expires_at, updated_at")
        .eq("deal_id", dealId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (reviewErr) throw new Error(reviewErr.message);
      if (!review?.id) return null;

      const { data: versions, error: versionsErr } = await supabase
        .from("portal_quote_review_versions")
        .select("id, version_number, quote_data, quote_pdf_url, dealer_message, revision_summary, customer_request_snapshot, published_at, is_current")
        .eq("portal_quote_review_id", review.id)
        .order("version_number", { ascending: false });
      if (versionsErr) throw new Error(versionsErr.message);

      const versionRows = (versions ?? []) as Array<Record<string, unknown>>;
      const currentVersion = versionRows.find((row) => row.is_current === true) ?? versionRows[0] ?? null;

      if (!currentVersion && (review.quote_data || review.quote_pdf_url)) {
        await supabase.from("portal_quote_review_versions").insert({
          workspace_id: "default",
          portal_quote_review_id: review.id,
          version_number: 1,
          quote_data: review.quote_data ?? {},
          quote_pdf_url: review.quote_pdf_url ?? null,
          dealer_message: extractQuoteText((review.quote_data ?? null) as Record<string, unknown> | null, "dealer_message", "dealerMessage"),
          revision_summary: extractQuoteText((review.quote_data ?? null) as Record<string, unknown> | null, "revision_summary", "revisionSummary"),
          customer_request_snapshot: review.counter_notes ?? null,
          published_at: review.updated_at ?? new Date().toISOString(),
          is_current: true,
        });
      }

      const { data: freshVersions, error: freshVersionsErr } = await supabase
        .from("portal_quote_review_versions")
        .select("id, version_number, quote_data, quote_pdf_url, dealer_message, revision_summary, customer_request_snapshot, published_at, is_current")
        .eq("portal_quote_review_id", review.id)
        .order("version_number", { ascending: false });
      if (freshVersionsErr) throw new Error(freshVersionsErr.message);

      const latestVersions = (freshVersions ?? []) as Array<Record<string, unknown>>;
      const latestCurrentVersion = latestVersions.find((row) => row.is_current === true) ?? latestVersions[0] ?? null;

      const { data: draftRows, error: draftErr } = await supabase
        .from("portal_quote_revision_drafts")
        .select("*")
        .eq("portal_quote_review_id", review.id)
        .in("status", ["draft", "awaiting_approval", "published"])
        .order("updated_at", { ascending: false })
        .limit(1);
      if (draftErr) throw new Error(draftErr.message);

      const draft = (draftRows?.[0] ?? null) as Record<string, unknown> | null;
      const publicationStatus = draft
        ? draft.status === "awaiting_approval"
          ? "awaiting_approval"
          : draft.status === "draft"
            ? "draft_revision"
            : "published"
        : latestCurrentVersion
          ? "published"
          : "none";

      return {
        review,
        currentVersion: latestCurrentVersion,
        versions: latestVersions,
        draft,
        publicationStatus,
      };
    }

    // ── GET: Load existing quote for deal ────────────────────────────────
    if (req.method === "GET") {
      // ── GET /list: List quote packages for workspace ──────────────────
      if (action === "list") {
        const status = url.searchParams.get("status");
        const search = url.searchParams.get("search")?.trim().slice(0, 100);

        let query = supabase
          .from("quote_packages")
          .select("id, quote_number, customer_name, customer_company, status, net_total, equipment, entry_mode, created_at, win_probability_score")
          .order("created_at", { ascending: false })
          .limit(50);

        if (status && status !== "all") {
          query = query.eq("status", status);
        }

        if (search) {
          const sanitized = search.replace(/[%,().!]/g, "");
          query = query.or(
            `quote_number.ilike.%${sanitized}%,customer_name.ilike.%${sanitized}%,customer_company.ilike.%${sanitized}%`
          );
        }

        const { data, error } = await query;
        if (error) {
          console.error("quote list error:", error);
          return safeJsonError("Failed to list quotes", 500, origin);
        }

        const items = (data ?? []).map((row: Record<string, unknown>) => {
          const equip = Array.isArray(row.equipment) ? row.equipment : [];
          const summary = equip
            .slice(0, 2)
            .map((e: Record<string, unknown>) => [e.make, e.model].filter(Boolean).join(" "))
            .filter(Boolean)
            .join(", ") || "No equipment";
          // Slice 20e: surface the denormalized win-probability score so
          // QuoteListPage can render a band pill without pulling the full
          // jsonb snapshot. Null for quotes saved before the snapshot
          // column existed — the UI renders "—" for those rows.
          const rawScore = row.win_probability_score;
          const winScore = typeof rawScore === "number" && Number.isFinite(rawScore)
            ? Math.max(0, Math.min(100, Math.round(rawScore)))
            : null;
          return {
            id: row.id,
            quote_number: row.quote_number ?? null,
            customer_name: row.customer_name ?? null,
            customer_company: row.customer_company ?? null,
            status: row.status ?? "draft",
            net_total: row.net_total ?? null,
            equipment_summary: summary,
            entry_mode: row.entry_mode ?? null,
            created_at: row.created_at,
            win_probability_score: winScore,
          };
        });

        return safeJsonOk({ items }, origin);
      }

      if (action === "portal-revision") {
        if (!canRevise) return safeJsonError("Portal revisions require rep, manager, or owner role", 403, origin);
        const dealId = url.searchParams.get("deal_id");
        if (!dealId) return safeJsonError("deal_id required", 400, origin);
        const context = await getPortalReviewContext(dealId);
        if (!context) {
          return safeJsonOk({ review: null, draft: null, publishState: null }, origin);
        }

        return safeJsonOk({
          review: {
            id: context.review.id,
            status: context.review.status,
            counter_notes: context.review.counter_notes ?? null,
            current_version: context.currentVersion
              ? {
                version_number: Number(context.currentVersion.version_number ?? 0) || null,
                dealer_message: typeof context.currentVersion.dealer_message === "string" ? context.currentVersion.dealer_message : null,
                revision_summary: typeof context.currentVersion.revision_summary === "string" ? context.currentVersion.revision_summary : null,
              }
              : null,
          },
          draft: context.draft
            ? {
              id: String(context.draft.id),
              portalQuoteReviewId: String(context.draft.portal_quote_review_id),
              quotePackageId: String(context.draft.quote_package_id),
              dealId: String(context.draft.deal_id),
              preparedBy: typeof context.draft.prepared_by === "string" ? context.draft.prepared_by : null,
              approvedBy: typeof context.draft.approved_by === "string" ? context.draft.approved_by : null,
              status: String(context.draft.status),
              quoteData: (context.draft.quote_data ?? null) as Record<string, unknown> | null,
              quotePdfUrl: typeof context.draft.quote_pdf_url === "string" ? context.draft.quote_pdf_url : null,
              dealerMessage: typeof context.draft.dealer_message === "string" ? context.draft.dealer_message : null,
              revisionSummary: typeof context.draft.revision_summary === "string" ? context.draft.revision_summary : null,
              customerRequestSnapshot: typeof context.draft.customer_request_snapshot === "string" ? context.draft.customer_request_snapshot : null,
              compareSnapshot: (context.draft.compare_snapshot ?? null) as Record<string, unknown> | null,
              createdAt: String(context.draft.created_at),
              updatedAt: String(context.draft.updated_at),
              publishedAt: typeof context.draft.published_at === "string" ? context.draft.published_at : null,
            }
            : null,
          publishState: {
            portalQuoteReviewId: context.review.id,
            currentPublishedVersionNumber: context.currentVersion ? Number(context.currentVersion.version_number ?? 0) || null : null,
            currentPublishedDealerMessage: context.currentVersion && typeof context.currentVersion.dealer_message === "string" ? context.currentVersion.dealer_message : null,
            currentPublishedRevisionSummary: context.currentVersion && typeof context.currentVersion.revision_summary === "string" ? context.currentVersion.revision_summary : null,
            latestCustomerRequestSnapshot: context.review.counter_notes ?? null,
            publicationStatus: context.publicationStatus,
          },
        }, origin);
      }

      if (action === "approval-case") {
        if (!canRevise) {
          return safeJsonError("Quote approval case access requires rep, admin, manager, or owner role", 403, origin);
        }
        const quotePackageId = url.searchParams.get("quote_package_id");
        if (!quotePackageId) {
          return safeJsonError("quote_package_id required", 400, origin);
        }
        const admin = createAdminClient();
        const approvalCase = await getLatestQuoteApprovalCase({
          admin,
          quotePackageId,
        });
        if (!approvalCase) {
          return safeJsonOk({ approval_case: null }, origin);
        }
        return safeJsonOk({
          approval_case: await buildQuoteApprovalCaseResponse({
            admin,
            approvalCase,
          }),
        }, origin);
      }

      if (action === "approval-policy") {
        if (!canPublish) {
          return safeJsonError("Quote approval policy access requires admin, manager, or owner role", 403, origin);
        }
        const admin = createAdminClient();
        const policy = await loadQuoteApprovalPolicy({
          admin,
          workspaceId: "default",
        });
        return safeJsonOk({ policy }, origin);
      }

      // ── GET /factor-attribution (Slice 20g) ─────────────────────────
      // Manager/owner-only: returns per-deal (factors[] × outcome)
      // tuples so the client-side pure-function attribution calculator
      // can compute which factors actually predict wins.
      //
      // Why we return deal-grouped rows rather than flattened factor
      // rows: "absent" means "factor didn't appear in this deal's
      // snapshot", which requires knowing the full factor list per
      // deal. Flattening server-side loses that structure.
      //
      // Version gate: we filter by weightsVersion="v1" to avoid mixing
      // rows from different scorer generations. When the scorer bumps
      // to v2, downstream callers will explicitly request the version
      // they want to audit.
      if (action === "factor-attribution") {
        if (!canPublish) {
          return safeJsonError("Factor attribution requires manager or owner role", 403, origin);
        }

        // PostgREST semantics: `!inner` combined with a filter on the
        // embedded resource column (`quote_packages.win_probability_snapshot`)
        // drops the parent outcome row when the embedded match is null —
        // so this is truly a parent-filtering query, not a payload shaper.
        // The flatMap below is a belt-and-suspenders guard, not load-bearing.
        const { data, error } = await supabase
          .from("qb_quote_outcomes")
          .select("outcome, quote_packages!inner(win_probability_snapshot)")
          .in("outcome", ["won", "lost", "expired"])
          .not("quote_packages.win_probability_snapshot", "is", null)
          .order("captured_at", { ascending: false })
          .limit(500);

        if (error) {
          console.error("factor-attribution query error:", error);
          return safeJsonError("Failed to load factor attribution data", 500, origin);
        }

        // Flatten to DealFactorObservation[] shape. Defensive: validate
        // snapshot shape, factor shape, and version gate per row so a
        // malformed row can't poison the aggregate.
        const deals = (data ?? []).flatMap((row: Record<string, unknown>) => {
          const pkg = Array.isArray(row.quote_packages) ? row.quote_packages[0] : row.quote_packages;
          const snapshot = (pkg as { win_probability_snapshot?: unknown } | null)?.win_probability_snapshot;
          const outcome = row.outcome;
          if (
            !snapshot ||
            typeof snapshot !== "object" ||
            Array.isArray(snapshot) ||
            (outcome !== "won" && outcome !== "lost" && outcome !== "expired")
          ) {
            return [];
          }
          const snap = snapshot as { factors?: unknown; weightsVersion?: unknown };
          // Version gate — only v1 rows for now. Unversioned rows from
          // pre-slice-20e saves don't exist (the snapshot column itself
          // didn't exist then), but be defensive.
          if (snap.weightsVersion !== "v1") return [];
          if (!Array.isArray(snap.factors)) return [];
          const factors = snap.factors.flatMap((f: unknown) => {
            if (!f || typeof f !== "object") return [];
            const rec = f as { label?: unknown; weight?: unknown };
            if (typeof rec.label !== "string" || typeof rec.weight !== "number" || !Number.isFinite(rec.weight)) {
              return [];
            }
            return [{ label: rec.label, weight: rec.weight }];
          });
          return [{ factors, outcome }];
        });

        return safeJsonOk({ deals }, origin);
      }

      // ── GET /factor-verdicts (Slice 20i) ─────────────────────────────
      // REP-ACCESSIBLE. Unlike /factor-attribution which ships the full
      // numeric report (manager-only), this endpoint ships only a
      // label → verdict ternary ("proven" | "suspect" | "unknown").
      // That's safe for reps because verdicts reveal no win-rate data
      // beyond what the scorer already exposes — only whether each
      // factor's historical lift agrees with its signed weight.
      //
      // The verdict math mirrors factor-verdict.ts (client lib) so the
      // two stay in lockstep; keeping it inline here avoids crossing
      // the edge/Bun module boundary.
      if (action === "factor-verdicts") {
        const { data, error } = await supabase
          .from("qb_quote_outcomes")
          .select("outcome, quote_packages!inner(win_probability_snapshot)")
          .in("outcome", ["won", "lost", "expired"])
          .not("quote_packages.win_probability_snapshot", "is", null)
          .order("captured_at", { ascending: false })
          .limit(500);

        if (error) {
          console.error("factor-verdicts query error:", error);
          return safeJsonError("Failed to load factor verdicts", 500, origin);
        }

        // Step 1: flatten to deal-grouped observations (same shape as
        // factor-attribution).
        const deals = (data ?? []).flatMap((row: Record<string, unknown>) => {
          const pkg = Array.isArray(row.quote_packages) ? row.quote_packages[0] : row.quote_packages;
          const snapshot = (pkg as { win_probability_snapshot?: unknown } | null)
            ?.win_probability_snapshot;
          const outcome = row.outcome;
          if (
            !snapshot ||
            typeof snapshot !== "object" ||
            Array.isArray(snapshot) ||
            (outcome !== "won" && outcome !== "lost" && outcome !== "expired")
          ) {
            return [];
          }
          const snap = snapshot as { factors?: unknown; weightsVersion?: unknown };
          if (snap.weightsVersion !== "v1") return [];
          if (!Array.isArray(snap.factors)) return [];
          const factors = snap.factors.flatMap((fa: unknown) => {
            if (!fa || typeof fa !== "object") return [];
            const rec = fa as { label?: unknown; weight?: unknown };
            if (
              typeof rec.label !== "string" ||
              typeof rec.weight !== "number" ||
              !Number.isFinite(rec.weight)
            ) {
              return [];
            }
            return [{ label: rec.label, weight: rec.weight }];
          });
          return [{ factors, outcome: outcome as "won" | "lost" | "expired" }];
        });

        // Step 2: for each distinct label, compute the signal needed to
        // decide verdict. Mirrors computeFactorAttribution but
        // short-circuits to the ternary — no win rates leave the
        // server.
        const MIN_PER_SIDE = 3;
        const labels = new Set<string>();
        for (const d of deals) for (const f of d.factors) labels.add(f.label);

        const verdicts: Array<{ label: string; verdict: "proven" | "suspect" | "unknown" }> = [];
        for (const label of labels) {
          let present = 0;
          let presentWins = 0;
          let absent = 0;
          let absentWins = 0;
          let weightSum = 0;
          for (const d of deals) {
            const hit = d.factors.find((f) => f.label === label);
            const won = d.outcome === "won";
            if (hit) {
              present += 1;
              if (won) presentWins += 1;
              if (Number.isFinite(hit.weight)) weightSum += hit.weight;
            } else {
              absent += 1;
              if (won) absentWins += 1;
            }
          }
          const lowConfidence = present < MIN_PER_SIDE || absent < MIN_PER_SIDE;
          if (lowConfidence || present === 0 || absent === 0) {
            verdicts.push({ label, verdict: "unknown" });
            continue;
          }
          const winRateWhenPresent = presentWins / present;
          const winRateWhenAbsent = absentWins / absent;
          const lift = winRateWhenPresent - winRateWhenAbsent;
          const avgWeight = weightSum / present;
          // isFactorSurprising: |weight| >= 1 and lift disagrees in sign.
          const surprising =
            (avgWeight >= 1 && lift < 0) || (avgWeight <= -1 && lift > 0);
          verdicts.push({ label, verdict: surprising ? "suspect" : "proven" });
        }

        return safeJsonOk({ verdicts }, origin);
      }

      // ── GET /closed-deals-audit (Slice 20h) ─────────────────────────
      // Manager/owner-only triage queue: the last N closed deals with
      // stored snapshots, flattened to { packageId, score, outcome,
      // factors, capturedAt }. The client lib computes |delta| and
      // surfaces the worst misses so managers can click in and read
      // the factor list that led to a bad call. Same version gate as
      // /factor-attribution — snapshots carry weightsVersion and we
      // only emit v1 rows to keep the triage list from mixing scorer
      // generations.
      if (action === "closed-deals-audit") {
        if (!canPublish) {
          return safeJsonError("Closed deals audit requires manager or owner role", 403, origin);
        }

        // Same `!inner` + embedded-column filter pattern as the other
        // two instrumentation endpoints: parent outcome rows are
        // dropped when the snapshot is null, so the limit budget is
        // populated with real observations.
        //
        // limit(100) vs. 500 on calibration/attribution: the audit UI
        // only surfaces the top 5 by |delta|, so 100 rows is enough
        // headroom to guarantee the worst misses aren't off-screen
        // while keeping the payload lean. The other two endpoints
        // feed aggregate statistics that benefit from more samples.
        const { data, error } = await supabase
          .from("qb_quote_outcomes")
          .select(
            "outcome, captured_at, quote_package_id, quote_packages!inner(win_probability_score, win_probability_snapshot)",
          )
          .in("outcome", ["won", "lost", "expired"])
          .not("quote_packages.win_probability_snapshot", "is", null)
          .order("captured_at", { ascending: false })
          .limit(100);

        if (error) {
          console.error("closed-deals-audit query error:", error);
          return safeJsonError("Failed to load closed deals audit", 500, origin);
        }

        // Defensive flatMap — validate every field before emitting.
        const audits = (data ?? []).flatMap((row: Record<string, unknown>) => {
          const pkg = Array.isArray(row.quote_packages) ? row.quote_packages[0] : row.quote_packages;
          const pkgObj = pkg as
            | { win_probability_score?: unknown; win_probability_snapshot?: unknown }
            | null;
          const score = pkgObj?.win_probability_score;
          const snapshot = pkgObj?.win_probability_snapshot;
          const outcome = row.outcome;
          const packageId = row.quote_package_id;
          const capturedAt = row.captured_at;
          if (
            typeof packageId !== "string" ||
            packageId.length === 0 ||
            typeof score !== "number" ||
            !Number.isFinite(score) ||
            !snapshot ||
            typeof snapshot !== "object" ||
            Array.isArray(snapshot) ||
            (outcome !== "won" && outcome !== "lost" && outcome !== "expired")
          ) {
            return [];
          }
          const snap = snapshot as { factors?: unknown; weightsVersion?: unknown };
          if (snap.weightsVersion !== "v1") return [];
          if (!Array.isArray(snap.factors)) return [];
          const factors = snap.factors.flatMap((f: unknown) => {
            if (!f || typeof f !== "object") return [];
            const rec = f as { label?: unknown; weight?: unknown };
            if (
              typeof rec.label !== "string" ||
              typeof rec.weight !== "number" ||
              !Number.isFinite(rec.weight)
            ) {
              return [];
            }
            return [{ label: rec.label, weight: rec.weight }];
          });
          return [
            {
              packageId,
              score,
              outcome,
              factors,
              capturedAt: typeof capturedAt === "string" ? capturedAt : null,
            },
          ];
        });

        return safeJsonOk({ audits }, origin);
      }

      // ── GET /scorer-calibration (Slice 20f) ─────────────────────────
      // Manager/owner-only aggregate of (win_probability_score) ×
      // (qb_quote_outcomes.outcome) pairs. Returns raw observations so
      // the pure calibration math lives in the client lib; the edge
      // function just handles auth + JOIN + shape.
      //
      // This is the baseline the counterfactual ML model must beat.
      if (action === "scorer-calibration") {
        if (!canPublish) {
          return safeJsonError("Scorer calibration requires manager or owner role", 403, origin);
        }

        // Pull only the columns we need. Limit 500 for now — enough to
        // power a dashboard on QB's current volume, and well below the
        // per-request payload budget. A future slice can paginate or
        // roll up server-side if dealer volume outgrows this.
        // Same PostgREST `!inner` + embedded-column filter pattern as
        // /factor-attribution below — the null-score join row is dropped
        // at the parent level, so `limit(500)` is populated with real
        // observations, not padded with null joins.
        const { data, error } = await supabase
          .from("qb_quote_outcomes")
          .select("outcome, quote_package_id, quote_packages!inner(win_probability_score)")
          .in("outcome", ["won", "lost", "expired"])
          .not("quote_packages.win_probability_score", "is", null)
          .order("captured_at", { ascending: false })
          .limit(500);

        if (error) {
          console.error("scorer-calibration query error:", error);
          return safeJsonError("Failed to load calibration data", 500, origin);
        }

        // Shape to CalibrationObservation[] — the client lib takes it
        // verbatim. Defensive: skip rows where the join produced null.
        const observations = (data ?? []).flatMap((row: Record<string, unknown>) => {
          const pkg = Array.isArray(row.quote_packages) ? row.quote_packages[0] : row.quote_packages;
          const score = (pkg as { win_probability_score?: unknown } | null)?.win_probability_score;
          const outcome = row.outcome;
          if (
            typeof score === "number" &&
            Number.isFinite(score) &&
            (outcome === "won" || outcome === "lost" || outcome === "expired")
          ) {
            return [{ score, outcome }];
          }
          return [];
        });

        return safeJsonOk({ observations }, origin);
      }

      const packageId = url.searchParams.get("package_id");
      const dealId = url.searchParams.get("deal_id");
      if (!packageId && !dealId) {
        return safeJsonError("deal_id or package_id required", 400, origin);
      }

      let query = supabase
        .from("quote_packages")
        .select("*, quote_signatures(*)");

      if (packageId) {
        query = query.eq("id", packageId);
      } else {
        query = query
          .eq("deal_id", dealId!)
          .order("created_at", { ascending: false })
          .limit(1);
      }

      const { data, error } = await query.maybeSingle();

      if (error) return safeJsonError("Failed to load quote", 500, origin);
      return safeJsonOk({ quote: data }, origin);
    }

    if (req.method !== "POST") {
      return safeJsonError("Method not allowed", 405, origin);
    }

    const body = await req.json();

    // ── POST /recommend: AI equipment recommendation ─────────────────────
    if (action === "recommend") {
      if (!body.job_description) {
        return safeJsonError("job_description required", 400, origin);
      }

      // Pull real inventory from the QB catalog (qb_equipment_models is the
      // seeded source of truth; legacy catalog_entries is intentionally
      // empty pending IntelliDealer sync). Shape the rows to match what
      // aiEquipmentRecommendation() expects so the model sees "Make Model
      // (Year) - Category - $Price" per line.
      const { data: models } = await supabase
        .from("qb_equipment_models")
        .select(
          `id, model_code, family, series, name_display, model_year, list_price_cents,
           brand:qb_brands!brand_id ( id, code, name, category )`,
        )
        .eq("active", true)
        .is("deleted_at", null)
        .order("name_display", { ascending: true })
        .limit(50);

      const catalog = (models ?? []).map((row: Record<string, unknown>) => {
        const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
        const brandName = (brand as { name?: string } | null)?.name ?? "";
        return {
          id: row.id,
          make: brandName,
          model: row.model_code ?? "",
          year: row.model_year ?? null,
          category: row.family ?? (brand as { category?: string } | null)?.category ?? null,
          list_price: row.list_price_cents != null ? Number(row.list_price_cents) / 100 : null,
        };
      });

      const recommendation = await aiEquipmentRecommendation(
        body.job_description,
        catalog,
      );

      // Return the recommendation flat — the frontend contract (see
      // getAiEquipmentRecommendation in quote-api.ts) expects the shape
      // { machine, attachments, reasoning, alternative?, jobConsiderations? }
      // at the top level, not wrapped.
      return safeJsonOk(recommendation, origin);
    }

    // ── POST /competitors: Nearby competitor listings (manager/owner) ────
    if (action === "competitors") {
      if (!canPublish) {
        return safeJsonError("Competitor intelligence requires manager or owner role", 403, origin);
      }
      if (!body.make) {
        return safeJsonError("make required", 400, origin);
      }

      let query = supabase
        .from("competitor_listings")
        .select("id, dealer_name, make, model, year, asking_price, condition, listing_url, scraped_at")
        .ilike("make", `%${String(body.make).trim()}%`)
        .order("scraped_at", { ascending: false })
        .limit(5);

      if (body.model?.trim()) {
        query = query.ilike("model", `%${String(body.model).trim()}%`);
      }

      const { data, error } = await query;
      if (error) {
        console.error("competitor listing error:", error);
        return safeJsonOk({ listings: [] }, origin);
      }

      return safeJsonOk({ listings: data ?? [] }, origin);
    }

    // ── POST /inventory-first: Rank catalog entries yard-stock first ──────
    // Rylee: "We would always prioritize quoting the inventory on hand
    //        before we quote from the manufacturer."
    if (action === "inventory-first") {
      if (!body.make && !body.model && !body.category) {
        return safeJsonError("Provide make, model, or category", 400, origin);
      }

      let query = supabase
        .from("catalog_entries")
        .select("id, make, model, year, category, list_price, dealer_cost, cost_to_qep, source_location, is_yard_stock, stock_number, acquired_at")
        .eq("is_available", true);

      if (body.make) query = query.ilike("make", body.make);
      if (body.model) query = query.ilike("model", `%${body.model}%`);
      if (body.category) query = query.eq("category", body.category);

      // Yard stock first, then by age (oldest yard stock moves first)
      const { data: results, error: searchErr } = await query
        .order("is_yard_stock", { ascending: false, nullsFirst: false })
        .order("acquired_at", { ascending: true, nullsFirst: false })
        .limit(20);

      if (searchErr) {
        console.error("inventory-first search error:", searchErr);
        return safeJsonError("Catalog search failed", 500, origin);
      }

      const rows = (results ?? []) as Array<Record<string, unknown>>;

      // Compute margin for each entry (list_price - cost_to_qep)
      const ranked: Array<Record<string, unknown>> = rows.map((row) => {
        const listPrice = Number(row.list_price) || 0;
        const costToQep = Number(row.cost_to_qep) || Number(row.dealer_cost) || 0;
        const marginDollars = listPrice - costToQep;
        const marginPct = listPrice > 0 ? (marginDollars / listPrice) * 100 : 0;
        return {
          ...row,
          margin_dollars: Math.round(marginDollars * 100) / 100,
          margin_pct: Math.round(marginPct * 100) / 100,
          quote_priority: row.is_yard_stock ? "yard_stock_first" : "factory_order",
        };
      });

      const yardCount = ranked.filter((r) => Boolean(r.is_yard_stock)).length;
      const factoryCount = ranked.length - yardCount;

      return safeJsonOk({
        results: ranked,
        summary: {
          total: ranked.length,
          yard_stock: yardCount,
          factory_order: factoryCount,
          recommendation: yardCount > 0
            ? `Quote yard stock first (${yardCount} units available at better margin)`
            : "No yard stock matching — quote from factory order",
        },
      }, origin);
    }

    // ── POST /calculate: Financing scenarios ─────────────────────────────
    if (action === "calculate") {
      const packageSubtotal = clampCurrency(body.package_subtotal);
      const discountTotal = clampCurrency(body.discount_total);
      const tradeAllowance = clampCurrency(body.trade_allowance);
      const taxTotal = clampCurrency(body.tax_total);
      const cashDown = clampCurrency(body.cash_down);
      const customerTotal = Math.max(0, packageSubtotal - discountTotal - tradeAllowance + taxTotal);
      const amountFinanced = Math.max(
        0,
        clampCurrency(body.amount_financed || customerTotal - cashDown),
      );

      if (packageSubtotal <= 0) {
        return safeJsonError("package_subtotal must be positive", 400, origin);
      }

      const { data: rates } = await supabase
        .from("financing_rate_matrix")
        .select("term_months, apr, lender_name, loan_type")
        .eq("is_active", true);

      const scenarios = calculateFinancingScenarios(
        amountFinanced,
        customerTotal,
        (rates ?? []) as Array<{ term_months: number; apr: number; lender_name: string; loan_type: string }>,
      );

      // ── Auto-apply manufacturer incentives ─────────────────────────────
      // Filter by active date range + matching manufacturer/equipment
      const today = new Date().toISOString().split("T")[0];
      let incentivesQuery = supabase
        .from("manufacturer_incentives")
        .select("*")
        .eq("is_active", true)
        .or(`start_date.is.null,start_date.lte.${today}`)
        .or(`end_date.is.null,end_date.gte.${today}`);

      if (body.manufacturer) {
        incentivesQuery = incentivesQuery.eq("oem_name", body.manufacturer);
      }

      const { data: incentives } = await incentivesQuery;
      const applicableIncentives = (incentives ?? []).map((inc: Record<string, unknown>) => {
        // Compute estimated savings per incentive
        const discountValue = Number(inc.discount_value ?? 0);
        const discountType = String(inc.discount_type ?? "");
        let estimatedSavings = 0;

        if (discountType === "percentage" || discountType === "percent") {
          estimatedSavings = customerTotal * (discountValue / 100);
        } else if (discountType === "flat" || discountType === "cash") {
          estimatedSavings = discountValue;
        }

        return {
          id: inc.id,
          oem_name: inc.oem_name,
          name: inc.name || inc.incentive_name,
          discount_type: discountType,
          discount_value: discountValue,
          estimated_savings: estimatedSavings,
          end_date: inc.end_date,
          stacking_rules: inc.stacking_rules,
        };
      });

      const totalIncentiveSavings = applicableIncentives.reduce(
        (sum: number, inc: { estimated_savings: number }) => sum + inc.estimated_savings,
        0,
      );

      // Margin check
      const marginPct = body.margin_pct ?? null;
      const marginStatus = marginPct !== null && marginPct < 10
        ? { flagged: true, message: "Margin below 10% — requires Iron Manager approval" }
        : { flagged: false, message: null };

      return safeJsonOk({
        scenarios,
        amountFinanced,
        taxTotal,
        customerTotal,
        discountTotal,
        margin_check: marginStatus,
        incentives: {
          applicable: applicableIncentives,
          total_savings: totalIncentiveSavings,
        },
      }, origin);
    }

    // ── POST /portal-revision/* — internal dealership revision workflow ─────
    if (action === "draft" && url.pathname.includes("/portal-revision/")) {
      if (!canRevise) return safeJsonError("Portal revisions require rep, manager, or owner role", 403, origin);
      if (!body.deal_id || !body.quote_package_id || !body.quote_data) {
        return safeJsonError("deal_id, quote_package_id, and quote_data required", 400, origin);
      }
      const context = await getPortalReviewContext(String(body.deal_id));
      if (!context) return safeJsonError("No linked portal quote review for this deal", 404, origin);

      const compareSnapshot = comparePortalRevisionPayload(
        (context.currentVersion?.quote_data ?? context.review.quote_data ?? null) as Record<string, unknown> | null,
        (body.quote_data ?? null) as Record<string, unknown> | null,
      );

      const draftPayload = {
        workspace_id: context.review.workspace_id,
        portal_quote_review_id: context.review.id,
        quote_package_id: body.quote_package_id,
        deal_id: body.deal_id,
        prepared_by: user.id,
        approved_by: null,
        status: "draft",
        quote_data: body.quote_data,
        quote_pdf_url: body.quote_pdf_url ?? null,
        dealer_message: body.dealer_message ?? null,
        revision_summary: body.revision_summary ?? null,
        customer_request_snapshot: context.review.counter_notes ?? null,
        compare_snapshot: compareSnapshot,
        published_at: null,
      };

      if (context.draft && ["draft", "awaiting_approval"].includes(String(context.draft.status ?? ""))) {
        const { data: updated, error } = await supabase
          .from("portal_quote_revision_drafts")
          .update(draftPayload)
          .eq("id", context.draft.id)
          .select()
          .single();
        if (error) return safeJsonError("Failed to save portal revision draft", 500, origin);
        return safeJsonOk({
          draft: {
            id: updated.id,
            portalQuoteReviewId: updated.portal_quote_review_id,
            quotePackageId: updated.quote_package_id,
            dealId: updated.deal_id,
            preparedBy: updated.prepared_by,
            approvedBy: updated.approved_by,
            status: updated.status,
            quoteData: updated.quote_data,
            quotePdfUrl: updated.quote_pdf_url,
            dealerMessage: updated.dealer_message,
            revisionSummary: updated.revision_summary,
            customerRequestSnapshot: updated.customer_request_snapshot,
            compareSnapshot: updated.compare_snapshot,
            createdAt: updated.created_at,
            updatedAt: updated.updated_at,
            publishedAt: updated.published_at,
          },
          publishState: {
            portalQuoteReviewId: context.review.id,
            currentPublishedVersionNumber: context.currentVersion ? Number(context.currentVersion.version_number ?? 0) || null : null,
            currentPublishedDealerMessage: context.currentVersion && typeof context.currentVersion.dealer_message === "string" ? context.currentVersion.dealer_message : null,
            currentPublishedRevisionSummary: context.currentVersion && typeof context.currentVersion.revision_summary === "string" ? context.currentVersion.revision_summary : null,
            latestCustomerRequestSnapshot: context.review.counter_notes ?? null,
            publicationStatus: "draft_revision",
          },
        }, origin);
      }

      const { data: created, error } = await supabase
        .from("portal_quote_revision_drafts")
        .insert(draftPayload)
        .select()
        .single();
      if (error) return safeJsonError("Failed to save portal revision draft", 500, origin);
      return safeJsonOk({
        draft: {
          id: created.id,
          portalQuoteReviewId: created.portal_quote_review_id,
          quotePackageId: created.quote_package_id,
          dealId: created.deal_id,
          preparedBy: created.prepared_by,
          approvedBy: created.approved_by,
          status: created.status,
          quoteData: created.quote_data,
          quotePdfUrl: created.quote_pdf_url,
          dealerMessage: created.dealer_message,
          revisionSummary: created.revision_summary,
          customerRequestSnapshot: created.customer_request_snapshot,
          compareSnapshot: created.compare_snapshot,
          createdAt: created.created_at,
          updatedAt: created.updated_at,
          publishedAt: created.published_at,
        },
        publishState: {
          portalQuoteReviewId: context.review.id,
          currentPublishedVersionNumber: context.currentVersion ? Number(context.currentVersion.version_number ?? 0) || null : null,
          currentPublishedDealerMessage: context.currentVersion && typeof context.currentVersion.dealer_message === "string" ? context.currentVersion.dealer_message : null,
          currentPublishedRevisionSummary: context.currentVersion && typeof context.currentVersion.revision_summary === "string" ? context.currentVersion.revision_summary : null,
          latestCustomerRequestSnapshot: context.review.counter_notes ?? null,
          publicationStatus: "draft_revision",
        },
      }, origin);
    }

    if (action === "submit" && url.pathname.includes("/portal-revision/")) {
      if (!canRevise) return safeJsonError("Portal revisions require rep, manager, or owner role", 403, origin);
      if (!body.deal_id) return safeJsonError("deal_id required", 400, origin);
      const context = await getPortalReviewContext(String(body.deal_id));
      if (!context?.draft) return safeJsonError("No portal revision draft found", 404, origin);

      const { data: updated, error } = await supabase
        .from("portal_quote_revision_drafts")
        .update({ status: "awaiting_approval" })
        .eq("id", context.draft.id)
        .select()
        .single();
      if (error) return safeJsonError("Failed to submit portal revision", 500, origin);

      return safeJsonOk({
        draft: {
          id: updated.id,
          portalQuoteReviewId: updated.portal_quote_review_id,
          quotePackageId: updated.quote_package_id,
          dealId: updated.deal_id,
          preparedBy: updated.prepared_by,
          approvedBy: updated.approved_by,
          status: updated.status,
          quoteData: updated.quote_data,
          quotePdfUrl: updated.quote_pdf_url,
          dealerMessage: updated.dealer_message,
          revisionSummary: updated.revision_summary,
          customerRequestSnapshot: updated.customer_request_snapshot,
          compareSnapshot: updated.compare_snapshot,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
          publishedAt: updated.published_at,
        },
        publishState: {
          portalQuoteReviewId: context.review.id,
          currentPublishedVersionNumber: context.currentVersion ? Number(context.currentVersion.version_number ?? 0) || null : null,
          currentPublishedDealerMessage: context.currentVersion && typeof context.currentVersion.dealer_message === "string" ? context.currentVersion.dealer_message : null,
          currentPublishedRevisionSummary: context.currentVersion && typeof context.currentVersion.revision_summary === "string" ? context.currentVersion.revision_summary : null,
          latestCustomerRequestSnapshot: context.review.counter_notes ?? null,
          publicationStatus: "awaiting_approval",
        },
      }, origin);
    }

    if (action === "return-to-draft" && url.pathname.includes("/portal-revision/")) {
      if (!canPublish) return safeJsonError("Returning revisions to draft requires manager or owner role", 403, origin);
      if (!body.deal_id) return safeJsonError("deal_id required", 400, origin);
      const context = await getPortalReviewContext(String(body.deal_id));
      if (!context?.draft) return safeJsonError("No portal revision draft found", 404, origin);

      const { data: updated, error } = await supabase
        .from("portal_quote_revision_drafts")
        .update({ status: "draft" })
        .eq("id", context.draft.id)
        .select()
        .single();
      if (error) return safeJsonError("Failed to return revision to draft", 500, origin);

      return safeJsonOk({
        draft: {
          id: updated.id,
          portalQuoteReviewId: updated.portal_quote_review_id,
          quotePackageId: updated.quote_package_id,
          dealId: updated.deal_id,
          preparedBy: updated.prepared_by,
          approvedBy: updated.approved_by,
          status: updated.status,
          quoteData: updated.quote_data,
          quotePdfUrl: updated.quote_pdf_url,
          dealerMessage: updated.dealer_message,
          revisionSummary: updated.revision_summary,
          customerRequestSnapshot: updated.customer_request_snapshot,
          compareSnapshot: updated.compare_snapshot,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
          publishedAt: updated.published_at,
        },
        publishState: {
          portalQuoteReviewId: context.review.id,
          currentPublishedVersionNumber: context.currentVersion ? Number(context.currentVersion.version_number ?? 0) || null : null,
          currentPublishedDealerMessage: context.currentVersion && typeof context.currentVersion.dealer_message === "string" ? context.currentVersion.dealer_message : null,
          currentPublishedRevisionSummary: context.currentVersion && typeof context.currentVersion.revision_summary === "string" ? context.currentVersion.revision_summary : null,
          latestCustomerRequestSnapshot: context.review.counter_notes ?? null,
          publicationStatus: "draft_revision",
        },
      }, origin);
    }

    if (action === "publish" && url.pathname.includes("/portal-revision/")) {
      if (!canPublish) return safeJsonError("Publishing portal revisions requires manager or owner role", 403, origin);
      if (!body.deal_id) return safeJsonError("deal_id required", 400, origin);
      const context = await getPortalReviewContext(String(body.deal_id));
      if (!context?.draft) return safeJsonError("No portal revision draft found", 404, origin);

      const activeDraftStatus = String(context.draft.status ?? "");
      if (!["draft", "awaiting_approval"].includes(activeDraftStatus)) {
        return safeJsonError("Only draft or awaiting-approval revisions can be published", 400, origin);
      }

      const { error: publishErr } = await supabase
        .from("portal_quote_reviews")
        .update({
          quote_data: context.draft.quote_data,
          quote_pdf_url: context.draft.quote_pdf_url,
          status: "sent",
          viewed_at: null,
          signed_at: null,
          signer_name: null,
          signature_url: null,
          signer_ip: null,
          counter_notes: context.draft.customer_request_snapshot ?? context.review.counter_notes ?? null,
        })
        .eq("id", context.review.id);
      if (publishErr) return safeJsonError("Failed to publish portal revision", 500, origin);

      const { error: draftUpdateErr } = await supabase
        .from("portal_quote_revision_drafts")
        .update({
          status: "published",
          approved_by: user.id,
          published_at: new Date().toISOString(),
        })
        .eq("id", context.draft.id);
      if (draftUpdateErr) return safeJsonError("Failed to finalize portal revision draft", 500, origin);

      return safeJsonOk({
        draft: null,
        publishState: {
          portalQuoteReviewId: context.review.id,
          currentPublishedVersionNumber: context.currentVersion ? Number(context.currentVersion.version_number ?? 0) + 1 : 1,
          currentPublishedDealerMessage: typeof context.draft.dealer_message === "string" ? context.draft.dealer_message : null,
          currentPublishedRevisionSummary: typeof context.draft.revision_summary === "string" ? context.draft.revision_summary : null,
          latestCustomerRequestSnapshot: context.review.counter_notes ?? null,
          publicationStatus: "published",
        },
      }, origin);
    }

    // ── POST /save: Save quote package ───────────────────────────────────
    if (action === "save") {
      const customerName = typeof body.customer_name === "string" ? body.customer_name.trim().slice(0, 200) : null;
      const customerCompany = typeof body.customer_company === "string" ? body.customer_company.trim().slice(0, 200) : null;
      const customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim().slice(0, 30) : null;
      const customerEmail = typeof body.customer_email === "string" ? body.customer_email.trim().slice(0, 200) : null;
      const contactId = typeof body.contact_id === "string" ? body.contact_id : null;
      const companyId = typeof body.company_id === "string" ? body.company_id : null;
      const equipment = Array.isArray(body.equipment) ? body.equipment : [];

      if (equipment.length === 0) {
        return safeJsonError("At least one equipment line is required", 400, origin);
      }
      if (!customerName && !customerCompany && !contactId && !companyId) {
        return safeJsonError("Customer or prospect identity is required", 400, origin);
      }

      // Slice 09 CP2: accept optional originating_log_id so the AI Request
      // Log time-to-quote column can join this quote back to the request
      // that led to it. Defensive typing — only persist when it's a uuid.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const rawLogId = typeof body.originating_log_id === "string" ? body.originating_log_id : null;
      const originatingLogId = rawLogId && UUID_RE.test(rawLogId) ? rawLogId : null;

      // Slice 20e: win-probability snapshot. We store the client-computed
      // rule-based scorer result alongside the quote. Defensive validation:
      // accept only a JSON object with an integer `score` in [0,100] and a
      // known `band`; malformed snapshots are ignored.
      //
      // CRITICAL — only build the upsert patch when we have a valid snapshot.
      // Otherwise we skip the two snapshot columns entirely so a resave
      // that lacks a snapshot (portal revision path, retry, transient
      // scorer failure) preserves the previously-persisted values rather
      // than wiping them to null.
      const rawSnap = body.win_probability_snapshot;
      let winProbabilityPatch: { win_probability_snapshot: Record<string, unknown>; win_probability_score: number } | null = null;
      if (rawSnap && typeof rawSnap === "object" && !Array.isArray(rawSnap)) {
        const s = (rawSnap as { score?: unknown }).score;
        const b = (rawSnap as { band?: unknown }).band;
        const validBand = typeof b === "string" && ["strong", "healthy", "mixed", "at_risk"].includes(b);
        // Integer-only score to match the client contract + the smallint
        // column. Floats are rejected rather than silently rounded so a
        // buggy scorer doesn't corrupt the training set.
        if (typeof s === "number" && Number.isInteger(s) && s >= 0 && s <= 100 && validBand) {
          winProbabilityPatch = {
            win_probability_snapshot: rawSnap as Record<string, unknown>,
            win_probability_score: s,
          };
        }
      }

      let resolvedDealId = typeof body.deal_id === "string" && body.deal_id.length > 0
        ? body.deal_id
        : null;
      if (!resolvedDealId) {
        try {
          resolvedDealId = await createDraftDealForQuote({
            supabase,
            userId: user.id,
            customerName,
            customerCompany,
            contactId,
            companyId,
            amount: clampCurrency(body.net_total),
          });
        } catch (err) {
          console.error("quote save draft deal error:", err);
          return safeJsonError(
            err instanceof Error ? err.message : "Failed to create draft CRM deal",
            500,
            origin,
          );
        }
      }

      const admin = createAdminClient();
      const { data: existingQuote, error: existingQuoteErr } = await admin
        .from("quote_packages")
        .select("id, workspace_id, status")
        .eq("deal_id", resolvedDealId)
        .maybeSingle();
      if (existingQuoteErr) {
        return safeJsonError(existingQuoteErr.message, 500, origin);
      }

      const latestVersion = existingQuote?.id
        ? await getLatestQuotePackageVersion({
          admin,
          quotePackageId: String(existingQuote.id),
        })
        : null;
      const latestApprovalCase = existingQuote?.id
        ? await getLatestQuoteApprovalCase({
          admin,
          quotePackageId: String(existingQuote.id),
        })
        : null;

      const provisionalStatus = typeof existingQuote?.status === "string"
        ? existingQuote.status
        : typeof body.status === "string"
          ? body.status
          : "draft";
      const provisionalArtifacts = buildQuoteVersionArtifacts({
        body: {
          ...body,
          customer_name: customerName,
          customer_company: customerCompany,
          customer_phone: customerPhone,
          customer_email: customerEmail,
        },
        quotePackageId: typeof existingQuote?.id === "string" ? existingQuote.id : null,
        dealId: resolvedDealId,
        status: provisionalStatus,
      });

      const changedScopes = latestVersion
        ? diffQuoteVersionScopes(latestVersion.snapshot, provisionalArtifacts.snapshot)
        : (["branch", "customer", "pricing", "trade", "cash_down", "finance", "attachments", "equipment"] as const);

      let nextStatus = provisionalStatus;
      let invalidationReason: string | null = null;
      if (!latestVersion) {
        nextStatus = "draft";
      } else if (changedScopes.length === 0) {
        nextStatus = provisionalStatus;
      } else if (latestApprovalCase && typeof latestApprovalCase.status === "string") {
        const caseStatus = String(latestApprovalCase.status);
        if (caseStatus === "approved_with_conditions") {
          const conditions = await getQuoteApprovalConditions({
            admin,
            approvalCaseId: String(latestApprovalCase.id),
          });
          const allowedScopes = allowedQuoteVersionScopesForConditions(conditions);
          const disallowedScopes = changedScopes.filter((scope) => !allowedScopes.includes(scope));
          if (disallowedScopes.length === 0) {
            nextStatus = "approved_with_conditions";
          } else {
            nextStatus = "draft";
            invalidationReason = `Quote changed outside allowed conditional scopes: ${disallowedScopes.join(", ")}.`;
          }
        } else if (["pending", "approved", "changes_requested", "rejected", "escalated"].includes(caseStatus)) {
          nextStatus = "draft";
          invalidationReason = `Quote changed after approval state ${caseStatus}. A new approval submission is required.`;
        } else {
          nextStatus = "draft";
        }
      } else {
        nextStatus = "draft";
      }

      const { data, error } = await supabase
        .from("quote_packages")
        .upsert({
          workspace_id: userWorkspaceId,
          deal_id: resolvedDealId,
          contact_id: contactId,
          equipment,
          attachments_included: body.attachments_included || [],
          trade_in_valuation_id: body.trade_in_valuation_id,
          trade_allowance: body.trade_allowance,
          financing_scenarios: body.financing_scenarios || [],
          equipment_total: body.equipment_total || 0,
          attachment_total: body.attachment_total || 0,
          subtotal: body.subtotal || 0,
          branch_slug: typeof body.branch_slug === "string" ? body.branch_slug : null,
          commercial_discount_type: typeof body.commercial_discount_type === "string" ? body.commercial_discount_type : "flat",
          commercial_discount_value: body.commercial_discount_value || 0,
          discount_total: body.discount_total || 0,
          trade_credit: body.trade_credit || 0,
          net_total: body.net_total || 0,
          tax_total: body.tax_total || 0,
          cash_down: body.cash_down || 0,
          amount_financed: body.amount_financed || 0,
          tax_profile: typeof body.tax_profile === "string" ? body.tax_profile : "standard",
          selected_finance_scenario: typeof body.selected_finance_scenario === "string" ? body.selected_finance_scenario : null,
          margin_amount: body.margin_amount,
          margin_pct: body.margin_pct,
          ai_recommendation: body.ai_recommendation,
          entry_mode: body.entry_mode || "manual",
          status: nextStatus,
          created_by: user.id,
          customer_name: customerName,
          customer_company: customerCompany,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          originating_log_id: originatingLogId,
          // Only include snapshot keys when the client supplied a valid
          // one — omitting them lets the upsert preserve the prior values
          // on update instead of nulling them.
          ...(winProbabilityPatch ?? {}),
        }, { onConflict: "deal_id" })
        .select()
        .single();

      if (error) {
        console.error("quote save error:", error);
        // Surface the DB-layer detail to the rep so save failures (missing
        // branch, RLS denial, FK violation, NOT NULL on a new column) are
        // diagnosable from the UI instead of a generic "try again" that
        // forces a dev to open Supabase logs to see what actually broke.
        const detail = typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "Failed to save quote";
        return safeJsonError(detail, 500, origin);
      }

      const workspaceId = typeof data.workspace_id === "string" ? data.workspace_id : "default";
      const versionArtifacts = buildQuoteVersionArtifacts({
        body: {
          ...body,
          customer_name: customerName,
          customer_company: customerCompany,
          customer_phone: customerPhone,
          customer_email: customerEmail,
        },
        quotePackageId: String(data.id),
        dealId: resolvedDealId,
        status: nextStatus,
      });

      let latestVersionInfo = latestVersion;
      if (!latestVersion || changedScopes.length > 0) {
        latestVersionInfo = {
          id: (await createQuotePackageVersion({
            admin,
            workspaceId,
            quotePackageId: String(data.id),
            createdBy: user.id,
            snapshot: versionArtifacts.snapshot,
            computedMetrics: versionArtifacts.computedMetrics,
          })).id,
          versionNumber: (await getLatestQuotePackageVersion({
            admin,
            quotePackageId: String(data.id),
          }))?.versionNumber ?? 1,
          snapshot: versionArtifacts.snapshot,
        };
      }

      if (invalidationReason && latestApprovalCase?.id) {
        await invalidateQuoteApprovalCase({
          admin,
          caseId: String(latestApprovalCase.id),
          flowApprovalId: typeof latestApprovalCase.flow_approval_id === "string" ? latestApprovalCase.flow_approval_id : null,
          reason: invalidationReason,
        });
      }

      return safeJsonOk({
        quote: data,
        deal_id: resolvedDealId,
        quote_package_version_id: latestVersionInfo?.id ?? null,
        version_number: latestVersionInfo?.versionNumber ?? null,
      }, origin, 201);
    }

    // ── POST /mark-viewed: sent → viewed transition (Slice 2.1h) ──────
    // Called by the portal the first time a customer opens a quote. Safe
    // to call multiple times; only transitions on the first call.
    if (action === "mark-viewed") {
      if (!body.quote_package_id) {
        return safeJsonError("quote_package_id required", 400, origin);
      }

      const { data: pkg, error: pkgErr } = await supabase
        .from("quote_packages")
        .select("id, status, viewed_at")
        .eq("id", body.quote_package_id)
        .maybeSingle();

      if (pkgErr) return safeJsonError("Failed to load quote package", 500, origin);
      if (!pkg) return safeJsonError("Quote package not found", 404, origin);

      // Only flip when we are at `sent` and haven't already viewed.
      const row = pkg as { id: string; status: string; viewed_at: string | null };
      if (row.viewed_at) {
        return safeJsonOk({ already_viewed: true, viewed_at: row.viewed_at }, origin);
      }
      if (row.status !== "sent") {
        return safeJsonOk({ already_viewed: false, status: row.status }, origin);
      }

      const nowIso = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from("quote_packages")
        .update({ status: "viewed", viewed_at: nowIso })
        .eq("id", body.quote_package_id)
        .eq("status", "sent"); // race-safe: only transition from sent

      if (updateErr) return safeJsonError("Failed to mark viewed", 500, origin);
      return safeJsonOk({ already_viewed: false, status: "viewed", viewed_at: nowIso }, origin);
    }

    // ── POST /submit-approval: route quote to sales manager ───────────
    if (action === "submit-approval") {
      if (!body.quote_package_id) {
        return safeJsonError("quote_package_id required", 400, origin);
      }
      if (!canRevise) {
        return safeJsonError("Quote approval submission requires rep, manager, or owner role", 403, origin);
      }

      const { data: pkg, error: pkgErr } = await supabase
        .from("quote_packages")
        .select("id, workspace_id, branch_slug, quote_number, deal_id, customer_name, customer_company, net_total, margin_pct, status")
        .eq("id", body.quote_package_id)
        .maybeSingle();

      if (pkgErr) return safeJsonError("Failed to load quote package", 500, origin);
      if (!pkg) return safeJsonError("Quote package not found", 404, origin);

      const pkgRow = pkg as {
        id: string;
        workspace_id: string;
        branch_slug: string | null;
        quote_number: string | null;
        deal_id: string;
        customer_name: string | null;
        customer_company: string | null;
        net_total: number | null;
        margin_pct: number | null;
        status: string;
      };

      const admin = createAdminClient();
      const latestVersion = await getLatestQuotePackageVersion({
        admin,
        quotePackageId: pkgRow.id,
      });
      if (!latestVersion) {
        return safeJsonError("Save the quote before submitting it for approval.", 409, origin);
      }

      const latestCase = await getLatestQuoteApprovalCase({
        admin,
        quotePackageId: pkgRow.id,
      });

      if (latestCase && ["pending", "escalated"].includes(String(latestCase.status ?? ""))) {
        const summary = await buildQuoteApprovalCaseResponse({
          admin,
          approvalCase: latestCase,
        });
        return safeJsonOk({
          approval_case_id: summary.id,
          approval_id: summary.flowApprovalId,
          quote_package_version_id: summary.quotePackageVersionId,
          version_number: summary.versionNumber,
          status: "pending_approval",
          already_pending: true,
          branch_name: summary.branchName,
          assigned_to_name: summary.assignedToName,
          route_mode: summary.routeMode,
        }, origin);
      }

      if (pkgRow.status === "sent" || pkgRow.status === "accepted") {
        return safeJsonError("Only unsent quotes can be submitted for approval.", 409, origin);
      }
      const workflowId = await ensureQuoteApprovalWorkflow(admin);
      const policy = await loadQuoteApprovalPolicy({
        admin,
        workspaceId: pkgRow.workspace_id || "default",
      });
      const authorityBand = resolveQuoteApprovalAuthorityBand({
        marginPct: pkgRow.margin_pct,
        amount: pkgRow.net_total,
        policy,
      });
      const approvalRoute = await resolveQuoteApprovalAssignee({
        admin,
        workspaceId: pkgRow.workspace_id || "default",
        branchSlug: pkgRow.branch_slug ?? null,
        authorityBand,
        ownerEscalationRole: policy.ownerEscalationRole,
        namedBranchSalesManagerPrimary: policy.namedBranchSalesManagerPrimary,
        namedBranchGeneralManagerFallback: policy.namedBranchGeneralManagerFallback,
      });
      const { data: submitterProfile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      const { data: runRow, error: runErr } = await admin
        .from("flow_workflow_runs")
        .insert({
          workspace_id: pkgRow.workspace_id || "default",
          workflow_id: workflowId,
          workflow_slug: QUOTE_APPROVAL_WORKFLOW_SLUG,
          status: "running",
          dry_run: false,
          resolved_context: {
            quote_package_id: pkgRow.id,
            quote_package_version_id: latestVersion.id,
            version_number: latestVersion.versionNumber,
            deal_id: pkgRow.deal_id,
            customer_name: pkgRow.customer_name,
            customer_company: pkgRow.customer_company,
            net_total: pkgRow.net_total,
            margin_pct: pkgRow.margin_pct,
            branch_slug: approvalRoute.branchSlug,
            branch_name: approvalRoute.branchName,
          },
          metadata: {
            source: "quote_builder_v2",
            submitted_by: user.id,
            quote_package_id: pkgRow.id,
            quote_package_version_id: latestVersion.id,
            authority_band: authorityBand,
          },
        })
        .select("id")
        .single();

      if (runErr || !runRow?.id) {
        return safeJsonError(runErr?.message ?? "Failed to create approval flow run", 500, origin);
      }

      const customerLabel = pkgRow.customer_company || pkgRow.customer_name || "Quote";
      const marginLabel = Number.isFinite(Number(pkgRow.margin_pct))
        ? `Margin ${Number(pkgRow.margin_pct).toFixed(1)}%`
        : "Margin review required";
      const totalLabel = Number.isFinite(Number(pkgRow.net_total))
        ? `$${Number(pkgRow.net_total).toLocaleString()}`
        : "amount unavailable";
      const routeLabel = approvalRoute.assignedToName
        ? `${approvalRoute.assignedToName} (${approvalRoute.branchName})`
        : `${approvalRoute.branchName} manager queue`;

      const { data: approvalId, error: approvalErr } = await admin.rpc("request_flow_approval", {
        p_run_id: runRow.id,
        p_step_id: null,
        p_workflow_slug: QUOTE_APPROVAL_WORKFLOW_SLUG,
        p_subject: pkgRow.quote_number
          ? `Quote ${pkgRow.quote_number} needs sales manager approval`
          : `${customerLabel} quote needs sales manager approval`,
        p_detail: `${marginLabel} · ${totalLabel}. Routed to ${routeLabel}. Review the quote before it can be sent to the customer.`,
        p_assigned_role: approvalRoute.assignedRole,
        p_assigned_to: approvalRoute.assignedTo,
        p_due_in_hours: 24,
        p_escalate_in_hours: 48,
        p_context_summary: {
          type: "quote_approval",
          quote_package_id: pkgRow.id,
          deal_id: pkgRow.deal_id,
          quote_number: pkgRow.quote_number,
          branch_slug: approvalRoute.branchSlug,
          branch_name: approvalRoute.branchName,
          customer_name: pkgRow.customer_name,
          customer_company: pkgRow.customer_company,
          net_total: pkgRow.net_total,
          margin_pct: pkgRow.margin_pct,
          assigned_to: approvalRoute.assignedTo,
          assigned_to_name: approvalRoute.assignedToName,
          assigned_role: approvalRoute.assignedRole,
          route_mode: approvalRoute.routeMode,
        },
      });

      if (approvalErr || !approvalId) {
        await admin
          .from("flow_workflow_runs")
          .update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
            error_text: approvalErr?.message ?? "request_flow_approval failed",
          })
          .eq("id", runRow.id);
        return safeJsonError(approvalErr?.message ?? "Failed to request approval", 500, origin);
      }

      const dueAt = new Date(Date.now() + policy.submitSlaHours * 60 * 60 * 1000).toISOString();
      const escalateAt = new Date(Date.now() + policy.escalationSlaHours * 60 * 60 * 1000).toISOString();
      const reasonSummary = buildQuoteApprovalReasonSummary({
        policy,
        marginPct: pkgRow.margin_pct,
        amount: pkgRow.net_total,
        authorityBand,
      });

      const { data: approvalCase, error: approvalCaseErr } = await admin
        .from("quote_approval_cases")
        .insert({
          workspace_id: pkgRow.workspace_id || "default",
          quote_package_id: pkgRow.id,
          quote_package_version_id: latestVersion.id,
          version_number: latestVersion.versionNumber,
          deal_id: pkgRow.deal_id,
          quote_number: pkgRow.quote_number,
          branch_slug: approvalRoute.branchSlug,
          branch_name: approvalRoute.branchName,
          customer_name: pkgRow.customer_name,
          customer_company: pkgRow.customer_company,
          net_total: pkgRow.net_total,
          margin_pct: pkgRow.margin_pct,
          submitted_by: user.id,
          submitted_by_name: typeof submitterProfile?.full_name === "string" ? submitterProfile.full_name : null,
          assigned_to: approvalRoute.assignedTo,
          assigned_to_name: approvalRoute.assignedToName,
          assigned_role: approvalRoute.assignedRole,
          route_mode: approvalRoute.routeMode,
          policy_snapshot_json: policy,
          reason_summary_json: reasonSummary,
          status: "pending",
          due_at: dueAt,
          escalate_at: escalateAt,
          flow_approval_id: approvalId,
        })
        .select("*")
        .single();

      if (approvalCaseErr || !approvalCase?.id) {
        await admin
          .from("flow_workflow_runs")
          .update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
            error_text: approvalCaseErr?.message ?? "quote approval case creation failed",
          })
          .eq("id", runRow.id);
        return safeJsonError(approvalCaseErr?.message ?? "Failed to create quote approval case", 500, origin);
      }

      const { error: statusErr } = await supabase
        .from("quote_packages")
        .update({ status: "pending_approval" })
        .eq("id", body.quote_package_id);

      if (statusErr) return safeJsonError(statusErr.message, 500, origin);

      return safeJsonOk({
        approval_case_id: approvalCase.id,
        approval_id: approvalId,
        quote_package_version_id: latestVersion.id,
        version_number: latestVersion.versionNumber,
        status: "pending_approval",
        branch_name: approvalRoute.branchName,
        assigned_to_name: approvalRoute.assignedToName,
        route_mode: approvalRoute.routeMode,
      }, origin);
    }

    if (action === "approval-policy") {
      if (!canPublish) {
        return safeJsonError("Quote approval policy access requires admin, manager, or owner role", 403, origin);
      }
      const admin = createAdminClient();
      const existing = await loadQuoteApprovalPolicy({
        admin,
        workspaceId: "default",
      });
      const allowedConditionTypes = Array.isArray(body.allowed_condition_types)
        ? body.allowed_condition_types.filter((value: unknown): value is QuoteApprovalConditionType =>
          typeof value === "string" && isQuoteApprovalConditionType(value))
        : existing.allowedConditionTypes;
      const nextPolicy: QuoteApprovalPolicy = {
        workspaceId: "default",
        branchManagerMinMarginPct: Number(body.branch_manager_min_margin_pct ?? existing.branchManagerMinMarginPct) || existing.branchManagerMinMarginPct,
        standardMarginFloorPct: Number(body.standard_margin_floor_pct ?? existing.standardMarginFloorPct) || existing.standardMarginFloorPct,
        branchManagerMaxQuoteAmount: Number(body.branch_manager_max_quote_amount ?? existing.branchManagerMaxQuoteAmount) || existing.branchManagerMaxQuoteAmount,
        submitSlaHours: Number(body.submit_sla_hours ?? existing.submitSlaHours) || existing.submitSlaHours,
        escalationSlaHours: Number(body.escalation_sla_hours ?? existing.escalationSlaHours) || existing.escalationSlaHours,
        ownerEscalationRole: body.owner_escalation_role === "admin" ? "admin" : existing.ownerEscalationRole,
        namedBranchSalesManagerPrimary: body.named_branch_sales_manager_primary == null
          ? existing.namedBranchSalesManagerPrimary
          : body.named_branch_sales_manager_primary === true,
        namedBranchGeneralManagerFallback: body.named_branch_general_manager_fallback == null
          ? existing.namedBranchGeneralManagerFallback
          : body.named_branch_general_manager_fallback === true,
        allowedConditionTypes: allowedConditionTypes.length > 0 ? allowedConditionTypes : existing.allowedConditionTypes,
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
      };

      const { error: policyErr } = await admin
        .from("quote_approval_policies")
        .upsert({
          workspace_id: nextPolicy.workspaceId,
          branch_manager_min_margin_pct: nextPolicy.branchManagerMinMarginPct,
          standard_margin_floor_pct: nextPolicy.standardMarginFloorPct,
          branch_manager_max_quote_amount: nextPolicy.branchManagerMaxQuoteAmount,
          submit_sla_hours: nextPolicy.submitSlaHours,
          escalation_sla_hours: nextPolicy.escalationSlaHours,
          owner_escalation_role: nextPolicy.ownerEscalationRole,
          named_branch_sales_manager_primary: nextPolicy.namedBranchSalesManagerPrimary,
          named_branch_general_manager_fallback: nextPolicy.namedBranchGeneralManagerFallback,
          allowed_condition_types: nextPolicy.allowedConditionTypes,
          updated_by: user.id,
        }, { onConflict: "workspace_id" });
      if (policyErr) return safeJsonError(policyErr.message, 500, origin);
      return safeJsonOk({ policy: nextPolicy }, origin);
    }

    if (action === "decide-approval-case" && req.method === "POST") {
      if (!canPublish) {
        return safeJsonError("Quote approval decisions require admin, manager, or owner role", 403, origin);
      }
      if (typeof body.approval_case_id !== "string" || body.approval_case_id.length === 0) {
        return safeJsonError("approval_case_id required", 400, origin);
      }
      if (typeof body.decision !== "string" || !isQuoteApprovalDecision(body.decision)) {
        return safeJsonError("A valid decision is required", 400, origin);
      }

      const admin = createAdminClient();
      const { data: caseRow, error: caseErr } = await admin
        .from("quote_approval_cases")
        .select("*")
        .eq("id", body.approval_case_id)
        .maybeSingle();
      if (caseErr) return safeJsonError(caseErr.message, 500, origin);
      if (!caseRow?.id) return safeJsonError("Quote approval case not found", 404, origin);
      if (!["pending", "escalated"].includes(String(caseRow.status ?? ""))) {
        return safeJsonError("This approval case is no longer awaiting a decision.", 409, origin);
      }

      const policy = await loadQuoteApprovalPolicy({
        admin,
        workspaceId: typeof caseRow.workspace_id === "string" ? caseRow.workspace_id : "default",
      });
      const decision = body.decision as string;
      const decisionNote = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;
      const conditions = normalizeDecisionConditions({
        conditions: body.conditions,
        allowedConditionTypes: policy.allowedConditionTypes,
      });
      if (decision === "approved_with_conditions" && conditions.length === 0) {
        return safeJsonError("At least one structured condition is required for conditional approval.", 400, origin);
      }

      const { data: deciderProfile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const deciderName = typeof deciderProfile?.full_name === "string" ? deciderProfile.full_name : null;
      const nowIso = new Date().toISOString();

      if (decision === "escalated") {
        const approvalRoute = await resolveQuoteApprovalAssignee({
          admin,
          workspaceId: typeof caseRow.workspace_id === "string" ? caseRow.workspace_id : "default",
          branchSlug: typeof caseRow.branch_slug === "string" ? caseRow.branch_slug : null,
          authorityBand: "owner_admin",
          ownerEscalationRole: policy.ownerEscalationRole,
          namedBranchSalesManagerPrimary: policy.namedBranchSalesManagerPrimary,
          namedBranchGeneralManagerFallback: policy.namedBranchGeneralManagerFallback,
        });
        const { error: flowErr } = await admin
          .from("flow_approvals")
          .update({
            status: "escalated",
            assigned_to: approvalRoute.assignedTo,
            assigned_role: approvalRoute.assignedRole,
            decision_reason: decisionNote,
            due_at: new Date(Date.now() + policy.submitSlaHours * 60 * 60 * 1000).toISOString(),
            escalate_at: new Date(Date.now() + policy.escalationSlaHours * 60 * 60 * 1000).toISOString(),
            context_summary: {
              ...(caseRow.reason_summary_json && typeof caseRow.reason_summary_json === "object" ? caseRow.reason_summary_json : {}),
              quote_package_id: caseRow.quote_package_id,
              branch_slug: approvalRoute.branchSlug,
              branch_name: approvalRoute.branchName,
              assigned_to: approvalRoute.assignedTo,
              assigned_to_name: approvalRoute.assignedToName,
              assigned_role: approvalRoute.assignedRole,
              route_mode: approvalRoute.routeMode,
            },
          })
          .eq("id", caseRow.flow_approval_id);
        if (flowErr) return safeJsonError(flowErr.message, 500, origin);

        const { error: caseUpdateErr } = await admin
          .from("quote_approval_cases")
          .update({
            status: "escalated",
            decision_note: decisionNote,
            assigned_to: approvalRoute.assignedTo,
            assigned_to_name: approvalRoute.assignedToName,
            assigned_role: approvalRoute.assignedRole,
            route_mode: approvalRoute.routeMode,
            due_at: new Date(Date.now() + policy.submitSlaHours * 60 * 60 * 1000).toISOString(),
            escalate_at: new Date(Date.now() + policy.escalationSlaHours * 60 * 60 * 1000).toISOString(),
          })
          .eq("id", caseRow.id);
        if (caseUpdateErr) return safeJsonError(caseUpdateErr.message, 500, origin);

        const refreshedCase = await getLatestQuoteApprovalCase({
          admin,
          quotePackageId: String(caseRow.quote_package_id),
        });
        return safeJsonOk({
          approval_case: refreshedCase
            ? await buildQuoteApprovalCaseResponse({ admin, approvalCase: refreshedCase })
            : null,
        }, origin);
      }

      const nextCaseStatus = decision === "approved_with_conditions"
        ? "approved_with_conditions"
        : decision === "changes_requested"
          ? "changes_requested"
          : decision === "approved"
            ? "approved"
            : "rejected";

      await saveQuoteApprovalConditions({
        admin,
        approvalCaseId: String(caseRow.id),
        conditions: decision === "approved" || decision === "rejected" ? [] : conditions,
      });

      const { error: caseUpdateErr } = await admin
        .from("quote_approval_cases")
        .update({
          status: nextCaseStatus,
          decision_note: decisionNote,
          decided_by: user.id,
          decided_by_name: deciderName,
          decided_at: nowIso,
        })
        .eq("id", caseRow.id);
      if (caseUpdateErr) return safeJsonError(caseUpdateErr.message, 500, origin);

      const flowDecision = decision === "approved" || decision === "approved_with_conditions"
        ? "approved"
        : "rejected";
      if (typeof caseRow.flow_approval_id === "string") {
        const { error: flowErr } = await admin
          .from("flow_approvals")
          .update({
            status: flowDecision,
            decided_at: nowIso,
            decided_by: user.id,
            decision_reason: decisionNote,
          })
          .eq("id", caseRow.flow_approval_id);
        if (flowErr) return safeJsonError(flowErr.message, 500, origin);

        const { data: flowApprovalRow } = await admin
          .from("flow_approvals")
          .select("run_id")
          .eq("id", caseRow.flow_approval_id)
          .maybeSingle();
        if (flowApprovalRow?.run_id) {
          const { error: runErr } = await admin
            .from("flow_workflow_runs")
            .update({
              status: flowDecision === "approved" ? "succeeded" : "cancelled",
              finished_at: nowIso,
              metadata: {
                approval_case_id: caseRow.id,
                quote_decision: decision,
                decision_note: decisionNote,
              },
            })
            .eq("id", flowApprovalRow.run_id);
          if (runErr) return safeJsonError(runErr.message, 500, origin);
        }
      }

      const nextQuoteStatus = nextCaseStatus === "approved_with_conditions"
        ? "approved_with_conditions"
        : nextCaseStatus === "changes_requested"
          ? "changes_requested"
          : nextCaseStatus === "approved"
            ? "approved"
            : "rejected";
      const { error: quoteStatusErr } = await admin
        .from("quote_packages")
        .update({ status: nextQuoteStatus })
        .eq("id", caseRow.quote_package_id);
      if (quoteStatusErr) return safeJsonError(quoteStatusErr.message, 500, origin);

      const refreshedCase = await getLatestQuoteApprovalCase({
        admin,
        quotePackageId: String(caseRow.quote_package_id),
      });
      return safeJsonOk({
        approval_case: refreshedCase
          ? await buildQuoteApprovalCaseResponse({ admin, approvalCase: refreshedCase })
          : null,
      }, origin);
    }

    // ── POST /sign: Save quote signature ───────────────────────────────
    // State-machine guard (Slice 2.1h): the package must be in `sent` or
    // `viewed`. Signing from `draft` or `expired` is rejected so a
    // misconfigured UI can't short-circuit the send step.
    if (action === "sign") {
      if (!body.quote_package_id || !body.signer_name) {
        return safeJsonError("quote_package_id and signer_name required", 400, origin);
      }

      const signerName = String(body.signer_name).replace(/<[^>]*>/g, "").trim().slice(0, 100);
      if (!signerName) {
        return safeJsonError("signer_name cannot be empty", 400, origin);
      }

      const { data: pkg, error: pkgErr } = await supabase
        .from("quote_packages")
        .select("id, status, pdf_url, equipment, equipment_total, attachment_total, subtotal, trade_credit, net_total")
        .eq("id", body.quote_package_id)
        .maybeSingle();
      if (pkgErr) return safeJsonError("Failed to load quote package", 500, origin);
      if (!pkg) return safeJsonError("Quote package not found", 404, origin);

      const pkgRow = pkg as {
        id: string;
        status: string;
        pdf_url: string | null;
        equipment: unknown;
        equipment_total: number | null;
        attachment_total: number | null;
        subtotal: number | null;
        trade_credit: number | null;
        net_total: number | null;
      };

      if (!["sent", "viewed"].includes(pkgRow.status)) {
        return safeJsonError(
          `Cannot sign: quote must be sent or viewed (currently ${pkgRow.status}).`,
          409,
          origin,
        );
      }

      let signatureImageUrl: string | null = null;
      if (body.signature_png_base64 && typeof body.signature_png_base64 === "string") {
        const raw = String(body.signature_png_base64).replace(/\s/g, "");
        if (raw.length > 400_000) {
          return safeJsonError("signature image too large", 400, origin);
        }
        if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
          return safeJsonError("signature must be base64 PNG", 400, origin);
        }
        signatureImageUrl = `data:image/png;base64,${raw}`;
      }

      const signerIp = req.headers.get("cf-connecting-ip")
        || req.headers.get("x-real-ip")
        || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || "unknown";
      const signerUserAgent = req.headers.get("user-agent") ?? null;

      // Integrity seal: SHA-256 over the canonical quote content the signer
      // saw. Null-safe — we continue even if crypto.subtle is unavailable.
      const documentHash = await computeQuoteDocumentHash({
        quote_package_id: pkgRow.id,
        pdf_url: pkgRow.pdf_url,
        equipment: pkgRow.equipment,
        equipment_total: pkgRow.equipment_total,
        attachment_total: pkgRow.attachment_total,
        subtotal: pkgRow.subtotal,
        trade_credit: pkgRow.trade_credit,
        net_total: pkgRow.net_total,
      });

      const { data, error } = await supabase
        .from("quote_signatures")
        .insert({
          quote_package_id: body.quote_package_id,
          deal_id: body.deal_id ?? null,
          signer_name: signerName,
          signer_email: body.signer_email ?? null,
          signer_ip: signerIp,
          signer_user_agent: signerUserAgent,
          signature_image_url: signatureImageUrl,
          document_hash: documentHash,
        })
        .select()
        .single();

      if (error) {
        console.error("quote signature save error:", error);
        return safeJsonError("Failed to save signature", 500, origin);
      }

      await supabase
        .from("quote_packages")
        .update({ status: "accepted" })
        .eq("id", body.quote_package_id);

      return safeJsonOk({ signature: data, document_hash: documentHash }, origin, 201);
    }

    // ── POST /share: Issue or rotate the public deal-room token ───────
    // Rep-authenticated write that installs an opaque share_token on the
    // quote so the customer can load /q/:token without portal auth. A
    // second call on the same package rotates the token (old URL dies).
    if (action === "share") {
      if (!body.quote_package_id || typeof body.quote_package_id !== "string") {
        return safeJsonError("quote_package_id required", 400, origin);
      }
      // Verify the caller has write access via RLS — the normal user
      // client (not admin) would bounce off workspace/role policy. That
      // is the authorization check for issuing a share token.
      const { data: existing, error: loadErr } = await supabase
        .from("quote_packages")
        .select("id, workspace_id")
        .eq("id", body.quote_package_id)
        .maybeSingle();
      if (loadErr) return safeJsonError(loadErr.message, 500, origin);
      if (!existing) return safeJsonError("Quote package not found or not accessible", 404, origin);

      const token = generateShareToken();
      const admin = createAdminClient();
      const { error: updateErr } = await admin
        .from("quote_packages")
        .update({
          share_token: token,
          share_token_created_at: new Date().toISOString(),
        })
        .eq("id", body.quote_package_id);
      if (updateErr) {
        console.error("share token update error:", updateErr);
        return safeJsonError(updateErr.message || "Failed to issue share token", 500, origin);
      }

      return safeJsonOk({ token }, origin, 201);
    }

    // ── POST /send-package: Send quote to customer via email ──────────
    if (action === "send-package") {
      if (!body.quote_package_id) {
        return safeJsonError("quote_package_id required", 400, origin);
      }

      // Fetch quote package with contact email
      const { data: pkg, error: pkgErr } = await supabase
        .from("quote_packages")
        .select("id, deal_id, contact_id, equipment, equipment_total, net_total, trade_allowance, sent_at, status, margin_pct, crm_contacts(first_name, last_name, email)")
        .eq("id", body.quote_package_id)
        .single();

      if (pkgErr || !pkg) {
        return safeJsonError("Quote package not found", 404, origin);
      }

      // Resolve contact email
      const contact = Array.isArray(pkg.crm_contacts) ? pkg.crm_contacts[0] : pkg.crm_contacts;
      const toEmail = contact?.email;
      if (!toEmail) {
        return safeJsonError("No email address found for this contact. Update the contact record and try again.", 422, origin);
      }

      const quoteStatus = String(pkg.status ?? "draft");
      if (["pending_approval", "changes_requested", "rejected"].includes(quoteStatus)) {
        return safeJsonError(`This quote cannot be sent while status is ${quoteStatus}.`, 409, origin);
      }

      const admin = createAdminClient();
      const latestCase = await getLatestQuoteApprovalCase({
        admin,
        quotePackageId: String(pkg.id),
      });
      if (quoteStatus === "approved_with_conditions") {
        if (!latestCase) {
          return safeJsonError("Conditional approval metadata is missing. Re-submit the quote for approval.", 409, origin);
        }
        const latestVersion = await getLatestQuotePackageVersion({
          admin,
          quotePackageId: String(pkg.id),
        });
        if (!latestVersion) {
          return safeJsonError("Quote version snapshot missing for conditional approval.", 409, origin);
        }
        const conditions = await getQuoteApprovalConditions({
          admin,
          approvalCaseId: String(latestCase.id),
        });
        const evaluationResult = evaluateQuoteApprovalConditions({
          snapshot: latestVersion.snapshot,
          conditions,
          decidedAt: typeof latestCase.decided_at === "string" ? latestCase.decided_at : null,
          now: new Date().toISOString(),
        });
        if (!evaluationResult.allSatisfied) {
          return safeJsonError("This quote still has unmet approval conditions and cannot be sent.", 409, origin);
        }
      } else if (typeof pkg.margin_pct === "number" && pkg.margin_pct < 10 && quoteStatus !== "approved") {
        return safeJsonError("Submit this quote for manager approval before sending it.", 409, origin);
      }

      // Compose email body
      const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "Valued Customer";
      const equipmentList = Array.isArray(pkg.equipment)
        ? (pkg.equipment as Array<{ make?: string; model?: string; price?: number }>)
          .map((e) => `  - ${e.make ?? ""} ${e.model ?? ""}: $${((e.price ?? 0)).toLocaleString()}`)
          .join("\n")
        : "  (Equipment details in attached proposal)";

      const netTotal = typeof pkg.net_total === "number" ? `$${pkg.net_total.toLocaleString()}` : "See attached proposal";

      const emailBody = [
        `Dear ${contactName},`,
        "",
        "Thank you for your interest. Please find our equipment proposal below:",
        "",
        "Equipment:",
        equipmentList,
        "",
        `Total: ${netTotal}`,
        pkg.trade_allowance ? `Trade-In Allowance: $${Number(pkg.trade_allowance).toLocaleString()}` : null,
        "",
        "This proposal is valid for 30 days. Please don't hesitate to reach out with any questions.",
        "",
        "Best regards,",
        "Quality Equipment & Parts",
      ].filter((line) => line !== null).join("\n");

      // Send via Resend
      const result = await sendResendEmail({
        to: toEmail,
        subject: `Equipment Proposal from Quality Equipment & Parts`,
        text: emailBody,
      });

      if (result.skipped) {
        return safeJsonError("Email service not configured. Set RESEND_API_KEY.", 503, origin);
      }
      if (!result.ok) {
        return safeJsonError("Email delivery failed", 502, origin);
      }

      // Update quote package status
      await supabase
        .from("quote_packages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sent_via: "email",
        })
        .eq("id", body.quote_package_id);

      console.log(`[quote-builder-v2] sent package ${body.quote_package_id} to ${toEmail}`);
      return safeJsonOk({ sent: true, to_email: toEmail }, origin);
    }

    return safeJsonError("Unknown action", 400, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "quote-builder-v2", req });
    console.error("quote-builder-v2 error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
