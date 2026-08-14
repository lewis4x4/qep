import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { logKbJobRunFinish, logKbJobRunStart } from "../_shared/kb-observability.ts";
import { embedTexts, formatVectorLiteral } from "../_shared/openai-embeddings.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

export const ENTITY_TYPES = ["contact", "company", "deal", "equipment", "voice_capture", "activity"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

const BATCH_SIZE = 20;

const ENTITY_TABLE_MAP: Record<Exclude<EntityType, "voice_capture">, string> = {
  contact: "crm_contacts",
  company: "crm_companies",
  deal: "crm_deals",
  equipment: "crm_equipment",
  activity: "crm_activities",
};

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret, x-workspace-id",
    "Vary": "Origin",
  };
}

function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export type WorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export function resolveEmbedCrmWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
}): WorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.authWorkspaceId);
    if (explicit) {
      return { mode: "scoped", workspaceId: explicit };
    }
    return { mode: "unscoped" };
  }

  const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
  if (!workspaceId) {
    return { mode: "scoped", workspaceId: "" };
  }
  return { mode: "scoped", workspaceId };
}

export type EmbedCrmAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

function hasAuthCredentials(req: Request): boolean {
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  const internalSecret = (req.headers.get("x-internal-service-secret") ?? "").trim();
  return authHeader.length > 0 || apiKey.length > 0 || internalSecret.length > 0;
}

export async function authenticateEmbedCrm(
  req: Request,
  adminClient: SupabaseClient,
): Promise<EmbedCrmAuthResult> {
  const caller = await resolveCallerContext(req, adminClient);

  if (caller.isServiceRole) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: caller.workspaceId,
    };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

  if (!caller.userId || !caller.role) {
    return { ok: false, status: 401 };
  }

  if (!["admin", "manager", "owner"].includes(caller.role)) {
    return { ok: false, status: 403 };
  }

  if (!caller.workspaceId) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: caller.userId,
    role: caller.role,
    workspaceId: caller.workspaceId,
  };
}

// ── Text summary builders ──────────────────────────────────────────────

function contactSummary(r: Record<string, unknown>): string {
  const parts = [`QRM Contact: ${r.first_name ?? ""} ${r.last_name ?? ""}`.trim()];
  if (r.email) parts.push(`Email: ${r.email}`);
  if (r.phone) parts.push(`Phone: ${r.phone}`);
  if (r.title) parts.push(`Title: ${r.title}`);
  if (r.company_name) parts.push(`Company: ${r.company_name}`);
  if (r.city || r.state) parts.push(`Location: ${[r.city, r.state].filter(Boolean).join(", ")}`);
  return parts.join("\n");
}

function companySummary(r: Record<string, unknown>): string {
  const parts = [`Company: ${r.name ?? "Unknown"}`];
  if (r.dba) parts.push(`DBA: ${r.dba}`);
  const aliasParts = [r.search_1, r.search_2].filter(Boolean).join(" ").trim();
  if (aliasParts) parts.push(`Alias: ${aliasParts}`);
  if (r.primary_contact_name) parts.push(`Primary Contact: ${r.primary_contact_name}`);
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
  const parts = [`QRM Deal: ${r.name ?? "Untitled"}`];
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
  if (r.contact_name) parts.push(`Linked Contact: ${r.contact_name}`);
  if (r.company_name) parts.push(`Linked Company: ${r.company_name}`);
  if (r.deal_name) parts.push(`Linked Deal: ${r.deal_name}`);
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
  const parts = [`QRM Activity (${r.activity_type ?? "note"}) on ${r.occurred_at ?? "unknown date"}`];
  if (r.body) parts.push(String(r.body).slice(0, 1500));
  return parts.join("\n");
}

// ── Workspace helpers ────────────────────────────────────────────────────

type AdminClient = SupabaseClient;

function applyWorkspaceFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  workspaceScope: WorkspaceScope,
  column = "workspace_id",
): T {
  if (workspaceScope.mode === "scoped") {
    return query.eq(column, workspaceScope.workspaceId);
  }
  return query;
}

