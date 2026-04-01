/**
 * CRM Record Embedding Edge Function
 *
 * Generates text summaries of CRM records (contacts, companies, deals,
 * equipment, voice captures, activities), embeds them via OpenAI, and
 * upserts into the crm_embeddings table for semantic search.
 *
 * Can be invoked manually (POST with auth) or via cron / service role.
 * Only processes records that are new or updated since last embedding.
 */
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Vary": "Origin",
  };
}

const ENTITY_TYPES = ["contact", "company", "deal", "equipment", "voice_capture", "activity"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const BATCH_SIZE = 20;
const EMBED_MODEL = "text-embedding-3-small";

// ── Text summary builders ──────────────────────────────────────────────

function contactSummary(r: Record<string, unknown>): string {
  const parts = [`CRM Contact: ${r.first_name ?? ""} ${r.last_name ?? ""}`.trim()];
  if (r.email) parts.push(`Email: ${r.email}`);
  if (r.phone) parts.push(`Phone: ${r.phone}`);
  if (r.title) parts.push(`Title: ${r.title}`);
  if (r.company_name) parts.push(`Company: ${r.company_name}`);
  if (r.city || r.state) parts.push(`Location: ${[r.city, r.state].filter(Boolean).join(", ")}`);
  return parts.join("\n");
}

function companySummary(r: Record<string, unknown>): string {
  const parts = [`CRM Company: ${r.name ?? "Unknown"}`];
  if (r.industry) parts.push(`Industry: ${r.industry}`);
  if (r.city || r.state || r.country) {
    parts.push(`Location: ${[r.city, r.state, r.country].filter(Boolean).join(", ")}`);
  }
  if (r.website) parts.push(`Website: ${r.website}`);
  if (r.phone) parts.push(`Phone: ${r.phone}`);
  if (r.employee_count) parts.push(`Employees: ${r.employee_count}`);
  return parts.join("\n");
}

function dealSummary(r: Record<string, unknown>): string {
  const parts = [`CRM Deal: ${r.name ?? "Untitled"}`];
  if (r.amount != null) parts.push(`Amount: $${Number(r.amount).toLocaleString()}`);
  if (r.stage_name) parts.push(`Stage: ${r.stage_name}`);
  if (r.expected_close_on) parts.push(`Expected Close: ${r.expected_close_on}`);
  if (r.contact_name) parts.push(`Contact: ${r.contact_name}`);
  if (r.company_name) parts.push(`Company: ${r.company_name}`);
  return parts.join("\n");
}

function equipmentSummary(r: Record<string, unknown>): string {
  const parts = [`Equipment: ${r.name ?? "Unknown"}`];
  const makeModelYear = [r.make, r.model, r.year].filter(Boolean).join(" ");
  if (makeModelYear) parts.push(`Make/Model/Year: ${makeModelYear}`);
  if (r.serial_number) parts.push(`Serial: ${r.serial_number}`);
  if (r.category) parts.push(`Category: ${r.category}`);
  if (r.condition) parts.push(`Condition: ${r.condition}`);
  if (r.availability) parts.push(`Availability: ${r.availability}`);
  if (r.engine_hours != null) parts.push(`Engine Hours: ${r.engine_hours}`);
  if (r.location_description) parts.push(`Location: ${r.location_description}`);
  if (r.current_market_value != null) parts.push(`Market Value: $${Number(r.current_market_value).toLocaleString()}`);
  if (r.daily_rental_rate != null) parts.push(`Daily Rental: $${Number(r.daily_rental_rate).toLocaleString()}`);
  return parts.join("\n");
}

function voiceCaptureSummary(r: Record<string, unknown>): string {
  const parts = [`Voice Note (${r.created_at ?? "unknown date"})`];
  if (r.transcript) parts.push(String(r.transcript).slice(0, 1500));
  if (r.extracted_data && typeof r.extracted_data === "object") {
    try {
      const ext = JSON.stringify(r.extracted_data);
      if (ext.length > 2) parts.push(`Extracted Data: ${ext.slice(0, 500)}`);
    } catch { /* ignore */ }
  }
  return parts.join("\n");
}

function activitySummary(r: Record<string, unknown>): string {
  const parts = [`CRM Activity (${r.activity_type ?? "note"}) on ${r.occurred_at ?? "unknown date"}`];
  if (r.body) parts.push(String(r.body).slice(0, 1500));
  return parts.join("\n");
}

// ── Embedding via OpenAI ───────────────────────────────────────────────

async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Embedding API error: ${JSON.stringify(data)}`);
  }
  return (data.data as Array<{ embedding: number[] }>)
    .sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0))
    .map((d: { embedding: number[] }) => d.embedding);
}

// ── Per-entity-type fetchers ───────────────────────────────────────────

interface PendingRecord {
  id: string;
  summary: string;
  metadata: Record<string, unknown>;
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function fetchPendingContacts(db: AdminClient, since: string | null): Promise<PendingRecord[]> {
  let query = db
    .from("crm_contacts")
    .select("id, first_name, last_name, email, phone, title, city, state, updated_at, primary_company_id")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);
  if (since) query = query.gt("updated_at", since);
  const { data } = await query;
  if (!data) return [];

  const companyIds = [...new Set((data as Record<string, unknown>[]).map((c) => c.primary_company_id).filter(Boolean))];
  let companyMap: Record<string, string> = {};
  if (companyIds.length > 0) {
    const { data: companies } = await db.from("crm_companies").select("id, name").in("id", companyIds);
    if (companies) {
      companyMap = Object.fromEntries((companies as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    }
  }

  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    summary: contactSummary({ ...r, company_name: companyMap[r.primary_company_id as string] }),
    metadata: { updated_at: r.updated_at },
  }));
}

async function fetchPendingCompanies(db: AdminClient, since: string | null): Promise<PendingRecord[]> {
  let query = db
    .from("crm_companies")
    .select("id, name, industry, city, state, country, website, phone, employee_count, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);
  if (since) query = query.gt("updated_at", since);
  const { data } = await query;
  if (!data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    summary: companySummary(r),
    metadata: { updated_at: r.updated_at },
  }));
}

async function fetchPendingDeals(db: AdminClient, since: string | null): Promise<PendingRecord[]> {
  let query = db
    .from("crm_deals")
    .select("id, name, amount, expected_close_on, stage_id, primary_contact_id, company_id, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);
  if (since) query = query.gt("updated_at", since);
  const { data } = await query;
  if (!data) return [];

  const contactIds = [...new Set((data as Record<string, unknown>[]).map((d) => d.primary_contact_id).filter(Boolean))];
  const companyIds = [...new Set((data as Record<string, unknown>[]).map((d) => d.company_id).filter(Boolean))];
  const stageIds = [...new Set((data as Record<string, unknown>[]).map((d) => d.stage_id).filter(Boolean))];

  let contactMap: Record<string, string> = {};
  let companyMap: Record<string, string> = {};
  let stageMap: Record<string, string> = {};

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
    if (companies) {
      companyMap = Object.fromEntries((companies as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    }
  }
  if (stageIds.length > 0) {
    const { data: stages } = await db.from("crm_deal_stages").select("id, name").in("id", stageIds);
    if (stages) {
      stageMap = Object.fromEntries((stages as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    }
  }

  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    summary: dealSummary({
      ...r,
      stage_name: stageMap[r.stage_id as string],
      contact_name: contactMap[r.primary_contact_id as string],
      company_name: companyMap[r.company_id as string],
    }),
    metadata: { updated_at: r.updated_at },
  }));
}

async function fetchPendingEquipment(db: AdminClient, since: string | null): Promise<PendingRecord[]> {
  let query = db
    .from("crm_equipment")
    .select("id, name, make, model, year, serial_number, category, condition, availability, engine_hours, location_description, current_market_value, daily_rental_rate, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);
  if (since) query = query.gt("updated_at", since);
  const { data } = await query;
  if (!data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    summary: equipmentSummary(r),
    metadata: { updated_at: r.updated_at },
  }));
}

async function fetchPendingVoiceCaptures(db: AdminClient, since: string | null): Promise<PendingRecord[]> {
  let query = db
    .from("voice_captures")
    .select("id, transcript, extracted_data, created_at, updated_at")
    .not("transcript", "is", null)
    .order("updated_at", { ascending: true })
    .limit(200);
  if (since) query = query.gt("updated_at", since);
  const { data } = await query;
  if (!data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    summary: voiceCaptureSummary(r),
    metadata: { updated_at: r.updated_at ?? r.created_at },
  }));
}

async function fetchPendingActivities(db: AdminClient, since: string | null): Promise<PendingRecord[]> {
  let query = db
    .from("crm_activities")
    .select("id, activity_type, body, occurred_at, updated_at")
    .is("deleted_at", null)
    .not("body", "is", null)
    .order("updated_at", { ascending: true })
    .limit(200);
  if (since) query = query.gt("updated_at", since);
  const { data } = await query;
  if (!data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    summary: activitySummary(r),
    metadata: { updated_at: r.updated_at },
  }));
}

const FETCHERS: Record<EntityType, (db: AdminClient, since: string | null) => Promise<PendingRecord[]>> = {
  contact: fetchPendingContacts,
  company: fetchPendingCompanies,
  deal: fetchPendingDeals,
  equipment: fetchPendingEquipment,
  voice_capture: fetchPendingVoiceCaptures,
  activity: fetchPendingActivities,
};

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const adminClient = createAdminClient();

  // Auth: require admin/owner/manager, service role, or service-role-key bearer
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceRoleBearer =
    serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`;

  if (!isServiceRoleBearer) {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.isServiceRole) {
      if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }
    }
  }

  let requestedTypes: EntityType[] = [...ENTITY_TYPES];
  let forceAll = false;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (Array.isArray(body.entity_types)) {
      const filtered = (body.entity_types as string[]).filter((t) =>
        ENTITY_TYPES.includes(t as EntityType)
      ) as EntityType[];
      if (filtered.length > 0) requestedTypes = filtered;
    }
    if (body.force_all === true) forceAll = true;
  } catch { /* use defaults */ }

  const results: Record<string, { processed: number; errors: number }> = {};

  for (const entityType of requestedTypes) {
    let processed = 0;
    let errors = 0;

    try {
      // Find the latest embedding timestamp for this entity type (for incremental sync)
      let since: string | null = null;
      if (!forceAll) {
        const { data: latest } = await adminClient
          .from("crm_embeddings")
          .select("updated_at")
          .eq("entity_type", entityType)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        since = (latest?.updated_at as string) ?? null;
      }

      const pending = await FETCHERS[entityType](adminClient, since);
      if (pending.length === 0) {
        results[entityType] = { processed: 0, errors: 0 };
        continue;
      }

      // Process in batches
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        try {
          const texts = batch.map((r) => r.summary);
          const embeddings = await embedTexts(texts);

          const rows = batch.map((r, idx) => ({
            entity_type: entityType,
            entity_id: r.id,
            content: r.summary,
            embedding: `[${embeddings[idx].join(",")}]`,
            metadata: r.metadata,
            updated_at: new Date().toISOString(),
          }));

          const { error } = await adminClient
            .from("crm_embeddings")
            .upsert(rows, { onConflict: "entity_type,entity_id", ignoreDuplicates: false });

          if (error) {
            console.error(`[embed-crm] upsert error for ${entityType}:`, error.message);
            errors += batch.length;
          } else {
            processed += batch.length;
          }
        } catch (batchErr) {
          console.error(`[embed-crm] batch error for ${entityType}:`, batchErr);
          errors += batch.length;
        }
      }
    } catch (typeErr) {
      console.error(`[embed-crm] error processing ${entityType}:`, typeErr);
      errors++;
    }

    results[entityType] = { processed, errors };
  }

  const totalProcessed = Object.values(results).reduce((sum, r) => sum + r.processed, 0);
  const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors, 0);

  console.log(`[embed-crm] complete: ${totalProcessed} embedded, ${totalErrors} errors`, results);

  return new Response(
    JSON.stringify({
      success: true,
      total_processed: totalProcessed,
      total_errors: totalErrors,
      details: results,
    }),
    {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    },
  );
});
