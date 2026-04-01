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
      name: "getDealCoaching",
      description: "Get AI coaching for a specific deal based on historical win/loss patterns, deal velocity, and success factors. Analyzes similar past deals to recommend what to do. Use when a user asks for coaching, advice on a deal, how to close a deal, or what worked on similar deals.",
      parameters: {
        type: "object",
        properties: {
          deal_name: { type: "string", description: "Name or partial name of the deal to coach on" },
        },
        required: ["deal_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getWinLossAnalysis",
      description: "Get aggregate win/loss analysis across historical deals — win rate, average deal size, average time-to-close, common loss reasons, and top success patterns. Use when user asks about win rate, deal performance, or what makes deals succeed or fail.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Look back period in days (default 90, max 365)" },
          rep_id: { type: "string", description: "Filter to a specific rep's deals (optional)" },
        },
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
      name: "createFollowUpTask",
      description: "Create a follow-up task/activity on a deal. Use when the user says 'remind me to follow up', 'schedule a follow-up', 'create a task for', or 'set a reminder'.",
      parameters: {
        type: "object",
        properties: {
          deal_name: { type: "string", description: "Name of the deal to attach the task to" },
          task_description: { type: "string", description: "What needs to be done" },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format (defaults to tomorrow)" },
        },
        required: ["deal_name", "task_description"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "logActivity",
      description: "Log a CRM activity (note, call, email, meeting) on a deal, contact, or company. Use when user says 'log a note', 'record a call', 'note that I met with', or 'add an activity'.",
      parameters: {
        type: "object",
        properties: {
          activity_type: {
            type: "string",
            enum: ["note", "call", "email", "meeting"],
            description: "Type of activity",
          },
          entity_type: {
            type: "string",
            enum: ["deal", "contact", "company"],
            description: "What to attach the activity to",
          },
          entity_name: { type: "string", description: "Name of the deal, contact, or company" },
          body: { type: "string", description: "Activity description/content" },
        },
        required: ["activity_type", "entity_type", "entity_name", "body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "updateDealStage",
      description: "Move a deal to a different pipeline stage. Use when user says 'move deal to', 'advance deal', 'update stage', or 'mark deal as'.",
      parameters: {
        type: "object",
        properties: {
          deal_name: { type: "string", description: "Name of the deal" },
          new_stage: { type: "string", description: "Name of the stage to move to (e.g. 'Negotiation', 'Quote Sent', 'Closed Won')" },
        },
        required: ["deal_name", "new_stage"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "draftEmail",
      description: "Draft a professional email to a contact. Use when user says 'draft an email', 'write an email to', 'send a message to', or 'compose an email'. Returns the draft for the user to review — does NOT send.",
      parameters: {
        type: "object",
        properties: {
          contact_name: { type: "string", description: "Name of the contact" },
          subject: { type: "string", description: "Email subject line" },
          purpose: { type: "string", description: "What the email should accomplish (e.g. 'follow up on demo', 'request meeting', 'send pricing')" },
          tone: {
            type: "string",
            enum: ["professional", "friendly", "urgent", "casual"],
            description: "Tone of the email (default: professional)",
          },
        },
        required: ["contact_name", "purpose"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generatePrepSheet",
      description: "Generate a comprehensive pre-meeting customer prep sheet. Pulls all CRM data for a company or contact and synthesizes a one-page briefing with talking points, intelligence, and action items. Use when user says 'prep for meeting with X', 'prep sheet for X', or 'what do I need to know before meeting X'.",
      parameters: {
        type: "object",
        properties: {
          entity_type: {
            type: "string",
            enum: ["company", "contact"],
            description: "Look up by company name or contact name",
          },
          name: { type: "string", description: "Company name or contact name to prep for" },
        },
        required: ["entity_type", "name"],
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

async function execGetDealCoaching(
  db: SupabaseClient,
  args: { deal_name: string },
): Promise<unknown> {
  const name = (args.deal_name ?? "").trim();
  if (!name) return { error: "deal_name is required" };

  // Find the active deal
  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, amount, stage_id, assigned_rep_id, company_id, expected_close_on, created_at, updated_at, last_activity_at, metadata")
    .ilike("name", `%${name}%`)
    .is("deleted_at", null)
    .limit(1);

  if (!deals || deals.length === 0) return { error: `No active deal found matching "${name}"` };
  const deal = deals[0] as Record<string, unknown>;

  // Resolve stage
  let stageName = "Unknown";
  let stageOrder = 0;
  if (deal.stage_id) {
    const { data: stage } = await db.from("crm_deal_stages").select("name, display_order, probability, is_closed_won, is_closed_lost").eq("id", deal.stage_id).single();
    if (stage) {
      const s = stage as Record<string, unknown>;
      stageName = s.name as string;
      stageOrder = s.display_order as number;
    }
  }

  // Get deal's activity history
  const { data: activities, count: activityCount } = await db
    .from("crm_activities")
    .select("activity_type, occurred_at", { count: "exact" })
    .eq("deal_id", deal.id)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(10);

  // Find similar historical deals (same stage range, similar amount)
  const { data: wonDeals } = await db
    .from("crm_deals_rep_safe")
    .select("id, name, amount, created_at, closed_at")
    .not("closed_at", "is", null)
    .limit(50);

  // Compute patterns from won/lost deals
  const wins: { amount: number; duration_days: number }[] = [];
  const losses: { amount: number; duration_days: number; loss_reason: string | null }[] = [];

  if (wonDeals) {
    for (const d of wonDeals as Record<string, unknown>[]) {
      const duration = d.closed_at && d.created_at
        ? Math.floor((new Date(d.closed_at as string).getTime() - new Date(d.created_at as string).getTime()) / 86_400_000)
        : null;

      // We need to check if it's won or lost via stage
      // For now, bucket by presence of loss_reason
      if ((d as Record<string, unknown>).loss_reason) {
        losses.push({
          amount: Number(d.amount) || 0,
          duration_days: duration ?? 0,
          loss_reason: (d as Record<string, unknown>).loss_reason as string | null,
        });
      } else {
        wins.push({
          amount: Number(d.amount) || 0,
          duration_days: duration ?? 0,
        });
      }
    }
  }

  const dealAge = Math.floor(
    (Date.now() - new Date(deal.created_at as string).getTime()) / 86_400_000,
  );
  const daysSinceActivity = deal.last_activity_at
    ? Math.floor((Date.now() - new Date(deal.last_activity_at as string).getTime()) / 86_400_000)
    : null;

  const avgWinDuration = wins.length > 0
    ? Math.round(wins.reduce((sum, w) => sum + w.duration_days, 0) / wins.length)
    : null;
  const avgWinAmount = wins.length > 0
    ? Math.round(wins.reduce((sum, w) => sum + w.amount, 0) / wins.length)
    : null;

  // Build coaching insights
  const insights: string[] = [];

  if (avgWinDuration && dealAge > avgWinDuration * 1.5) {
    insights.push(`This deal has been open ${dealAge} days, which is ${Math.round((dealAge / avgWinDuration - 1) * 100)}% longer than the average winning deal (${avgWinDuration} days). Consider accelerating or reassessing.`);
  }

  if (daysSinceActivity && daysSinceActivity > 5) {
    insights.push(`No activity in ${daysSinceActivity} days. Winning deals typically have activity every 3-4 days. Schedule a touchpoint.`);
  }

  if (stageOrder <= 2 && deal.expected_close_on) {
    const daysToClose = Math.floor(
      (new Date(deal.expected_close_on as string).getTime() - Date.now()) / 86_400_000,
    );
    if (daysToClose < 14) {
      insights.push(`Deal is in early stage "${stageName}" but expected to close in ${daysToClose} days. Either advance the deal stage quickly or update the close date.`);
    }
  }

  if (activityCount !== null && activityCount < 3) {
    insights.push(`Only ${activityCount} activities logged. Successful deals average 5+ touchpoints before closing.`);
  }

  // Aggregate loss reasons
  const lossReasons = losses
    .map((l) => l.loss_reason)
    .filter(Boolean)
    .reduce((acc: Record<string, number>, r) => { acc[r!] = (acc[r!] ?? 0) + 1; return acc; }, {});

  return {
    deal: {
      name: deal.name,
      amount: deal.amount,
      stage: stageName,
      age_days: dealAge,
      days_since_activity: daysSinceActivity,
      expected_close: deal.expected_close_on,
      activity_count: activityCount,
    },
    coaching_insights: insights,
    benchmarks: {
      avg_win_duration_days: avgWinDuration,
      avg_win_amount: avgWinAmount,
      win_count: wins.length,
      loss_count: losses.length,
      win_rate: wins.length + losses.length > 0
        ? Math.round((wins.length / (wins.length + losses.length)) * 100)
        : null,
      top_loss_reasons: Object.entries(lossReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    },
    recent_activities: (activities ?? []).map((a: Record<string, unknown>) => ({
      type: a.activity_type,
      date: a.occurred_at,
    })),
  };
}

async function execGetWinLossAnalysis(
  db: SupabaseClient,
  args: { days?: number; rep_id?: string },
): Promise<unknown> {
  const days = clamp(args.days ?? 90, 7, 365);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Get closed deals with stage info
  let query = db
    .from("crm_deals")
    .select("id, name, amount, stage_id, created_at, closed_at, loss_reason, assigned_rep_id")
    .is("deleted_at", null)
    .not("closed_at", "is", null)
    .gte("closed_at", since);

  if (args.rep_id) {
    query = query.eq("assigned_rep_id", args.rep_id);
  }

  const { data: deals } = await query.limit(200);
  if (!deals || deals.length === 0) {
    return { message: `No closed deals found in the last ${days} days.` };
  }

  // Resolve stages to determine won/lost
  const stageIds = [...new Set((deals as Record<string, unknown>[]).map((d) => d.stage_id).filter(Boolean))];
  let stageMap: Record<string, { name: string; is_closed_won: boolean; is_closed_lost: boolean }> = {};
  if (stageIds.length > 0) {
    const { data: stages } = await db.from("crm_deal_stages").select("id, name, is_closed_won, is_closed_lost").in("id", stageIds);
    if (stages) {
      stageMap = Object.fromEntries(
        (stages as { id: string; name: string; is_closed_won: boolean; is_closed_lost: boolean }[]).map((s) => [s.id, s]),
      );
    }
  }

  let wonCount = 0;
  let lostCount = 0;
  let wonAmount = 0;
  let lostAmount = 0;
  const wonDurations: number[] = [];
  const lostDurations: number[] = [];
  const lossReasons: Record<string, number> = {};

  for (const deal of deals as Record<string, unknown>[]) {
    const stage = stageMap[deal.stage_id as string];
    const duration = deal.closed_at && deal.created_at
      ? Math.floor((new Date(deal.closed_at as string).getTime() - new Date(deal.created_at as string).getTime()) / 86_400_000)
      : 0;

    if (stage?.is_closed_won) {
      wonCount++;
      wonAmount += Number(deal.amount) || 0;
      wonDurations.push(duration);
    } else if (stage?.is_closed_lost || deal.loss_reason) {
      lostCount++;
      lostAmount += Number(deal.amount) || 0;
      lostDurations.push(duration);
      if (deal.loss_reason) {
        lossReasons[deal.loss_reason as string] = (lossReasons[deal.loss_reason as string] ?? 0) + 1;
      }
    }
  }

  const avgFn = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

  return {
    period_days: days,
    total_closed: wonCount + lostCount,
    wins: wonCount,
    losses: lostCount,
    win_rate_pct: wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null,
    won_revenue: wonAmount,
    lost_revenue: lostAmount,
    avg_win_duration_days: avgFn(wonDurations),
    avg_loss_duration_days: avgFn(lostDurations),
    avg_deal_size_won: wonCount > 0 ? Math.round(wonAmount / wonCount) : null,
    top_loss_reasons: Object.entries(lossReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
  };
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

async function execCreateFollowUpTask(
  db: SupabaseClient,
  args: { deal_name: string; task_description: string; due_date?: string },
): Promise<unknown> {
  const name = (args.deal_name ?? "").trim();
  if (!name) return { error: "deal_name is required" };

  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, assigned_rep_id, workspace_id")
    .ilike("name", `%${name}%`)
    .is("deleted_at", null)
    .limit(1);

  if (!deals || deals.length === 0) return { error: `No deal found matching "${name}"` };
  const deal = deals[0] as Record<string, unknown>;

  const dueDate = args.due_date
    ? new Date(args.due_date).toISOString()
    : new Date(Date.now() + 86_400_000).toISOString();

  const { data: activity, error } = await db
    .from("crm_activities")
    .insert({
      workspace_id: deal.workspace_id ?? "default",
      activity_type: "task",
      body: args.task_description,
      occurred_at: new Date().toISOString(),
      deal_id: deal.id,
      contact_id: null,
      company_id: null,
      created_by: deal.assigned_rep_id,
      metadata: {
        source: "chat_assistant",
        task: { dueAt: dueDate, status: "open" },
      },
    })
    .select("id")
    .single();

  if (error) return { error: `Failed to create task: ${error.message}` };

  return {
    success: true,
    message: `Follow-up task created on "${deal.name}"`,
    task_id: (activity as Record<string, unknown>).id,
    deal_name: deal.name,
    due_date: dueDate.split("T")[0],
    description: args.task_description,
  };
}

async function execLogActivity(
  db: SupabaseClient,
  args: { activity_type: string; entity_type: string; entity_name: string; body: string },
): Promise<unknown> {
  const entityName = (args.entity_name ?? "").trim();
  if (!entityName) return { error: "entity_name is required" };

  const validTypes = ["note", "call", "email", "meeting"];
  if (!validTypes.includes(args.activity_type)) {
    return { error: `activity_type must be one of: ${validTypes.join(", ")}` };
  }

  const like = `%${entityName}%`;
  let dealId: string | null = null;
  let contactId: string | null = null;
  let companyId: string | null = null;
  let resolvedName = entityName;
  let workspaceId = "default";
  let createdBy: string | null = null;

  if (args.entity_type === "deal") {
    const { data } = await db.from("crm_deals").select("id, name, assigned_rep_id, workspace_id").ilike("name", like).is("deleted_at", null).limit(1);
    if (!data || data.length === 0) return { error: `No deal found matching "${entityName}"` };
    const d = data[0] as Record<string, unknown>;
    dealId = d.id as string;
    resolvedName = d.name as string;
    workspaceId = d.workspace_id as string ?? "default";
    createdBy = d.assigned_rep_id as string | null;
  } else if (args.entity_type === "contact") {
    const parts = entityName.split(/\s+/);
    let q = db.from("crm_contacts").select("id, first_name, last_name").is("deleted_at", null);
    if (parts.length > 1) {
      q = q.ilike("first_name", `%${parts[0]}%`).ilike("last_name", `%${parts[parts.length - 1]}%`);
    } else {
      q = q.or(`first_name.ilike.${like},last_name.ilike.${like}`);
    }
    const { data } = await q.limit(1);
    if (!data || data.length === 0) return { error: `No contact found matching "${entityName}"` };
    const c = data[0] as Record<string, unknown>;
    contactId = c.id as string;
    resolvedName = `${c.first_name} ${c.last_name}`;
  } else if (args.entity_type === "company") {
    const { data } = await db.from("crm_companies").select("id, name, workspace_id").ilike("name", like).is("deleted_at", null).limit(1);
    if (!data || data.length === 0) return { error: `No company found matching "${entityName}"` };
    const co = data[0] as Record<string, unknown>;
    companyId = co.id as string;
    resolvedName = co.name as string;
    workspaceId = co.workspace_id as string ?? "default";
  }

  const { data: activity, error } = await db
    .from("crm_activities")
    .insert({
      workspace_id: workspaceId,
      activity_type: args.activity_type,
      body: args.body,
      occurred_at: new Date().toISOString(),
      deal_id: dealId,
      contact_id: contactId,
      company_id: companyId,
      created_by: createdBy,
      metadata: { source: "chat_assistant" },
    })
    .select("id")
    .single();

  if (error) return { error: `Failed to log activity: ${error.message}` };

  return {
    success: true,
    message: `${args.activity_type} logged on ${args.entity_type} "${resolvedName}"`,
    activity_id: (activity as Record<string, unknown>).id,
    entity_type: args.entity_type,
    entity_name: resolvedName,
  };
}

async function execUpdateDealStage(
  db: SupabaseClient,
  args: { deal_name: string; new_stage: string },
): Promise<unknown> {
  const dealName = (args.deal_name ?? "").trim();
  const stageName = (args.new_stage ?? "").trim();
  if (!dealName) return { error: "deal_name is required" };
  if (!stageName) return { error: "new_stage is required" };

  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, stage_id, workspace_id")
    .ilike("name", `%${dealName}%`)
    .is("deleted_at", null)
    .limit(1);

  if (!deals || deals.length === 0) return { error: `No deal found matching "${dealName}"` };
  const deal = deals[0] as Record<string, unknown>;

  const { data: stages } = await db
    .from("crm_deal_stages")
    .select("id, name")
    .ilike("name", `%${stageName}%`)
    .eq("workspace_id", deal.workspace_id ?? "default")
    .limit(1);

  if (!stages || stages.length === 0) return { error: `No stage found matching "${stageName}". Check available stage names.` };
  const stage = stages[0] as Record<string, unknown>;

  if (deal.stage_id === stage.id) {
    return { message: `Deal "${deal.name}" is already in stage "${stage.name}".` };
  }

  const previousStageId = deal.stage_id;
  let previousStageName = "Unknown";
  if (previousStageId) {
    const { data: prev } = await db.from("crm_deal_stages").select("name").eq("id", previousStageId).single();
    if (prev) previousStageName = (prev as Record<string, unknown>).name as string;
  }

  const { error } = await db
    .from("crm_deals")
    .update({ stage_id: stage.id, updated_at: new Date().toISOString() })
    .eq("id", deal.id);

  if (error) return { error: `Failed to update deal stage: ${error.message}` };

  return {
    success: true,
    message: `Deal "${deal.name}" moved from "${previousStageName}" to "${stage.name}"`,
    deal_name: deal.name,
    previous_stage: previousStageName,
    new_stage: stage.name,
  };
}

async function execDraftEmail(
  db: SupabaseClient,
  args: { contact_name: string; subject?: string; purpose: string; tone?: string },
): Promise<unknown> {
  const contactName = (args.contact_name ?? "").trim();
  if (!contactName) return { error: "contact_name is required" };

  const like = `%${contactName}%`;
  const parts = contactName.split(/\s+/);
  let q = db.from("crm_contacts").select("id, first_name, last_name, email, title, primary_company_id").is("deleted_at", null);
  if (parts.length > 1) {
    q = q.ilike("first_name", `%${parts[0]}%`).ilike("last_name", `%${parts[parts.length - 1]}%`);
  } else {
    q = q.or(`first_name.ilike.${like},last_name.ilike.${like}`);
  }
  const { data: contacts } = await q.limit(1);
  if (!contacts || contacts.length === 0) return { error: `No contact found matching "${contactName}"` };
  const contact = contacts[0] as Record<string, unknown>;

  let companyName: string | null = null;
  if (contact.primary_company_id) {
    const { data: co } = await db.from("crm_companies").select("name").eq("id", contact.primary_company_id).single();
    if (co) companyName = (co as Record<string, unknown>).name as string;
  }

  // Get recent context
  const contactId = contact.id as string;
  const { data: recentActivity } = await db
    .from("crm_activities")
    .select("activity_type, body, occurred_at")
    .eq("contact_id", contactId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(3);

  return {
    draft_context: {
      to: `${contact.first_name} ${contact.last_name}`,
      email: contact.email,
      title: contact.title,
      company: companyName,
      purpose: args.purpose,
      subject: args.subject ?? null,
      tone: args.tone ?? "professional",
      recent_interactions: (recentActivity ?? []).map((a: Record<string, unknown>) => ({
        type: a.activity_type,
        summary: typeof a.body === "string" ? (a.body as string).slice(0, 150) : null,
        date: a.occurred_at,
      })),
    },
    instruction: `Generate a ${args.tone ?? "professional"} email draft to ${contact.first_name} ${contact.last_name}${contact.title ? ` (${contact.title})` : ""}${companyName ? ` at ${companyName}` : ""}. Purpose: ${args.purpose}.${args.subject ? ` Subject: ${args.subject}.` : ""} Use the recent interaction context to personalize. Format as: Subject: ...\n\n[email body]. Do NOT send — present it as a draft for the user to review and edit.`,
  };
}

async function execGeneratePrepSheet(
  db: SupabaseClient,
  args: { entity_type: string; name: string },
): Promise<unknown> {
  const name = (args.name ?? "").trim();
  if (!name) return { error: "name is required" };
  const entityType = args.entity_type ?? "company";
  const like = `%${name}%`;

  let entityName = name;
  let companyInfo: Record<string, unknown> | null = null;
  const contacts: Record<string, unknown>[] = [];
  const deals: Record<string, unknown>[] = [];
  const activities: Record<string, unknown>[] = [];
  const voiceNotes: Record<string, unknown>[] = [];

  if (entityType === "company") {
    const { data: companies } = await db.from("crm_companies").select("id, name, industry, city, state").ilike("name", like).is("deleted_at", null).limit(1);
    if (!companies || companies.length === 0) return { error: `No company found matching "${name}"` };
    const co = companies[0] as Record<string, unknown>;
    companyInfo = co;
    entityName = co.name as string;
    const coId = co.id as string;

    const [c, d, a, v] = await Promise.all([
      db.from("crm_contacts").select("first_name, last_name, title, email, phone").eq("primary_company_id", coId).is("deleted_at", null).limit(10).then((r: { data: unknown[] | null }) => r.data ?? []),
      db.from("crm_deals").select("name, amount, expected_close_on, closed_at").eq("company_id", coId).is("deleted_at", null).order("created_at", { ascending: false }).limit(10).then((r: { data: unknown[] | null }) => r.data ?? []),
      db.from("crm_activities").select("activity_type, body, occurred_at").eq("company_id", coId).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(8).then((r: { data: unknown[] | null }) => r.data ?? []),
      db.from("voice_captures").select("transcript, sentiment, competitor_mentions, created_at").eq("linked_company_id", coId).not("transcript", "is", null).order("created_at", { ascending: false }).limit(3).then((r: { data: unknown[] | null }) => r.data ?? []),
    ]);
    contacts.push(...(c as Record<string, unknown>[]));
    deals.push(...(d as Record<string, unknown>[]));
    activities.push(...(a as Record<string, unknown>[]));
    voiceNotes.push(...(v as Record<string, unknown>[]));
  } else {
    const nameParts = name.split(/\s+/);
    let cq = db.from("crm_contacts").select("id, first_name, last_name, title, email, phone, primary_company_id").is("deleted_at", null);
    if (nameParts.length > 1) {
      cq = cq.ilike("first_name", `%${nameParts[0]}%`).ilike("last_name", `%${nameParts[nameParts.length - 1]}%`);
    } else {
      cq = cq.or(`first_name.ilike.${like},last_name.ilike.${like}`);
    }
    const { data: cList } = await cq.limit(1);
    if (!cList || cList.length === 0) return { error: `No contact found matching "${name}"` };
    const contact = cList[0] as Record<string, unknown>;
    entityName = `${contact.first_name} ${contact.last_name}`;
    contacts.push(contact);
    if (contact.primary_company_id) {
      const { data: co } = await db.from("crm_companies").select("id, name, industry, city, state").eq("id", contact.primary_company_id).single();
      companyInfo = co as Record<string, unknown> | null;
    }
    const cId = contact.id as string;
    const [d, a, v] = await Promise.all([
      db.from("crm_deals").select("name, amount, expected_close_on, closed_at").eq("primary_contact_id", cId).is("deleted_at", null).order("created_at", { ascending: false }).limit(10).then((r: { data: unknown[] | null }) => r.data ?? []),
      db.from("crm_activities").select("activity_type, body, occurred_at").eq("contact_id", cId).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(8).then((r: { data: unknown[] | null }) => r.data ?? []),
      db.from("voice_captures").select("transcript, sentiment, competitor_mentions, created_at").eq("linked_contact_id", cId).not("transcript", "is", null).order("created_at", { ascending: false }).limit(3).then((r: { data: unknown[] | null }) => r.data ?? []),
    ]);
    deals.push(...(d as Record<string, unknown>[]));
    activities.push(...(a as Record<string, unknown>[]));
    voiceNotes.push(...(v as Record<string, unknown>[]));
  }

  return {
    prep_data: {
      entity_type: entityType,
      entity_name: entityName,
      company: companyInfo ? { name: companyInfo.name, industry: companyInfo.industry, location: `${companyInfo.city ?? ""}${companyInfo.state ? `, ${companyInfo.state}` : ""}`.trim() || null } : null,
      contacts: contacts.map((c) => ({
        name: `${c.first_name} ${c.last_name}`,
        title: c.title,
        email: c.email,
        phone: c.phone,
      })),
      active_deals: deals.filter((d) => !d.closed_at).map((d) => ({
        name: d.name,
        amount: d.amount,
        close_date: d.expected_close_on,
      })),
      past_deals: deals.filter((d) => d.closed_at).length,
      recent_interactions: activities.slice(0, 5).map((a) => ({
        type: a.activity_type,
        summary: typeof a.body === "string" ? (a.body as string).slice(0, 150) : null,
        date: a.occurred_at,
      })),
      voice_insights: voiceNotes.map((v) => ({
        excerpt: typeof v.transcript === "string" ? (v.transcript as string).slice(0, 200) : null,
        sentiment: v.sentiment,
        competitors: v.competitor_mentions,
      })),
    },
    instruction: "Use this data to generate a comprehensive pre-meeting prep sheet. Include: key facts, open opportunities, relationship history, talking points, and watch-outs.",
  };
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
  getDealCoaching: (db, args) => execGetDealCoaching(db, args as Parameters<typeof execGetDealCoaching>[1]),
  createFollowUpTask: (db, args) => execCreateFollowUpTask(db, args as Parameters<typeof execCreateFollowUpTask>[1]),
  logActivity: (db, args) => execLogActivity(db, args as Parameters<typeof execLogActivity>[1]),
  updateDealStage: (db, args) => execUpdateDealStage(db, args as Parameters<typeof execUpdateDealStage>[1]),
  draftEmail: (db, args) => execDraftEmail(db, args as Parameters<typeof execDraftEmail>[1]),
  generatePrepSheet: (db, args) => execGeneratePrepSheet(db, args as Parameters<typeof execGeneratePrepSheet>[1]),
  getWinLossAnalysis: (db, args) => execGetWinLossAnalysis(db, args as Parameters<typeof execGetWinLossAnalysis>[1]),
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
