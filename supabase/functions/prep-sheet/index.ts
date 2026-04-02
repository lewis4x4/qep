/**
 * Customer Prep Sheet Edge Function
 *
 * Generates a comprehensive pre-meeting brief by:
 * 1. Looking up the company/contact and all related CRM data
 * 2. Pulling voice notes, activities, equipment, deals, valuations
 * 3. Using GPT to synthesize a one-page actionable prep sheet
 *
 * Returns markdown formatted for printing or display.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

const PREP_MODEL = "gpt-5.4-mini";

interface PrepData {
  entity_type: "company" | "contact";
  entity_name: string;
  company: Record<string, unknown> | null;
  contacts: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  activities: Record<string, unknown>[];
  voiceNotes: Record<string, unknown>[];
  equipment: Record<string, unknown>[];
  valuations: Record<string, unknown>[];
  competitorMentions: Record<string, unknown>[];
}

// deno-lint-ignore no-explicit-any
type DB = any;

async function gatherPrepData(db: DB, entityType: string, name: string): Promise<PrepData | null> {
  // Sanitize: strip PostgREST filter operators and control chars
  const sanitized = name.replace(/[%_\\().,]/g, " ").replace(/\s+/g, " ").trim();
  if (!sanitized) return null;
  const like = `%${sanitized}%`;

  if (entityType === "company") {
    const { data: companies } = await db
      .from("crm_companies")
      .select("id, name, industry, website, phone, city, state, metadata, created_at")
      .ilike("name", like)
      .is("deleted_at", null)
      .limit(1);

    if (!companies || companies.length === 0) return null;
    const company = companies[0] as Record<string, unknown>;
    const companyId = company.id as string;

    const [contacts, deals, activities, voiceNotes, equipment, valuations] =
      await Promise.all([
        db.from("crm_contacts")
          .select("id, first_name, last_name, email, phone, title, created_at")
          .eq("primary_company_id", companyId)
          .is("deleted_at", null)
          .limit(10)
          .then((r: { data: unknown[] | null }) => r.data ?? []),

        db.from("crm_deals")
          .select("id, name, amount, stage_id, expected_close_on, created_at, closed_at, loss_reason")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(10)
          .then((r: { data: unknown[] | null }) => r.data ?? []),

        db.from("crm_activities")
          .select("id, activity_type, body, occurred_at")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .order("occurred_at", { ascending: false })
          .limit(10)
          .then((r: { data: unknown[] | null }) => r.data ?? []),

        db.from("voice_captures")
          .select("id, transcript, sentiment, competitor_mentions, created_at")
          .eq("linked_company_id", companyId)
          .not("transcript", "is", null)
          .order("created_at", { ascending: false })
          .limit(5)
          .then((r: { data: unknown[] | null }) => r.data ?? []),

        db.from("crm_equipment")
          .select("id, name, make, model, year, condition, status, list_price")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .limit(10)
          .then((r: { data: unknown[] | null }) => r.data ?? []),

        db.from("market_valuations")
          .select("id, equipment_description, estimated_value_low, estimated_value_high, source")
          .ilike("equipment_description", like)
          .order("valuation_date", { ascending: false })
          .limit(5)
          .then((r: { data: unknown[] | null }) => r.data ?? []),
      ]);

    // Fetch competitive mentions separately since it depends on voiceNotes IDs
    const voiceNoteIds = (voiceNotes as Record<string, unknown>[])
      .map((v) => v.id)
      .filter(Boolean) as string[];
    let competitorMentions: unknown[] = [];
    if (voiceNoteIds.length > 0) {
      const { data: mentions } = await db.from("competitive_mentions")
        .select("competitor_name, sentiment, context, created_at")
        .in("voice_capture_id", voiceNoteIds)
        .order("created_at", { ascending: false })
        .limit(5);
      competitorMentions = mentions ?? [];
    }

    return {
      entity_type: "company",
      entity_name: company.name as string,
      company,
      contacts: contacts as Record<string, unknown>[],
      deals: deals as Record<string, unknown>[],
      activities: activities as Record<string, unknown>[],
      voiceNotes: voiceNotes as Record<string, unknown>[],
      equipment: equipment as Record<string, unknown>[],
      valuations: valuations as Record<string, unknown>[],
      competitorMentions: competitorMentions as Record<string, unknown>[],
    };
  }

  // Contact-based prep
  const nameParts = name.trim().split(/\s+/);
  let contactQuery = db
    .from("crm_contacts")
    .select("id, first_name, last_name, email, phone, title, primary_company_id, created_at")
    .is("deleted_at", null);

  if (nameParts.length > 1) {
    contactQuery = contactQuery
      .ilike("first_name", `%${nameParts[0]}%`)
      .ilike("last_name", `%${nameParts[nameParts.length - 1]}%`);
  } else {
    contactQuery = contactQuery
      .or(`first_name.ilike.${like},last_name.ilike.${like}`);
  }

  const { data: contacts } = await contactQuery.limit(1);
  if (!contacts || contacts.length === 0) return null;
  const contact = contacts[0] as Record<string, unknown>;

  let company: Record<string, unknown> | null = null;
  if (contact.primary_company_id) {
    const { data: co } = await db
      .from("crm_companies")
      .select("id, name, industry, website, phone, city, state")
      .eq("id", contact.primary_company_id)
      .single();
    company = co as Record<string, unknown> | null;
  }

  const contactId = contact.id as string;
  const [deals, activities, voiceNotes] = await Promise.all([
    db.from("crm_deals")
      .select("id, name, amount, stage_id, expected_close_on, created_at, closed_at")
      .eq("primary_contact_id", contactId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10)
      .then((r: { data: unknown[] | null }) => r.data ?? []),

    db.from("crm_activities")
      .select("id, activity_type, body, occurred_at")
      .eq("contact_id", contactId)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(10)
      .then((r: { data: unknown[] | null }) => r.data ?? []),

    db.from("voice_captures")
      .select("id, transcript, sentiment, competitor_mentions, created_at")
      .eq("linked_contact_id", contactId)
      .not("transcript", "is", null)
      .order("created_at", { ascending: false })
      .limit(5)
      .then((r: { data: unknown[] | null }) => r.data ?? []),
  ]);

  return {
    entity_type: "contact",
    entity_name: `${contact.first_name} ${contact.last_name}`,
    company,
    contacts: [contact],
    deals: deals as Record<string, unknown>[],
    activities: activities as Record<string, unknown>[],
    voiceNotes: voiceNotes as Record<string, unknown>[],
    equipment: [],
    valuations: [],
    competitorMentions: [],
  };
}

async function generatePrepSheet(data: PrepData): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const dataBlock = JSON.stringify({
    entity: data.entity_name,
    type: data.entity_type,
    company: data.company
      ? { name: data.company.name, industry: data.company.industry, city: data.company.city, state: data.company.state }
      : null,
    contacts: data.contacts.map((c) => ({
      name: `${c.first_name} ${c.last_name}`,
      title: c.title,
      email: c.email,
      phone: c.phone,
    })),
    deals: data.deals.map((d) => ({
      name: d.name,
      amount: d.amount,
      close_date: d.expected_close_on,
      closed: d.closed_at ? true : false,
    })),
    recent_activities: data.activities.slice(0, 5).map((a) => ({
      type: a.activity_type,
      body: typeof a.body === "string" ? (a.body as string).slice(0, 200) : null,
      date: a.occurred_at,
    })),
    voice_note_excerpts: data.voiceNotes.slice(0, 3).map((v) => ({
      excerpt: typeof v.transcript === "string" ? (v.transcript as string).slice(0, 300) : null,
      sentiment: v.sentiment,
      competitors: v.competitor_mentions,
      date: v.created_at,
    })),
    equipment: data.equipment.slice(0, 5).map((e) => ({
      name: e.name,
      make: e.make,
      model: e.model,
      condition: e.condition,
      price: e.list_price,
    })),
    competitor_mentions: data.competitorMentions.slice(0, 3).map((c) => ({
      competitor: c.competitor_name,
      sentiment: c.sentiment,
    })),
  }, null, 2);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: PREP_MODEL,
      max_completion_tokens: 1500,
      messages: [
        {
          role: "system",
          content: `You are a sales operations assistant generating pre-meeting customer prep sheets for heavy equipment sales reps. Create concise, actionable briefs in markdown format. Use only the data provided — do not fabricate.`,
        },
        {
          role: "user",
          content: `Generate a customer prep sheet for a meeting on ${today} with the following data:

${dataBlock}

Format as a clean markdown prep sheet with these sections:
# Customer Prep Sheet: [Name]
**Date:** ${today}

## At a Glance
Key facts in a bullet list (company, industry, location, key contacts)

## Open Opportunities
Active deals with amounts and expected close dates

## Relationship History
Summary of recent interactions — what happened, when, any patterns

## Intelligence Notes
Key insights from voice notes — sentiment, competitors mentioned, concerns

## Equipment Interest
Any equipment they own, are looking at, or have been quoted

## Talking Points
3-5 specific conversation starters based on the data above

## Watch Out For
Any red flags, competitor activity, or sensitive topics

Keep it under 500 words. Be specific and actionable.`,
        },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI error: ${payload?.error?.message ?? response.status}`);
  }

  return payload.choices?.[0]?.message?.content?.trim() ?? "Unable to generate prep sheet.";
}

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return jsonError("Unauthorized", 401, ch);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonError("Unauthorized", 401, ch);
    }

    const adminDb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Enforce role: only reps, managers, admins, and owners
    const { data: profile } = await adminDb
      .from("profiles")
      .select("role, workspace_id")
      .eq("id", user.id)
      .single();

    if (!profile || !["rep", "admin", "manager", "owner"].includes(profile.role)) {
      return jsonError("Forbidden", 403, ch);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const entityType = (body.entity_type as string) ?? "company";
    const name = (body.name as string)?.trim()?.slice(0, 200);

    if (!name) {
      return jsonError("name is required", 400, ch);
    }
    if (!["company", "contact"].includes(entityType)) {
      return jsonError("entity_type must be 'company' or 'contact'", 400, ch);
    }

    const data = await gatherPrepData(adminDb, entityType, name);
    if (!data) {
      return jsonError(`No ${entityType} found matching "${name}"`, 404, ch);
    }

    const prepSheet = await generatePrepSheet(data);

    return new Response(JSON.stringify({
      entity_type: data.entity_type,
      entity_name: data.entity_name,
      prep_sheet: prepSheet,
      data_summary: {
        contacts: data.contacts.length,
        deals: data.deals.length,
        activities: data.activities.length,
        voice_notes: data.voiceNotes.length,
        equipment: data.equipment.length,
      },
    }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("prep-sheet error:", err);
    return jsonError("Failed to generate prep sheet", 500, ch);
  }
});

function jsonError(message: string, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
