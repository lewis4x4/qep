/**
 * Chat function-calling tools: definitions and executors.
 * The model can invoke these to dynamically query the database
 * instead of relying solely on pre-fetched keyword/semantic evidence.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ── Tool definitions (OpenAI format) ───────────────────────────────────

export const CHAT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "searchContacts",
      description: "Search CRM contacts by name, email, company, or title. Returns matching contacts with their details.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term (name, email, or title)" },
          limit: { type: "number", description: "Max results to return (default 5, max 15)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "searchDeals",
      description: "Search CRM deals. Can filter by name, closing date range, or minimum amount.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Deal name or company name search" },
          closing_within_days: { type: "number", description: "Only deals expected to close within this many days from today" },
          min_amount: { type: "number", description: "Minimum deal amount filter" },
          limit: { type: "number", description: "Max results (default 10, max 25)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getEquipment",
      description: "Search equipment inventory by make, model, category, serial number, or availability status.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term (make, model, name, serial number)" },
          category: { type: "string", description: "Category filter (e.g. excavator, loader, crane)" },
          availability: {
            type: "string",
            enum: ["available", "rented", "sold", "maintenance"],
            description: "Availability status filter",
          },
          limit: { type: "number", description: "Max results (default 10, max 25)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getMarketValuation",
      description: "Get current market valuations for specific equipment make/model/year.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string", description: "Equipment manufacturer (e.g. CAT, Deere, Komatsu)" },
          model: { type: "string", description: "Equipment model" },
          year: { type: "number", description: "Model year filter" },
          limit: { type: "number", description: "Max results (default 5)" },
        },
        required: ["make"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getCompetitorListings",
      description: "Get competitor dealer listings for equipment. Shows what rival dealers are offering.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string", description: "Equipment manufacturer" },
          model: { type: "string", description: "Equipment model" },
          limit: { type: "number", description: "Max results (default 5, max 15)" },
        },
        required: ["make"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getFinancingRates",
      description: "Get current financing rates, terms, and lender programs.",
      parameters: {
        type: "object",
        properties: {
          credit_tier: { type: "string", description: "Customer credit tier (e.g. prime, near-prime, subprime)" },
          lender_name: { type: "string", description: "Specific lender name" },
          limit: { type: "number", description: "Max results (default 5)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getPipelineSummary",
      description: "Get a summary of the deal pipeline: total open deals, total value, and deals closing within a given window.",
      parameters: {
        type: "object",
        properties: {
          days_ahead: { type: "number", description: "Look-ahead window in days for closing deals (default 30)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getRecentActivities",
      description: "Get recent CRM activities (calls, meetings, notes, tasks) optionally filtered by contact or deal name.",
      parameters: {
        type: "object",
        properties: {
          contact_name: { type: "string", description: "Filter by contact name" },
          deal_name: { type: "string", description: "Filter by deal name" },
          activity_type: {
            type: "string",
            enum: ["call", "email", "meeting", "note", "task"],
            description: "Filter by activity type",
          },
          limit: { type: "number", description: "Max results (default 10, max 25)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getManufacturerIncentives",
      description: "Get active manufacturer/OEM incentive programs. Filter by manufacturer name or program name.",
      parameters: {
        type: "object",
        properties: {
          oem_name: { type: "string", description: "Manufacturer/OEM name (e.g. CAT, Deere)" },
          program_name: { type: "string", description: "Incentive program name" },
          limit: { type: "number", description: "Max results (default 5)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getEntityBriefing",
      description: "Get a unified briefing for a company, contact, or deal — automatically pulls all related contacts, deals, equipment, activities, voice notes, and valuations into one comprehensive report. Use this when the user asks 'tell me about X' or needs a full picture of a customer/company/deal.",
      parameters: {
        type: "object",
        properties: {
          entity_type: {
            type: "string",
            enum: ["company", "contact", "deal"],
            description: "What kind of entity to brief on",
          },
          name: { type: "string", description: "Name to search for (company name, contact name, or deal name)" },
        },
        required: ["entity_type", "name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getCompetitiveIntelligence",
      description: "Get competitive intelligence from voice note mentions. Shows which competitors are being mentioned by reps, how often, and in what sentiment context. Use when user asks about competitors, competitive landscape, or market positioning.",
      parameters: {
        type: "object",
        properties: {
          competitor_name: { type: "string", description: "Filter by specific competitor name (optional)" },
          days: { type: "number", description: "Look back period in days (default 30, max 90)" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getAnomalyAlerts",
      description: "Get proactive anomaly alerts — stalling deals, overdue follow-ups, activity gaps, pipeline risk. Use when user asks about risks, what needs attention, stalled deals, or team activity concerns.",
      parameters: {
        type: "object",
        properties: {
          alert_type: {
            type: "string",
            enum: ["stalling_deal", "overdue_follow_up", "activity_gap", "pipeline_risk", "all"],
            description: "Filter by alert type, or 'all' for everything",
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high", "critical", "all"],
            description: "Filter by severity (default: all)",
          },
          acknowledged: {
            type: "boolean",
            description: "Include acknowledged alerts (default: false, only unacknowledged)",
          },
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getVoiceNoteInsights",
      description: "Get voice note intelligence — sentiment trends, manager-flagged notes, entity-linked captures. Use when user asks about field note trends, rep sentiment, or notes needing attention.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            enum: ["manager_attention", "negative_sentiment", "recent", "with_competitors"],
            description: "Filter type for voice notes",
          },
          days: { type: "number", description: "Look back period in days (default 7, max 30)" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["filter"],
      },
    },
  },
] as const;

// ── Tool executors ─────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

async function execSearchContacts(
  db: SupabaseClient,
  args: { query?: string; limit?: number },
): Promise<unknown> {
  const q = (args.query ?? "").trim();
  if (!q) return { error: "query is required" };
  const limit = clamp(args.limit ?? 5, 1, 15);
  const like = `%${q}%`;

  const { data, error } = await db
    .from("crm_contacts")
    .select("id, first_name, last_name, email, phone, title, city, state, primary_company_id, created_at")
    .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},title.ilike.${like}`)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) return { error: error.message };

  // Resolve company names
  const companyIds = [...new Set((data ?? []).map((c: Record<string, unknown>) => c.primary_company_id).filter(Boolean))];
  let companyMap: Record<string, string> = {};
  if (companyIds.length > 0) {
    const { data: companies } = await db.from("crm_companies").select("id, name").in("id", companyIds);
    if (companies) {
      companyMap = Object.fromEntries(
        (companies as { id: string; name: string }[]).map((c) => [c.id, c.name]),
      );
    }
  }

  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: c.id,
    name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
    email: c.email,
    phone: c.phone,
    title: c.title,
    company: companyMap[c.primary_company_id as string] ?? null,
    location: [c.city, c.state].filter(Boolean).join(", ") || null,
  }));
}

async function execSearchDeals(
  db: SupabaseClient,
  args: { query?: string; closing_within_days?: number; min_amount?: number; limit?: number },
): Promise<unknown> {
  const limit = clamp(args.limit ?? 10, 1, 25);
  let query = db
    .from("crm_deals")
    .select("id, name, amount, expected_close_on, stage_id, primary_contact_id, company_id, created_at")
    .is("deleted_at", null)
    .order("expected_close_on", { ascending: true })
    .limit(limit);

  if (args.query?.trim()) {
    query = query.ilike("name", `%${args.query.trim()}%`);
  }
  if (typeof args.closing_within_days === "number" && args.closing_within_days > 0) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + args.closing_within_days);
    query = query.lte("expected_close_on", futureDate.toISOString().split("T")[0]);
    query = query.gte("expected_close_on", new Date().toISOString().split("T")[0]);
  }
  if (typeof args.min_amount === "number") {
    query = query.gte("amount", args.min_amount);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  // Resolve stage, contact, company names
  const stageIds = [...new Set((data ?? []).map((d: Record<string, unknown>) => d.stage_id).filter(Boolean))];
  const contactIds = [...new Set((data ?? []).map((d: Record<string, unknown>) => d.primary_contact_id).filter(Boolean))];
  const companyIds = [...new Set((data ?? []).map((d: Record<string, unknown>) => d.company_id).filter(Boolean))];

  let stageMap: Record<string, string> = {};
  let contactMap: Record<string, string> = {};
  let companyMap: Record<string, string> = {};

  if (stageIds.length > 0) {
    const { data: stages } = await db.from("crm_deal_stages").select("id, name").in("id", stageIds);
    if (stages) stageMap = Object.fromEntries((stages as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  }
  if (contactIds.length > 0) {
    const { data: contacts } = await db.from("crm_contacts").select("id, first_name, last_name").in("id", contactIds);
    if (contacts) {
      contactMap = Object.fromEntries(
        (contacts as { id: string; first_name: string; last_name: string }[])
          .map((c) => [c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()]),
      );
    }
  }
  if (companyIds.length > 0) {
    const { data: companies } = await db.from("crm_companies").select("id, name").in("id", companyIds);
    if (companies) companyMap = Object.fromEntries((companies as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  }

  return (data ?? []).map((d: Record<string, unknown>) => ({
    id: d.id,
    name: d.name,
    amount: d.amount,
    expected_close: d.expected_close_on,
    stage: stageMap[d.stage_id as string] ?? null,
    contact: contactMap[d.primary_contact_id as string] ?? null,
    company: companyMap[d.company_id as string] ?? null,
  }));
}

async function execGetEquipment(
  db: SupabaseClient,
  args: { query?: string; category?: string; availability?: string; limit?: number },
): Promise<unknown> {
  const limit = clamp(args.limit ?? 10, 1, 25);
  let query = db
    .from("crm_equipment")
    .select("id, name, make, model, year, serial_number, category, condition, availability, engine_hours, location_description, current_market_value, daily_rental_rate")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (args.query?.trim()) {
    const like = `%${args.query.trim()}%`;
    query = query.or(`name.ilike.${like},make.ilike.${like},model.ilike.${like},serial_number.ilike.${like}`);
  }
  if (args.category?.trim()) {
    query = query.ilike("category", `%${args.category.trim()}%`);
  }
  if (args.availability?.trim()) {
    query = query.eq("availability", args.availability.trim());
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return data ?? [];
}

async function execGetMarketValuation(
  db: SupabaseClient,
  args: { make: string; model?: string; year?: number; limit?: number },
): Promise<unknown> {
  const limit = clamp(args.limit ?? 5, 1, 15);
  let query = db
    .from("market_valuations")
    .select("id, make, model, year, condition, fair_market_value, retail_value, wholesale_value, valuation_date, source")
    .ilike("make", `%${args.make.trim()}%`)
    .order("valuation_date", { ascending: false })
    .limit(limit);

  if (args.model?.trim()) {
    query = query.ilike("model", `%${args.model.trim()}%`);
  }
  if (typeof args.year === "number") {
    query = query.eq("year", args.year);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return data ?? [];
}

async function execGetCompetitorListings(
  db: SupabaseClient,
  args: { make: string; model?: string; limit?: number },
): Promise<unknown> {
  const limit = clamp(args.limit ?? 5, 1, 15);
  let query = db
    .from("competitor_listings")
    .select("id, dealer_name, make, model, year, asking_price, condition, listing_url, scraped_at")
    .ilike("make", `%${args.make.trim()}%`)
    .order("scraped_at", { ascending: false })
    .limit(limit);

  if (args.model?.trim()) {
    query = query.ilike("model", `%${args.model.trim()}%`);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return data ?? [];
}

async function execGetFinancingRates(
  db: SupabaseClient,
  args: { credit_tier?: string; lender_name?: string; limit?: number },
): Promise<unknown> {
  const limit = clamp(args.limit ?? 5, 1, 15);
  let query = db
    .from("financing_rate_matrix")
    .select("id, lender_name, credit_tier, term_months, rate_pct, max_ltv_pct, min_amount, max_amount, updated_at")
    .order("rate_pct", { ascending: true })
    .limit(limit);

  if (args.credit_tier?.trim()) {
    query = query.ilike("credit_tier", `%${args.credit_tier.trim()}%`);
  }
  if (args.lender_name?.trim()) {
    query = query.ilike("lender_name", `%${args.lender_name.trim()}%`);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return data ?? [];
}

async function execGetPipelineSummary(
  db: SupabaseClient,
  args: { days_ahead?: number },
): Promise<unknown> {
  const daysAhead = clamp(args.days_ahead ?? 30, 1, 365);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);
  const today = new Date().toISOString().split("T")[0];
  const future = futureDate.toISOString().split("T")[0];

  const [allDeals, closingDeals] = await Promise.all([
    db.from("crm_deals")
      .select("id, amount", { count: "exact" })
      .is("deleted_at", null),
    db.from("crm_deals")
      .select("id, name, amount, expected_close_on, stage_id")
      .is("deleted_at", null)
      .gte("expected_close_on", today)
      .lte("expected_close_on", future)
      .order("expected_close_on", { ascending: true })
      .limit(20),
  ]);

  const totalDealCount = allDeals.count ?? (allDeals.data ?? []).length;
  const totalPipelineValue = (allDeals.data ?? []).reduce(
    (sum: number, d: Record<string, unknown>) => sum + (Number(d.amount) || 0),
    0,
  );

  // Resolve stages for closing deals
  const stageIds = [...new Set((closingDeals.data ?? []).map((d: Record<string, unknown>) => d.stage_id).filter(Boolean))];
  let stageMap: Record<string, string> = {};
  if (stageIds.length > 0) {
    const { data: stages } = await db.from("crm_deal_stages").select("id, name").in("id", stageIds);
    if (stages) stageMap = Object.fromEntries((stages as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  }

  return {
    total_open_deals: totalDealCount,
    total_pipeline_value: totalPipelineValue,
    deals_closing_within_days: daysAhead,
    closing_deals: (closingDeals.data ?? []).map((d: Record<string, unknown>) => ({
      name: d.name,
      amount: d.amount,
      expected_close: d.expected_close_on,
      stage: stageMap[d.stage_id as string] ?? null,
    })),
  };
}

async function execGetRecentActivities(
  db: SupabaseClient,
  args: { contact_name?: string; deal_name?: string; activity_type?: string; limit?: number },
): Promise<unknown> {
  const limit = clamp(args.limit ?? 10, 1, 25);

  // If filtering by contact name, resolve contact IDs first
  let contactIds: string[] | null = null;
  if (args.contact_name?.trim()) {
    const like = `%${args.contact_name.trim()}%`;
    const { data: contacts } = await db
      .from("crm_contacts")
      .select("id")
      .or(`first_name.ilike.${like},last_name.ilike.${like}`)
      .is("deleted_at", null)
      .limit(10);
    contactIds = (contacts ?? []).map((c: Record<string, unknown>) => c.id as string);
    if (contactIds.length === 0) return [];
  }

  // If filtering by deal name, resolve deal IDs first
  let dealIds: string[] | null = null;
  if (args.deal_name?.trim()) {
    const { data: deals } = await db
      .from("crm_deals")
      .select("id")
      .ilike("name", `%${args.deal_name.trim()}%`)
      .is("deleted_at", null)
      .limit(10);
    dealIds = (deals ?? []).map((d: Record<string, unknown>) => d.id as string);
    if (dealIds.length === 0) return [];
  }

  let query = db
    .from("crm_activities")
    .select("id, activity_type, body, occurred_at, contact_id, deal_id, company_id")
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (contactIds) {
    query = query.in("contact_id", contactIds);
  }
  if (dealIds) {
    query = query.in("deal_id", dealIds);
  }
  if (args.activity_type?.trim()) {
    query = query.eq("activity_type", args.activity_type.trim());
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  return (data ?? []).map((a: Record<string, unknown>) => ({
    id: a.id,
    type: a.activity_type,
    body: typeof a.body === "string" ? a.body.slice(0, 500) : null,
    occurred_at: a.occurred_at,
  }));
}

async function execGetManufacturerIncentives(
  db: SupabaseClient,
  args: { oem_name?: string; program_name?: string; limit?: number },
): Promise<unknown> {
  const limit = clamp(args.limit ?? 5, 1, 15);
  let query = db
    .from("manufacturer_incentives")
    .select("id, oem_name, program_name, incentive_type, value, start_date, end_date, eligible_models, terms")
    .order("end_date", { ascending: false })
    .limit(limit);

  if (args.oem_name?.trim()) {
    query = query.ilike("oem_name", `%${args.oem_name.trim()}%`);
  }
  if (args.program_name?.trim()) {
    query = query.ilike("program_name", `%${args.program_name.trim()}%`);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return data ?? [];
}

async function execGetEntityBriefing(
  db: SupabaseClient,
  args: { entity_type: "company" | "contact" | "deal"; name: string },
): Promise<unknown> {
  const name = (args.name ?? "").trim();
  if (!name) return { error: "name is required" };
  const like = `%${name}%`;

  if (args.entity_type === "company") {
    // Find the company
    const { data: companies } = await db
      .from("crm_companies")
      .select("id, name, industry, city, state, country, website, phone, employee_count")
      .ilike("name", like)
      .is("deleted_at", null)
      .limit(1);
    if (!companies?.length) return { message: `No company found matching "${name}"` };
    const company = companies[0] as Record<string, unknown>;
    const companyId = company.id as string;

    // Pull all related data in parallel
    const [contacts, deals, equipment, activities, voiceNotes] = await Promise.all([
      db.from("crm_contacts").select("id, first_name, last_name, email, phone, title")
        .eq("primary_company_id", companyId).is("deleted_at", null).limit(20),
      db.from("crm_deals").select("id, name, amount, expected_close_on, stage_id")
        .eq("company_id", companyId).is("deleted_at", null).order("expected_close_on", { ascending: true }).limit(15),
      db.from("crm_equipment").select("id, name, make, model, year, condition, availability, current_market_value")
        .is("deleted_at", null).limit(10),
      db.from("crm_activities").select("id, activity_type, body, occurred_at")
        .eq("company_id", companyId).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(10),
      db.from("voice_captures").select("id, transcript, created_at")
        .not("transcript", "is", null)
        .ilike("transcript", like)
        .order("created_at", { ascending: false }).limit(5),
    ]);

    // Resolve deal stages
    const stageIds = [...new Set((deals.data ?? []).map((d: Record<string, unknown>) => d.stage_id).filter(Boolean))];
    let stageMap: Record<string, string> = {};
    if (stageIds.length > 0) {
      const { data: stages } = await db.from("crm_deal_stages").select("id, name").in("id", stageIds);
      if (stages) stageMap = Object.fromEntries((stages as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    }

    return {
      company,
      contacts: (contacts.data ?? []).map((c: Record<string, unknown>) => ({
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
        email: c.email, phone: c.phone, title: c.title,
      })),
      deals: (deals.data ?? []).map((d: Record<string, unknown>) => ({
        name: d.name, amount: d.amount, expected_close: d.expected_close_on,
        stage: stageMap[d.stage_id as string] ?? null,
      })),
      recent_activities: (activities.data ?? []).map((a: Record<string, unknown>) => ({
        type: a.activity_type,
        body: typeof a.body === "string" ? a.body.slice(0, 300) : null,
        date: a.occurred_at,
      })),
      voice_notes: (voiceNotes.data ?? []).map((v: Record<string, unknown>) => ({
        date: v.created_at,
        transcript_excerpt: typeof v.transcript === "string" ? v.transcript.slice(0, 400) : null,
      })),
    };
  }

  if (args.entity_type === "contact") {
    const { data: contacts } = await db
      .from("crm_contacts")
      .select("id, first_name, last_name, email, phone, title, city, state, primary_company_id")
      .or(`first_name.ilike.${like},last_name.ilike.${like}`)
      .is("deleted_at", null)
      .limit(1);
    if (!contacts?.length) return { message: `No contact found matching "${name}"` };
    const contact = contacts[0] as Record<string, unknown>;
    const contactId = contact.id as string;

    // Resolve company name
    let companyName: string | null = null;
    if (contact.primary_company_id) {
      const { data: comp } = await db.from("crm_companies").select("name").eq("id", contact.primary_company_id).maybeSingle();
      companyName = (comp as { name: string } | null)?.name ?? null;
    }

    const [deals, activities, voiceNotes] = await Promise.all([
      db.from("crm_deals").select("id, name, amount, expected_close_on, stage_id")
        .eq("primary_contact_id", contactId).is("deleted_at", null).order("expected_close_on", { ascending: true }).limit(10),
      db.from("crm_activities").select("id, activity_type, body, occurred_at")
        .eq("contact_id", contactId).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(10),
      db.from("voice_captures").select("id, transcript, created_at")
        .not("transcript", "is", null)
        .ilike("transcript", like)
        .order("created_at", { ascending: false }).limit(5),
    ]);

    const stageIds = [...new Set((deals.data ?? []).map((d: Record<string, unknown>) => d.stage_id).filter(Boolean))];
    let stageMap: Record<string, string> = {};
    if (stageIds.length > 0) {
      const { data: stages } = await db.from("crm_deal_stages").select("id, name").in("id", stageIds);
      if (stages) stageMap = Object.fromEntries((stages as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    }

    return {
      contact: { ...contact, company: companyName },
      deals: (deals.data ?? []).map((d: Record<string, unknown>) => ({
        name: d.name, amount: d.amount, expected_close: d.expected_close_on,
        stage: stageMap[d.stage_id as string] ?? null,
      })),
      recent_activities: (activities.data ?? []).map((a: Record<string, unknown>) => ({
        type: a.activity_type,
        body: typeof a.body === "string" ? a.body.slice(0, 300) : null,
        date: a.occurred_at,
      })),
      voice_notes: (voiceNotes.data ?? []).map((v: Record<string, unknown>) => ({
        date: v.created_at,
        transcript_excerpt: typeof v.transcript === "string" ? v.transcript.slice(0, 400) : null,
      })),
    };
  }

  if (args.entity_type === "deal") {
    const { data: deals } = await db
      .from("crm_deals")
      .select("id, name, amount, expected_close_on, stage_id, primary_contact_id, company_id, assigned_rep_id, created_at")
      .ilike("name", like)
      .is("deleted_at", null)
      .limit(1);
    if (!deals?.length) return { message: `No deal found matching "${name}"` };
    const deal = deals[0] as Record<string, unknown>;
    const dealId = deal.id as string;

    // Resolve FK names
    let contactName: string | null = null;
    let companyName: string | null = null;
    let stageName: string | null = null;
    let repName: string | null = null;

    const lookups = await Promise.all([
      deal.primary_contact_id
        ? db.from("crm_contacts").select("first_name, last_name").eq("id", deal.primary_contact_id).maybeSingle()
        : null,
      deal.company_id
        ? db.from("crm_companies").select("name").eq("id", deal.company_id).maybeSingle()
        : null,
      deal.stage_id
        ? db.from("crm_deal_stages").select("name").eq("id", deal.stage_id).maybeSingle()
        : null,
      deal.assigned_rep_id
        ? db.from("profiles").select("full_name").eq("id", deal.assigned_rep_id).maybeSingle()
        : null,
    ]);

    if (lookups[0]?.data) {
      const c = lookups[0].data as { first_name: string; last_name: string };
      contactName = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
    }
    companyName = (lookups[1]?.data as { name: string } | null)?.name ?? null;
    stageName = (lookups[2]?.data as { name: string } | null)?.name ?? null;
    repName = (lookups[3]?.data as { full_name: string } | null)?.full_name ?? null;

    const [activities, dealEquipment] = await Promise.all([
      db.from("crm_activities").select("id, activity_type, body, occurred_at")
        .eq("deal_id", dealId).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(10),
      db.from("crm_deal_equipment").select("equipment_id, quantity, unit_price, line_total")
        .eq("deal_id", dealId).limit(10),
    ]);

    // Resolve equipment names
    const equipIds = (dealEquipment.data ?? []).map((e: Record<string, unknown>) => e.equipment_id).filter(Boolean);
    let equipMap: Record<string, string> = {};
    if (equipIds.length > 0) {
      const { data: equips } = await db.from("crm_equipment").select("id, name, make, model, year").in("id", equipIds);
      if (equips) {
        equipMap = Object.fromEntries(
          (equips as { id: string; name: string; make: string; model: string; year: number }[])
            .map((e) => [e.id, `${e.name} (${[e.make, e.model, e.year].filter(Boolean).join(" ")})`]),
        );
      }
    }

    return {
      deal: {
        ...deal,
        contact: contactName,
        company: companyName,
        stage: stageName,
        assigned_rep: repName,
      },
      equipment: (dealEquipment.data ?? []).map((e: Record<string, unknown>) => ({
        name: equipMap[e.equipment_id as string] ?? "Unknown",
        quantity: e.quantity,
        unit_price: e.unit_price,
        line_total: e.line_total,
      })),
      recent_activities: (activities.data ?? []).map((a: Record<string, unknown>) => ({
        type: a.activity_type,
        body: typeof a.body === "string" ? a.body.slice(0, 300) : null,
        date: a.occurred_at,
      })),
    };
  }

  return { error: `Unknown entity_type: ${args.entity_type}` };
}

async function execGetCompetitiveIntelligence(
  db: SupabaseClient,
  args: { competitor_name?: string; days?: number; limit?: number },
): Promise<unknown> {
  const days = clamp(args.days ?? 30, 1, 90);
  const limit = clamp(args.limit ?? 10, 1, 25);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let query = db
    .from("competitive_mentions")
    .select("id, competitor_name, context, sentiment, user_id, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (args.competitor_name) {
    query = query.ilike("competitor_name", `%${args.competitor_name}%`);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  const competitors = (data ?? []).map((m: Record<string, unknown>) => ({
    competitor: m.competitor_name,
    sentiment: m.sentiment ?? "unknown",
    context: typeof m.context === "string" ? m.context.slice(0, 200) : null,
    date: m.created_at,
  }));

  // Aggregate by competitor
  const summary: Record<string, { count: number; sentiments: string[] }> = {};
  for (const c of competitors) {
    if (!summary[c.competitor as string]) {
      summary[c.competitor as string] = { count: 0, sentiments: [] };
    }
    summary[c.competitor as string].count++;
    if (c.sentiment) summary[c.competitor as string].sentiments.push(c.sentiment as string);
  }

  return { mentions: competitors, summary, period_days: days };
}

async function execGetAnomalyAlerts(
  db: SupabaseClient,
  args: { alert_type?: string; severity?: string; acknowledged?: boolean; limit?: number },
): Promise<unknown> {
  const limit = clamp(args.limit ?? 10, 1, 25);

  let query = db
    .from("anomaly_alerts")
    .select("id, alert_type, severity, title, description, entity_type, entity_id, assigned_to, data, acknowledged, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (args.alert_type && args.alert_type !== "all") {
    query = query.eq("alert_type", args.alert_type);
  }
  if (args.severity && args.severity !== "all") {
    query = query.eq("severity", args.severity);
  }
  if (args.acknowledged !== true) {
    query = query.eq("acknowledged", false);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  return {
    alerts: (data ?? []).map((a: Record<string, unknown>) => ({
      id: a.id,
      type: a.alert_type,
      severity: a.severity,
      title: a.title,
      description: a.description,
      entity_type: a.entity_type,
      acknowledged: a.acknowledged,
      date: a.created_at,
      data: a.data,
    })),
    count: (data ?? []).length,
  };
}

async function execGetVoiceNoteInsights(
  db: SupabaseClient,
  args: { filter: string; days?: number; limit?: number },
): Promise<unknown> {
  const days = clamp(args.days ?? 7, 1, 30);
  const limit = clamp(args.limit ?? 10, 1, 20);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let query = db
    .from("voice_captures")
    .select("id, transcript, sentiment, competitor_mentions, manager_attention, linked_contact_id, linked_company_id, linked_deal_id, created_at, user_id")
    .gte("created_at", since)
    .not("transcript", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  switch (args.filter) {
    case "manager_attention":
      query = query.eq("manager_attention", true);
      break;
    case "negative_sentiment":
      query = query.in("sentiment", ["frustrated", "skeptical", "cautious"]);
      break;
    case "with_competitors":
      query = query.not("competitor_mentions", "eq", "{}");
      break;
    case "recent":
    default:
      break;
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  return {
    filter: args.filter,
    period_days: days,
    notes: (data ?? []).map((n: Record<string, unknown>) => ({
      id: n.id,
      excerpt: typeof n.transcript === "string" ? (n.transcript as string).slice(0, 250) : null,
      sentiment: n.sentiment,
      competitors: n.competitor_mentions,
      manager_attention: n.manager_attention,
      has_contact_link: !!n.linked_contact_id,
      has_company_link: !!n.linked_company_id,
      has_deal_link: !!n.linked_deal_id,
      date: n.created_at,
    })),
  };
}

// ── Dispatcher ─────────────────────────────────────────────────────────

type ToolExecutor = (db: SupabaseClient, args: Record<string, unknown>) => Promise<unknown>;

const EXECUTORS: Record<string, ToolExecutor> = {
  searchContacts: (db, args) => execSearchContacts(db, args as Parameters<typeof execSearchContacts>[1]),
  searchDeals: (db, args) => execSearchDeals(db, args as Parameters<typeof execSearchDeals>[1]),
  getEquipment: (db, args) => execGetEquipment(db, args as Parameters<typeof execGetEquipment>[1]),
  getMarketValuation: (db, args) => execGetMarketValuation(db, args as Parameters<typeof execGetMarketValuation>[1]),
  getCompetitorListings: (db, args) => execGetCompetitorListings(db, args as Parameters<typeof execGetCompetitorListings>[1]),
  getFinancingRates: (db, args) => execGetFinancingRates(db, args as Parameters<typeof execGetFinancingRates>[1]),
  getPipelineSummary: (db, args) => execGetPipelineSummary(db, args as Parameters<typeof execGetPipelineSummary>[1]),
  getRecentActivities: (db, args) => execGetRecentActivities(db, args as Parameters<typeof execGetRecentActivities>[1]),
  getManufacturerIncentives: (db, args) => execGetManufacturerIncentives(db, args as Parameters<typeof execGetManufacturerIncentives>[1]),
  getEntityBriefing: (db, args) => execGetEntityBriefing(db, args as Parameters<typeof execGetEntityBriefing>[1]),
  getCompetitiveIntelligence: (db, args) => execGetCompetitiveIntelligence(db, args as Parameters<typeof execGetCompetitiveIntelligence>[1]),
  getVoiceNoteInsights: (db, args) => execGetVoiceNoteInsights(db, args as Parameters<typeof execGetVoiceNoteInsights>[1]),
  getAnomalyAlerts: (db, args) => execGetAnomalyAlerts(db, args as Parameters<typeof execGetAnomalyAlerts>[1]),
};

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: "tool";
  content: string;
}

export async function executeToolCalls(
  db: SupabaseClient,
  toolCalls: ToolCall[],
  traceId: string,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of toolCalls) {
    const executor = EXECUTORS[call.function.name];
    if (!executor) {
      console.warn(`[chat:${traceId}] unknown tool: ${call.function.name}`);
      results.push({
        tool_call_id: call.id,
        role: "tool",
        content: JSON.stringify({ error: `Unknown tool: ${call.function.name}` }),
      });
      continue;
    }

    try {
      const args = JSON.parse(call.function.arguments || "{}");
      console.info(`[chat:${traceId}] tool_call name=${call.function.name} args=${JSON.stringify(args)}`);
      const result = await executor(db, args);
      const json = JSON.stringify(result);
      results.push({
        tool_call_id: call.id,
        role: "tool",
        content: json.length > 8000 ? json.slice(0, 8000) + "...(truncated)" : json,
      });
    } catch (err) {
      console.error(`[chat:${traceId}] tool_error name=${call.function.name}`, err);
      results.push({
        tool_call_id: call.id,
        role: "tool",
        content: JSON.stringify({ error: "Tool execution failed" }),
      });
    }
  }

  return results;
}
