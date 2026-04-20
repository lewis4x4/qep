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
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

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
  alternative?: { machine: string; attachments: string[]; reasoning: string } | null;
  jobConsiderations?: string[] | null;
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
          content: `You are an equipment specialist for QEP, a heavy equipment dealership. Given a job description, recommend the optimal machine and attachments from the available inventory. Also provide an alternative recommendation and key job considerations.

Return JSON:
{
  "machine": "Make Model",
  "attachments": ["Attachment 1", "Attachment 2"],
  "reasoning": "2-3 sentence explanation of why this is the optimal choice",
  "alternative": { "machine": "Make Model", "attachments": ["Attachment"], "reasoning": "Why this is a good alternative" },
  "jobConsiderations": ["Key consideration 1", "Key consideration 2"]
}

If no good alternative exists, set alternative to null. Keep jobConsiderations to 2-3 practical notes about the job requirements.`,
        }, {
          role: "user",
          content: `Job description: ${jobDescription}\n\nAvailable equipment:\n${catalogSummary || "No catalog entries — provide general recommendation."}`,
        }],
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return { machine: "", attachments: [], reasoning: "AI recommendation failed." };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { machine: "", attachments: [], reasoning: "No recommendation generated." };
    const parsed = JSON.parse(content);
    return {
      machine: parsed.machine ?? "",
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
      reasoning: parsed.reasoning ?? "",
      alternative: parsed.alternative ?? null,
      jobConsiderations: Array.isArray(parsed.jobConsiderations) ? parsed.jobConsiderations : null,
    };
  } catch {
    return { machine: "", attachments: [], reasoning: "AI recommendation error — select manually." };
  }
}