async function fetchEntityIdsInWorkspace(
  db: AdminClient,
  table: string,
  workspaceId: string,
  limit = 200,
): Promise<string[]> {
  const { data } = await db
    .from(table)
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(limit);

  return (data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function fetchAllEntityIdsInWorkspace(
  db: AdminClient,
  table: string,
  workspaceId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data } = await db
      .from(table)
      .select("id")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .range(offset, offset + pageSize - 1);

    if (!data?.length) break;
    for (const row of data) {
      if (typeof row.id === "string") ids.push(row.id);
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return ids;
}

async function fetchVoiceCaptureIdsInWorkspace(
  db: AdminClient,
  workspaceId: string,
  limit = 200,
): Promise<string[]> {
  const [contactIds, companyIds, dealIds] = await Promise.all([
    fetchEntityIdsInWorkspace(db, "crm_contacts", workspaceId, limit),
    fetchEntityIdsInWorkspace(db, "crm_companies", workspaceId, limit),
    fetchEntityIdsInWorkspace(db, "crm_deals", workspaceId, limit),
  ]);

  const captureIds: string[] = [];

  if (contactIds.length > 0) {
    const { data } = await db
      .from("voice_captures")
      .select("id")
      .in("linked_contact_id", contactIds)
      .limit(limit);
    for (const row of data ?? []) {
      if (typeof row.id === "string") captureIds.push(row.id);
    }
  }

  if (companyIds.length > 0) {
    const { data } = await db
      .from("voice_captures")
      .select("id")
      .in("linked_company_id", companyIds)
      .limit(limit);
    for (const row of data ?? []) {
      if (typeof row.id === "string" && !captureIds.includes(row.id)) {
        captureIds.push(row.id);
      }
    }
  }

  if (dealIds.length > 0) {
    const { data } = await db
      .from("voice_captures")
      .select("id")
      .in("linked_deal_id", dealIds)
      .limit(limit);
    for (const row of data ?? []) {
      if (typeof row.id === "string" && !captureIds.includes(row.id)) {
        captureIds.push(row.id);
      }
    }
  }

  return captureIds.slice(0, limit);
}

async function resolveScopedSinceWatermark(
  db: AdminClient,
  entityType: EntityType,
  workspaceId: string,
): Promise<string | null> {
  let entityIds: string[];

  if (entityType === "voice_capture") {
    entityIds = await fetchVoiceCaptureIdsInWorkspace(db, workspaceId, 1000);
  } else {
    const table = ENTITY_TABLE_MAP[entityType];
    entityIds = await fetchAllEntityIdsInWorkspace(db, table, workspaceId);
  }

  if (entityIds.length === 0) return null;

  let maxUpdatedAt: string | null = null;
  for (let i = 0; i < entityIds.length; i += 500) {
    const batch = entityIds.slice(i, i + 500);
    const { data } = await db
      .from("crm_embeddings")
      .select("updated_at")
      .eq("entity_type", entityType)
      .in("entity_id", batch)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const ts = data?.updated_at as string | undefined;
    if (ts && (!maxUpdatedAt || ts > maxUpdatedAt)) {
      maxUpdatedAt = ts;
    }
  }

  return maxUpdatedAt;
}

async function resolveSinceWatermark(
  db: AdminClient,
  entityType: EntityType,
  workspaceScope: WorkspaceScope,
  forceAll: boolean,
): Promise<string | null> {
  if (forceAll) return null;

  if (workspaceScope.mode === "scoped") {
    return await resolveScopedSinceWatermark(db, entityType, workspaceScope.workspaceId);
  }

  const { data: latest } = await db
    .from("crm_embeddings")
    .select("updated_at")
    .eq("entity_type", entityType)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (latest?.updated_at as string) ?? null;
}

// ── Per-entity-type fetchers ───────────────────────────────────────────

interface PendingRecord {
  id: string;
  summary: string;
  metadata: Record<string, unknown>;
}

async function fetchPendingContacts(
  db: AdminClient,
  since: string | null,
  workspaceScope: WorkspaceScope,
): Promise<PendingRecord[]> {
  let query = db
    .from("crm_contacts")
    .select("id, first_name, last_name, email, phone, title, city, state, updated_at, primary_company_id")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);

  query = applyWorkspaceFilter(query, workspaceScope);
  if (since) query = query.gt("updated_at", since);

  const { data } = await query;
  if (!data) return [];

  const companyIds = [...new Set((data as Record<string, unknown>[]).map((c) => c.primary_company_id).filter(Boolean))];
  let companyMap: Record<string, string> = {};
  if (companyIds.length > 0) {
    let companyQuery = db.from("crm_companies").select("id, name").in("id", companyIds);
    companyQuery = applyWorkspaceFilter(companyQuery, workspaceScope);
    const { data: companies } = await companyQuery;
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

async function fetchPendingCompanies(
  db: AdminClient,
  since: string | null,
  workspaceScope: WorkspaceScope,
): Promise<PendingRecord[]> {
  let query = db
    .from("crm_companies")
    .select("id, name, dba, search_1, search_2, industry, city, state, country, website, phone, employee_count, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);

  query = applyWorkspaceFilter(query, workspaceScope);
  if (since) query = query.gt("updated_at", since);

  const { data } = await query;
  if (!data) return [];

  const rows = data as Record<string, unknown>[];
  const companyIds = rows.map((r) => r.id as string);

  let primaryContactMap: Record<string, string> = {};
  if (companyIds.length > 0) {
    let contactQuery = db
      .from("crm_contacts")
      .select("primary_company_id, first_name, last_name, created_at")
      .in("primary_company_id", companyIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    contactQuery = applyWorkspaceFilter(contactQuery, workspaceScope);

    const { data: contacts } = await contactQuery;
    if (contacts) {
      for (const c of contacts as { primary_company_id: string; first_name: string | null; last_name: string | null }[]) {
        if (primaryContactMap[c.primary_company_id]) continue;
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
        if (name) primaryContactMap[c.primary_company_id] = name;
      }
    }
  }

  return rows.map((r) => ({
    id: r.id as string,
    summary: companySummary({
      ...r,
      primary_contact_name: primaryContactMap[r.id as string],
    }),
    metadata: { updated_at: r.updated_at },
  }));
}

async function fetchPendingDeals(
  db: AdminClient,
  since: string | null,
  workspaceScope: WorkspaceScope,
): Promise<PendingRecord[]> {
  let query = db
    .from("crm_deals")
    .select("id, name, amount, expected_close_on, stage_id, primary_contact_id, company_id, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);

  query = applyWorkspaceFilter(query, workspaceScope);
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
    let contactQuery = db.from("crm_contacts").select("id, first_name, last_name").in("id", contactIds);
    contactQuery = applyWorkspaceFilter(contactQuery, workspaceScope);
    const { data: contacts } = await contactQuery;
    if (contacts) {
      contactMap = Object.fromEntries(
        (contacts as { id: string; first_name: string; last_name: string }[])
          .map((c) => [c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()]),
      );
    }
  }
  if (companyIds.length > 0) {
    let companyQuery = db.from("crm_companies").select("id, name").in("id", companyIds);
    companyQuery = applyWorkspaceFilter(companyQuery, workspaceScope);
    const { data: companies } = await companyQuery;
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

async function fetchPendingEquipment(
  db: AdminClient,
  since: string | null,
  workspaceScope: WorkspaceScope,
): Promise<PendingRecord[]> {
  let query = db
    .from("crm_equipment")
    .select("id, name, make, model, year, serial_number, category, condition, availability, engine_hours, location_description, current_market_value, daily_rental_rate, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(200);

  query = applyWorkspaceFilter(query, workspaceScope);
  if (since) query = query.gt("updated_at", since);

  const { data } = await query;
  if (!data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    summary: equipmentSummary(r),
    metadata: { updated_at: r.updated_at },
  }));
}

async function fetchVoiceCapturesByLinkedIds(
  db: AdminClient,
  column: "linked_contact_id" | "linked_company_id" | "linked_deal_id",
  linkedIds: string[],
  since: string | null,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (linkedIds.length === 0) return [];

  let query = db
    .from("voice_captures")
    .select("id, transcript, extracted_data, created_at, updated_at, linked_contact_id, linked_company_id, linked_deal_id")
    .in(column, linkedIds)
    .not("transcript", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (since) query = query.gt("updated_at", since);

  const { data } = await query;
  return (data ?? []) as Record<string, unknown>[];
}

async function fetchPendingVoiceCaptures(
  db: AdminClient,
  since: string | null,
  workspaceScope: WorkspaceScope,
): Promise<PendingRecord[]> {
  let rows: Record<string, unknown>[];

  if (workspaceScope.mode === "scoped") {
    const workspaceId = workspaceScope.workspaceId;
    const [contactIds, companyIds, dealIds] = await Promise.all([
      fetchEntityIdsInWorkspace(db, "crm_contacts", workspaceId, 200),
      fetchEntityIdsInWorkspace(db, "crm_companies", workspaceId, 200),
      fetchEntityIdsInWorkspace(db, "crm_deals", workspaceId, 200),
    ]);

    const byId = new Map<string, Record<string, unknown>>();

    for (const batch of await Promise.all([
      fetchVoiceCapturesByLinkedIds(db, "linked_contact_id", contactIds, since, 200),
      fetchVoiceCapturesByLinkedIds(db, "linked_company_id", companyIds, since, 200),
      fetchVoiceCapturesByLinkedIds(db, "linked_deal_id", dealIds, since, 200),
    ])) {
      for (const row of batch) {
        const id = row.id as string;
        if (id) byId.set(id, row);
      }
    }

    rows = [...byId.values()]
      .sort((a, b) => String(a.updated_at ?? a.created_at).localeCompare(String(b.updated_at ?? b.created_at)))
      .slice(0, 200);
  } else {
    let query = db
      .from("voice_captures")
      .select("id, transcript, extracted_data, created_at, updated_at, linked_contact_id, linked_company_id, linked_deal_id")
      .not("transcript", "is", null)
      .order("updated_at", { ascending: true })
      .limit(200);

    if (since) query = query.gt("updated_at", since);

    const { data } = await query;
    rows = (data ?? []) as Record<string, unknown>[];
  }

  const contactIds = [...new Set(rows.map((r) => r.linked_contact_id).filter(Boolean))];
  const companyIds = [...new Set(rows.map((r) => r.linked_company_id).filter(Boolean))];
  const dealIds = [...new Set(rows.map((r) => r.linked_deal_id).filter(Boolean))];

  let contactMap: Record<string, string> = {};
  let companyMap: Record<string, string> = {};
  let dealMap: Record<string, string> = {};

  if (contactIds.length > 0) {
    let contactQuery = db
      .from("crm_contacts")
      .select("id, first_name, last_name")
      .in("id", contactIds as string[]);
    contactQuery = applyWorkspaceFilter(contactQuery, workspaceScope);
    const { data: contacts } = await contactQuery;
    if (contacts) {
      contactMap = Object.fromEntries(
        (contacts as { id: string; first_name: string | null; last_name: string | null }[])
          .map((contact) => [contact.id, [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim()]),
      );
    }
  }

  if (companyIds.length > 0) {
    let companyQuery = db.from("crm_companies").select("id, name").in("id", companyIds as string[]);
    companyQuery = applyWorkspaceFilter(companyQuery, workspaceScope);
    const { data: companies } = await companyQuery;
    if (companies) {
      companyMap = Object.fromEntries((companies as { id: string; name: string }[]).map((company) => [company.id, company.name]));
    }
  }

  if (dealIds.length > 0) {
    let dealQuery = db.from("crm_deals").select("id, name").in("id", dealIds as string[]);
    dealQuery = applyWorkspaceFilter(dealQuery, workspaceScope);
    const { data: deals } = await dealQuery;
    if (deals) {
      dealMap = Object.fromEntries((deals as { id: string; name: string }[]).map((deal) => [deal.id, deal.name]));
    }
  }

  return rows.map((r) => ({
    id: r.id as string,
    summary: voiceCaptureSummary({
      ...r,
      contact_name: contactMap[r.linked_contact_id as string],
      company_name: companyMap[r.linked_company_id as string],
      deal_name: dealMap[r.linked_deal_id as string],
    }),
    metadata: { updated_at: r.updated_at ?? r.created_at },
  }));
}

async function fetchPendingActivities(
  db: AdminClient,
  since: string | null,
  workspaceScope: WorkspaceScope,
): Promise<PendingRecord[]> {
  let query = db
    .from("crm_activities")
    .select("id, activity_type, body, occurred_at, updated_at")
    .is("deleted_at", null)
    .not("body", "is", null)
    .order("updated_at", { ascending: true })
    .limit(200);

  query = applyWorkspaceFilter(query, workspaceScope);
  if (since) query = query.gt("updated_at", since);

  const { data } = await query;
  if (!data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    summary: activitySummary(r),
    metadata: { updated_at: r.updated_at },
  }));
}

type Fetcher = (
  db: AdminClient,
  since: string | null,
  workspaceScope: WorkspaceScope,
) => Promise<PendingRecord[]>;

const FETCHERS: Record<EntityType, Fetcher> = {
  contact: fetchPendingContacts,
  company: fetchPendingCompanies,
  deal: fetchPendingDeals,
  equipment: fetchPendingEquipment,
  voice_capture: fetchPendingVoiceCaptures,
  activity: fetchPendingActivities,
};

// ── Handler ────────────────────────────────────────────────────────────

export interface EmbedCrmHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<EmbedCrmAuthResult>;
  embedTextsFn: typeof embedTexts;
}

function defaultCreateAdminClient(): SupabaseClient {
  return createAdminClient();
}

const defaultDependencies: EmbedCrmHandlerDependencies = {
  createAdminClient: defaultCreateAdminClient,
  authenticate: authenticateEmbedCrm,
  embedTextsFn: embedTexts,
};

export async function handleEmbedCrm(
  req: Request,
  overrides: Partial<EmbedCrmHandlerDependencies> = {},
): Promise<Response> {
  const { createAdminClient: createClientFn, authenticate, embedTextsFn } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const adminClient = createClientFn();
  const auth = await authenticate(req, adminClient);

  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.status === 401 ? "Unauthorized" : "Forbidden" }), {
      status: auth.status,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  let requestedTypes: EntityType[] = [...ENTITY_TYPES];
  let forceAll = false;

  if (Array.isArray(body.entity_types)) {
    const filtered = (body.entity_types as string[]).filter((t) =>
      ENTITY_TYPES.includes(t as EntityType),
    ) as EntityType[];
    if (filtered.length > 0) requestedTypes = filtered;
  }
  if (body.force_all === true) forceAll = true;

  const workspaceScope = auth.isServiceRole
    ? resolveEmbedCrmWorkspace({
      isServiceRole: true,
      authWorkspaceId: auth.headerWorkspaceId,
      requestedWorkspaceId: body.workspace_id as string | undefined,
    })
    : resolveEmbedCrmWorkspace({
      isServiceRole: false,
      authWorkspaceId: auth.workspaceId,
      requestedWorkspaceId: body.workspace_id as string | undefined,
    });

  if (workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const jobWorkspaceId = workspaceScope.mode === "scoped" ? workspaceScope.workspaceId : null;

  const results: Record<string, { processed: number; errors: number }> = {};
  const runId = await logKbJobRunStart(adminClient, {
    workspaceId: jobWorkspaceId,
    jobName: "embed_crm",
    metadata: {
      requested_types: requestedTypes,
      force_all: forceAll,
      workspace_scope: workspaceScope.mode,
      workspace_id: jobWorkspaceId,
    },
  });

  try {
    for (const entityType of requestedTypes) {
      let processed = 0;
      let errors = 0;

      try {
        const since = await resolveSinceWatermark(adminClient, entityType, workspaceScope, forceAll);
        const pending = await FETCHERS[entityType](adminClient, since, workspaceScope);

        if (pending.length === 0) {
          results[entityType] = { processed: 0, errors: 0 };
          continue;
        }

        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
          const batch = pending.slice(i, i + BATCH_SIZE);
          try {
            const texts = batch.map((r) => r.summary);
            const embeddings = await embedTextsFn(texts);

            const rows = batch.map((r, idx) => ({
              entity_type: entityType,
              entity_id: r.id,
              content: r.summary,
              embedding: formatVectorLiteral(embeddings[idx]),
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
        errors += 1;
      }

      results[entityType] = { processed, errors };
    }

    const totalProcessed = Object.values(results).reduce((sum, r) => sum + r.processed, 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors, 0);

    console.info("[embed-crm] completed", {
      totalProcessed,
      totalErrors,
      workspace_scope: workspaceScope.mode,
      workspace_id: jobWorkspaceId,
      byEntityType: results,
    });

    await logKbJobRunFinish(adminClient, {
      runId,
      status: totalErrors > 0 ? "error" : "success",
      processedCount: totalProcessed,
      errorCount: totalErrors,
      metadata: {
        details: results,
        workspace_scope: workspaceScope.mode,
        workspace_id: jobWorkspaceId,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        total_processed: totalProcessed,
        total_errors: totalErrors,
        workspace_scope: workspaceScope.mode,
        workspace_id: jobWorkspaceId,
        details: results,
      }),
      {
        status: 200,
        headers: { ...ch, "Content-Type": "application/json" },
      },
    );
  } catch (fatalError) {
    await logKbJobRunFinish(adminClient, {
      runId,
      status: "error",
      errorCount: 1,
      metadata: {
        fatal_error: fatalError instanceof Error ? fatalError.message : String(fatalError),
        workspace_scope: workspaceScope.mode,
        workspace_id: jobWorkspaceId,
      },
    });
    throw fatalError;
  }
}
