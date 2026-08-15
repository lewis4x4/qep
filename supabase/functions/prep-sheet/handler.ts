/**
 * Customer Prep Sheet Edge Function
 *
 * Generates a comprehensive pre-meeting brief by:
 * 1. Looking up the company/contact and all related QRM data
 * 2. Pulling voice notes, activities, equipment, deals, valuations
 * 3. Using GPT to synthesize a one-page actionable prep sheet
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (rep/admin/manager/owner): always uses profiles.active_workspace_id.
 *   Body `workspace` / `workspace_id` is ignored so a forged target cannot
 *   retarget prep data. Missing active workspace fails closed (403).
 * - Service role (cron / internal): requires an explicit workspace via
 *   `x-workspace-id` header and/or body `workspace` / `workspace_id`.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
  type CallerContext,
} from "../_shared/dge-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

export const PREP_SHEET_ALLOWED_ROLES = [
  "rep",
  "admin",
  "manager",
  "owner",
] as const;

export const PREP_MODEL = "gpt-5.4-mini";

export interface PrepSheetBody {
  entity_type?: unknown;
  name?: unknown;
  workspace?: unknown;
  workspace_id?: unknown;
}

export interface PrepData {
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

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-workspace-id",
    "Vary": "Origin",
  };
}

export function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolvePrepSheetWorkspace(params: {
  isServiceRole: boolean;
  callerWorkspaceId: string | null;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; workspaceId: string }
  | { ok: false; status: 400 | 403; message: string } {
  const callerWorkspaceId = cleanString(params.callerWorkspaceId);
  const requestedWorkspaceId = cleanString(params.requestedWorkspaceId);

  if (!params.isServiceRole) {
    if (!callerWorkspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    return { ok: true, workspaceId: callerWorkspaceId };
  }

  if (
    callerWorkspaceId && requestedWorkspaceId &&
    callerWorkspaceId !== requestedWorkspaceId
  ) {
    return {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    };
  }

  const workspaceId = callerWorkspaceId ?? requestedWorkspaceId;
  if (!workspaceId) {
    return {
      ok: false,
      status: 400,
      message: "Service callers must provide an explicit workspace target",
    };
  }
  return { ok: true, workspaceId };
}

function sanitizeEntityName(name: string): string | null {
  const sanitized = name.replace(/[%_\\().,]/g, " ").replace(/\s+/g, " ").trim();
  return sanitized.length > 0 ? sanitized : null;
}

export async function gatherPrepData(
  db: DB,
  workspaceId: string,
  entityType: string,
  name: string,
): Promise<PrepData | null> {
  const sanitized = sanitizeEntityName(name);
  if (!sanitized) return null;
  const like = `%${sanitized}%`;

  if (entityType === "company") {
    const { data: companies } = await db
      .from("crm_companies")
      .select("id, name, industry, website, phone, city, state, metadata, created_at")
      .eq("workspace_id", workspaceId)
      .ilike("name", like)
      .is("deleted_at", null)
      .limit(1);

    if (!companies || companies.length === 0) return null;
    const company = companies[0] as Record<string, unknown>;
    const companyId = company.id as string;

    const [contacts, deals, activities, voiceNotes, equipment] = await Promise.all([
      db.from("crm_contacts")
        .select("id, first_name, last_name, email, phone, title, created_at")
        .eq("workspace_id", workspaceId)
        .eq("primary_company_id", companyId)
        .is("deleted_at", null)
        .limit(10)
        .then((r: { data: unknown[] | null }) => r.data ?? []),

      db.from("crm_deals")
        .select("id, name, amount, stage_id, expected_close_on, created_at, closed_at, loss_reason")
        .eq("workspace_id", workspaceId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10)
        .then((r: { data: unknown[] | null }) => r.data ?? []),

      db.from("crm_activities")
        .select("id, activity_type, body, occurred_at")
        .eq("workspace_id", workspaceId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(10)
        .then((r: { data: unknown[] | null }) => r.data ?? []),

      db.from("voice_captures")
        .select("id, transcript, sentiment, competitor_mentions, created_at")
        .eq("workspace_id", workspaceId)
        .eq("linked_company_id", companyId)
        .not("transcript", "is", null)
        .order("created_at", { ascending: false })
        .limit(5)
        .then((r: { data: unknown[] | null }) => r.data ?? []),

      db.from("crm_equipment")
        .select("id, name, make, model, year, condition, status, list_price")
        .eq("workspace_id", workspaceId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .limit(10)
        .then((r: { data: unknown[] | null }) => r.data ?? []),
    ]);

    const valuations = await loadWorkspaceValuations(
      db,
      equipment as Record<string, unknown>[],
    );

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
      valuations,
      competitorMentions: competitorMentions as Record<string, unknown>[],
    };
  }

  const nameParts = name.trim().split(/\s+/);
  let contactQuery = db
    .from("crm_contacts")
    .select("id, first_name, last_name, email, phone, title, primary_company_id, created_at")
    .eq("workspace_id", workspaceId)
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
      .eq("workspace_id", workspaceId)
      .eq("id", contact.primary_company_id)
      .single();
    company = co as Record<string, unknown> | null;
  }

  const contactId = contact.id as string;
  const [deals, activities, voiceNotes] = await Promise.all([
    db.from("crm_deals")
      .select("id, name, amount, stage_id, expected_close_on, created_at, closed_at")
      .eq("workspace_id", workspaceId)
      .eq("primary_contact_id", contactId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10)
      .then((r: { data: unknown[] | null }) => r.data ?? []),

    db.from("crm_activities")
      .select("id, activity_type, body, occurred_at")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(10)
      .then((r: { data: unknown[] | null }) => r.data ?? []),

    db.from("voice_captures")
      .select("id, transcript, sentiment, competitor_mentions, created_at")
      .eq("workspace_id", workspaceId)
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

async function loadWorkspaceValuations(
  db: DB,
  equipment: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (equipment.length === 0) return [];

  const valuations: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const item of equipment.slice(0, 5)) {
    const make = cleanString(item.make);
    const model = cleanString(item.model);
    const year = typeof item.year === "number" ? item.year : null;
    if (!make || !model || year == null) continue;

    const key = `${make}|${model}|${year}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { data } = await db
      .from("market_valuations")
      .select("id, make, model, year, low_estimate, high_estimate, estimated_fmv, source")
      .eq("make", make)
      .eq("model", model)
      .eq("year", year)
      .order("created_at", { ascending: false })
      .limit(1);

    if (data?.[0]) {
      valuations.push(data[0] as Record<string, unknown>);
    }
  }

  // market_valuations has no workspace_id column; scope indirectly via
  // workspace-bound equipment already loaded for this shop.
  return valuations;
}

export async function generatePrepSheet(data: PrepData): Promise<string> {
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
      ? {
        name: data.company.name,
        industry: data.company.industry,
        city: data.company.city,
        state: data.company.state,
      }
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
          content:
            "You are a sales operations assistant generating pre-meeting customer prep sheets for heavy equipment sales reps. Create concise, actionable briefs in markdown format. Use only the data provided — do not fabricate.",
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

async function readBody(req: Request): Promise<PrepSheetBody> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as PrepSheetBody;
}

export interface PrepSheetDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  gatherPrepData: typeof gatherPrepData;
  generatePrepSheet: typeof generatePrepSheet;
}

const defaultDependencies: PrepSheetDependencies = {
  createAdminClient,
  resolveCallerContext,
  gatherPrepData,
  generatePrepSheet,
};

function jsonError(
  message: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export async function handlePrepSheet(
  req: Request,
  overrides: Partial<PrepSheetDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  try {
    const adminDb = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, adminDb);

    if (!caller.isServiceRole) {
      if (!caller.userId || !caller.role) {
        return jsonError("Unauthorized", 401, ch);
      }
      if (!PREP_SHEET_ALLOWED_ROLES.includes(caller.role)) {
        return jsonError("Forbidden", 403, ch);
      }
    }

    const body = await readBody(req);
    const requestedWorkspaceId = cleanString(body.workspace) ??
      cleanString(body.workspace_id);
    const workspaceSelection = resolvePrepSheetWorkspace({
      isServiceRole: caller.isServiceRole,
      callerWorkspaceId: caller.workspaceId,
      requestedWorkspaceId,
    });
    if (!workspaceSelection.ok) {
      return jsonError(
        workspaceSelection.message,
        workspaceSelection.status,
        ch,
      );
    }
    const workspaceId = workspaceSelection.workspaceId;

    const entityType = (body.entity_type as string) ?? "company";
    const name = (body.name as string)?.trim()?.slice(0, 200);

    if (!name) {
      return jsonError("name is required", 400, ch);
    }
    if (!["company", "contact"].includes(entityType)) {
      return jsonError("entity_type must be 'company' or 'contact'", 400, ch);
    }

    const data = await dependencies.gatherPrepData(
      adminDb,
      workspaceId,
      entityType,
      name,
    );
    if (!data) {
      return jsonError(`No ${entityType} found matching "${name}"`, 404, ch);
    }

    const prepSheet = await dependencies.generatePrepSheet(data);

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
    if (err instanceof SyntaxError) {
      return jsonError("Request body must be valid JSON", 400, ch);
    }
    captureEdgeException(err, { fn: "prep-sheet", req });
    console.error("prep-sheet error:", err);
    return jsonError("Failed to generate prep sheet", 500, ch);
  }
}

export type { CallerContext };