function calculateFinancingScenarios(
  totalAmount: number,
  rates: Array<{ term_months: number; apr: number; lender_name: string; loan_type: string }>,
): Array<{ type: string; term_months: number; rate: number; monthly_payment: number; total_cost: number; lender: string }> {
  const scenarios: Array<{ type: string; term_months: number; rate: number; monthly_payment: number; total_cost: number; lender: string }> = [];

  // Cash scenario
  scenarios.push({
    type: "cash",
    term_months: 0,
    rate: 0,
    monthly_payment: 0,
    total_cost: totalAmount,
    lender: "Cash",
  });

  // Finance scenario (60-month, best rate)
  const financeRate = rates.find((r) => r.term_months === 60 && r.loan_type === "finance") || rates[0];
  if (financeRate) {
    const monthlyRate = financeRate.apr / 100 / 12;
    const months = financeRate.term_months || 60;
    const payment = monthlyRate > 0
      ? (totalAmount * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
      : totalAmount / months;
    scenarios.push({
      type: "finance",
      term_months: months,
      rate: financeRate.apr,
      monthly_payment: Math.round(payment * 100) / 100,
      total_cost: Math.round(payment * months * 100) / 100,
      lender: financeRate.lender_name,
    });
  }

  // Lease scenario (48-month)
  const leaseRate = rates.find((r) => r.term_months === 48 && r.loan_type === "lease") || rates.find((r) => r.loan_type === "lease");
  if (leaseRate) {
    const monthlyRate = leaseRate.apr / 100 / 12;
    const months = leaseRate.term_months || 48;
    const residual = totalAmount * 0.25; // 25% residual
    const payment = monthlyRate > 0
      ? ((totalAmount - residual) * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
      : (totalAmount - residual) / months;
    scenarios.push({
      type: "lease",
      term_months: months,
      rate: leaseRate.apr,
      monthly_payment: Math.round(payment * 100) / 100,
      total_cost: Math.round((payment * months + residual) * 100) / 100,
      lender: leaseRate.lender_name,
    });
  }

  return scenarios;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();
    const userRole = typeof profile?.role === "string" ? profile.role : null;
    const canRevise = userRole !== null && ["rep", "manager", "owner"].includes(userRole);
    const canPublish = userRole !== null && ["manager", "owner"].includes(userRole);

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
          .select("id, quote_number, customer_name, customer_company, status, net_total, equipment, entry_mode, created_at")
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

      const dealId = url.searchParams.get("deal_id");
      if (!dealId) return safeJsonError("deal_id required", 400, origin);

      const { data, error } = await supabase
        .from("quote_packages")
        .select("*, quote_signatures(*)")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

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

      // Fetch available catalog — yard stock first (inventory-first logic)
      const { data: catalog } = await supabase
        .from("catalog_entries")
        .select("id, make, model, year, category, list_price, dealer_cost, cost_to_qep, source_location, is_yard_stock, attachments")
        .eq("is_available", true)
        .order("is_yard_stock", { ascending: false, nullsFirst: false })
        .limit(50);

      const recommendation = await aiEquipmentRecommendation(
        body.job_description,
        catalog ?? [],
      );

      return safeJsonOk({ recommendation }, origin);
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
      if (!body.total_amount || body.total_amount <= 0) {
        return safeJsonError("total_amount must be positive", 400, origin);
      }

      const { data: rates } = await supabase
        .from("financing_rate_matrix")
        .select("term_months, apr, lender_name, loan_type")
        .eq("is_active", true);

      const scenarios = calculateFinancingScenarios(
        body.total_amount,
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
          estimatedSavings = body.total_amount * (discountValue / 100);
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
      if (!body.deal_id) {
        return safeJsonError("deal_id required", 400, origin);
      }

      // Slice 09 CP2: accept optional originating_log_id so the AI Request
      // Log time-to-quote column can join this quote back to the request
      // that led to it. Defensive typing — only persist when it's a uuid.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const rawLogId = typeof body.originating_log_id === "string" ? body.originating_log_id : null;
      const originatingLogId = rawLogId && UUID_RE.test(rawLogId) ? rawLogId : null;

      const { data, error } = await supabase
        .from("quote_packages")
        .upsert({
          deal_id: body.deal_id,
          contact_id: body.contact_id,
          equipment: body.equipment || [],
          attachments_included: body.attachments_included || [],
          trade_in_valuation_id: body.trade_in_valuation_id,
          trade_allowance: body.trade_allowance,
          financing_scenarios: body.financing_scenarios || [],
          equipment_total: body.equipment_total || 0,
          attachment_total: body.attachment_total || 0,
          subtotal: body.subtotal || 0,
          trade_credit: body.trade_credit || 0,
          net_total: body.net_total || 0,
          margin_amount: body.margin_amount,
          margin_pct: body.margin_pct,
          ai_recommendation: body.ai_recommendation,
          entry_mode: body.entry_mode || "manual",
          status: body.status || "draft",
          created_by: user.id,
          customer_name: typeof body.customer_name === "string" ? body.customer_name.trim().slice(0, 200) : null,
          customer_company: typeof body.customer_company === "string" ? body.customer_company.trim().slice(0, 200) : null,
          customer_phone: typeof body.customer_phone === "string" ? body.customer_phone.trim().slice(0, 30) : null,
          customer_email: typeof body.customer_email === "string" ? body.customer_email.trim().slice(0, 200) : null,
          originating_log_id: originatingLogId,
        }, { onConflict: "deal_id" })
        .select()
        .single();

      if (error) {
        console.error("quote save error:", error);
        return safeJsonError("Failed to save quote", 500, origin);
      }

      return safeJsonOk({ quote: data }, origin, 201);
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

    // ── POST /send-package: Send quote to customer via email ──────────
    if (action === "send-package") {
      if (!body.quote_package_id) {
        return safeJsonError("quote_package_id required", 400, origin);
      }

      // Fetch quote package with contact email
      const { data: pkg, error: pkgErr } = await supabase
        .from("quote_packages")
        .select("id, deal_id, contact_id, equipment, equipment_total, net_total, trade_allowance, sent_at, crm_contacts(first_name, last_name, email)")
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
