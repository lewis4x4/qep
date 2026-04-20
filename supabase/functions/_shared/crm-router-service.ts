import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  createCallerClient,
  type CallerContext,
} from "./dge-auth.ts";
import { emitCrmAccessDeniedAudit, extractRequestIp } from "./crm-auth-audit.ts";

const CRM_ROLES = new Set(["rep", "admin", "manager", "owner"]);
const ELEVATED_ROLES = new Set(["admin", "manager", "owner"]);
const DEFINITION_WRITE_ROLES = new Set(["admin", "owner"]);

export interface RouterCtx {
  admin: SupabaseClient;
  callerDb: SupabaseClient;
  caller: CallerContext;
  workspaceId: string;
  requestId: string;
  route: string;
  method: string;
  ipInet: string | null;
  userAgent: string | null;
}

export type CrmSearchEntityType =
  | "company"
  | "contact"
  | "deal"
  | "equipment"
  | "rental";

export interface CrmSearchResult {
  type: CrmSearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  updatedAt: string;
  rank: number;
}

const SEARCHABLE_TYPES: readonly CrmSearchEntityType[] = [
  "company",
  "contact",
  "deal",
  "equipment",
  "rental",
] as const;

export function createRequestContext(req: Request, route: string, method: string): RouterCtx {
  const admin = createAdminClient();
  const authHeader = req.headers.get("Authorization");

  return {
    admin,
    callerDb: authHeader ? createCallerClient(authHeader) : admin,
    caller: {
      authHeader,
      userId: null,
      role: null,
      isServiceRole: false,
      workspaceId: null,
    },
    workspaceId: "default",
    requestId: crypto.randomUUID(),
    route,
    method,
    ipInet: extractRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  };
}

export async function hydrateCaller(
  req: Request,
  ctx: RouterCtx,
  resolver: (req: Request, adminClient: SupabaseClient) => Promise<CallerContext>,
): Promise<RouterCtx> {
  const caller = await resolver(req, ctx.admin);
  const callerDb = caller.authHeader ? createCallerClient(caller.authHeader) : ctx.admin;
  const workspaceId = caller.isServiceRole
    ? (caller.workspaceId ?? "default")
    : "default";

  return {
    ...ctx,
    caller,
    callerDb,
    workspaceId,
  };
}

export async function deny(
  ctx: RouterCtx,
  reasonCode: string,
): Promise<void> {
  await emitCrmAccessDeniedAudit(ctx.admin, {
    workspaceId: ctx.workspaceId,
    requestId: ctx.requestId,
    resource: ctx.route,
    reasonCode,
    actorUserId: ctx.caller.userId,
    ipInet: ctx.ipInet,
    userAgent: ctx.userAgent,
    metadata: {
      http_method: ctx.method,
      action: `${ctx.method}:${ctx.route}`,
    },
  });
}

export function requireCaller(ctx: RouterCtx): void {
  if (ctx.caller.isServiceRole) {
    if (!ctx.caller.workspaceId) {
      throw new Error("SERVICE_WORKSPACE_UNBOUND");
    }
    return;
  }
  if (!ctx.caller.userId || !ctx.caller.role || !CRM_ROLES.has(ctx.caller.role)) {
    throw new Error("UNAUTHORIZED");
  }
}

export function requireElevated(ctx: RouterCtx): void {
  if (ctx.caller.isServiceRole) {
    if (!ctx.caller.workspaceId) {
      throw new Error("SERVICE_WORKSPACE_UNBOUND");
    }
    return;
  }
  if (!ctx.caller.role || !ELEVATED_ROLES.has(ctx.caller.role)) {
    throw new Error("FORBIDDEN");
  }
}

export function requireDefinitionWriter(ctx: RouterCtx): void {
  if (ctx.caller.isServiceRole) {
    if (!ctx.caller.workspaceId) {
      throw new Error("SERVICE_WORKSPACE_UNBOUND");
    }
    return;
  }
  if (!ctx.caller.role || !DEFINITION_WRITE_ROLES.has(ctx.caller.role)) {
    throw new Error("FORBIDDEN");
  }
}

function cleanSearchTerm(input: string): string {
  return input.toLowerCase().replace(/[,%()]/g, "").trim();
}

function scoreText(text: string, query: string): number {
  if (!query) return 2;
  if (text.startsWith(query)) return 0;
  const tokens = text.split(/\s+/g);
  if (tokens.some((token) => token.startsWith(query))) return 1;
  return 2;
}

export async function crmSearch(
  ctx: RouterCtx,
  rawQuery: string,
  rawTypes: string,
): Promise<CrmSearchResult[]> {
  const query = cleanSearchTerm(rawQuery);
  if (!query) return [];

  const types = rawTypes
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is CrmSearchEntityType =>
      SEARCHABLE_TYPES.includes(value as CrmSearchEntityType),
    );
  const includeTypes =
    types.length > 0
      ? new Set<CrmSearchEntityType>(types)
      : new Set<CrmSearchEntityType>(SEARCHABLE_TYPES);

  const results: CrmSearchResult[] = [];

  if (includeTypes.has("company")) {
    const { data, error } = await ctx.callerDb
      .from("crm_companies")
      .select("id, name, city, state, country, updated_at")
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .ilike("name", `%${query}%`)
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    for (const row of data ?? []) {
      const normalizedName = String(row.name ?? "").toLowerCase();
      const location = [row.city, row.state, row.country].filter(Boolean).join(", ") || null;
      results.push({
        type: "company",
        id: String(row.id),
        title: String(row.name),
        subtitle: location,
        updatedAt: String(row.updated_at),
        rank: scoreText(normalizedName, query),
      });
    }
  }

  if (includeTypes.has("contact")) {
    const { data, error } = await ctx.callerDb
      .from("crm_contacts")
      .select("id, first_name, last_name, email, phone, updated_at")
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
      .order("updated_at", { ascending: false })
      .limit(40);

    if (error) throw error;

    for (const row of data ?? []) {
      const first = String(row.first_name ?? "");
      const last = String(row.last_name ?? "");
      const title = `${first} ${last}`.trim();
      const subtitle = row.email || row.phone || null;
      const searchable = `${first} ${last} ${row.email ?? ""} ${row.phone ?? ""}`.toLowerCase();
      results.push({
        type: "contact",
        id: String(row.id),
        title,
        subtitle,
        updatedAt: String(row.updated_at),
        rank: scoreText(searchable, query),
      });
    }
  }

  // Deals: query the rep-safe view so rep-scope callers never see margin.
  if (includeTypes.has("deal")) {
    const { data, error } = await ctx.callerDb
      .from("crm_deals_rep_safe")
      .select("id, name, amount, expected_close_on, updated_at")
      .eq("workspace_id", ctx.workspaceId)
      .ilike("name", `%${query}%`)
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    for (const row of data ?? []) {
      const name = String(row.name ?? "");
      const amount =
        row.amount != null && Number.isFinite(Number(row.amount))
          ? `$${Number(row.amount).toLocaleString()}`
          : null;
      const closeOn = row.expected_close_on ? String(row.expected_close_on) : null;
      const subtitle = [amount, closeOn && `close ${closeOn}`].filter(Boolean).join(" · ") || null;
      results.push({
        type: "deal",
        id: String(row.id),
        title: name || "Untitled deal",
        subtitle,
        updatedAt: String(row.updated_at),
        rank: scoreText(name.toLowerCase(), query),
      });
    }
  }

  // Equipment: fleet/iron search by name, make, model, VIN, asset tag, serial.
  // We OR across the most-used identifier fields so typing "CAT 305" matches
  // a Caterpillar 305, and typing a VIN still hits.
  if (includeTypes.has("equipment")) {
    const { data, error } = await ctx.callerDb
      .from("crm_equipment")
      .select(
        "id, name, make, model, year, asset_tag, serial_number, vin_pin, availability, updated_at",
      )
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .or(
        [
          `name.ilike.%${query}%`,
          `make.ilike.%${query}%`,
          `model.ilike.%${query}%`,
          `asset_tag.ilike.%${query}%`,
          `serial_number.ilike.%${query}%`,
          `vin_pin.ilike.%${query}%`,
        ].join(","),
      )
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    for (const row of data ?? []) {
      const parts = [row.year, row.make, row.model].filter(Boolean).map(String);
      const labelFromSpec = parts.join(" ");
      const fallback = String(row.name ?? "");
      const title = labelFromSpec.trim() || fallback || "Equipment";
      const subtitleParts = [
        row.asset_tag ? `Tag ${row.asset_tag}` : null,
        row.vin_pin ? `VIN ${row.vin_pin}` : null,
        row.availability ? String(row.availability) : null,
      ].filter(Boolean);
      const searchable =
        `${labelFromSpec} ${fallback} ${row.asset_tag ?? ""} ${row.serial_number ?? ""} ${row.vin_pin ?? ""}`
          .toLowerCase();
      results.push({
        type: "equipment",
        id: String(row.id),
        title,
        subtitle: subtitleParts.join(" · ") || null,
        updatedAt: String(row.updated_at),
        rank: scoreText(searchable, query),
      });
    }
  }

  // Rentals: search the rental contract requests/agreements by make/model or
  // delivery location. Customer identity comes from the linked equipment +
  // portal_customer when present.
  if (includeTypes.has("rental")) {
    const { data, error } = await ctx.callerDb
      .from("rental_contracts")
      .select(
        "id, requested_make, requested_model, requested_category, delivery_location, status, requested_start_date, requested_end_date, updated_at",
      )
      .eq("workspace_id", ctx.workspaceId)
      .or(
        [
          `requested_make.ilike.%${query}%`,
          `requested_model.ilike.%${query}%`,
          `requested_category.ilike.%${query}%`,
          `delivery_location.ilike.%${query}%`,
        ].join(","),
      )
      .order("updated_at", { ascending: false })
      .limit(20);

    // Rentals may not be visible to all callers under RLS; a permission error
    // should not poison the whole search.
    if (!error) {
      for (const row of data ?? []) {
        const parts = [row.requested_make, row.requested_model, row.requested_category]
          .filter(Boolean)
          .map(String);
        const title = parts.join(" ").trim() || "Rental request";
        const subtitle =
          [
            row.status ? String(row.status) : null,
            row.requested_start_date && row.requested_end_date
              ? `${row.requested_start_date} → ${row.requested_end_date}`
              : null,
            row.delivery_location ? String(row.delivery_location) : null,
          ]
            .filter(Boolean)
            .join(" · ") || null;
        const searchable =
          `${parts.join(" ")} ${row.delivery_location ?? ""}`.toLowerCase();
        results.push({
          type: "rental",
          id: String(row.id),
          title,
          subtitle,
          updatedAt: String(row.updated_at),
          rank: scoreText(searchable, query),
        });
      }
    }
  }

  return results
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    })
    .slice(0, 40);
}

/** All company ids in the subtree rooted at `rootId` (includes the root). */
export function collectCompanySubtreeIds(
  rows: Array<{ id: unknown; parent_company_id: unknown }>,
  rootId: string,
): Set<string> {
  const stack = [rootId];
  const subtree = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (subtree.has(id)) continue;
    subtree.add(id);
    for (const row of rows) {
      if (String(row.parent_company_id ?? "") === id) {
        stack.push(String(row.id));
      }
    }
  }
  return subtree;
}

/** Returns null when the company is missing or not visible to the caller. */
export async function fetchCompanySubtreeIdSet(
  ctx: RouterCtx,
  companyId: string,
): Promise<Set<string> | null> {
  const { data: root, error: rootError } = await ctx.callerDb
    .from("crm_companies")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (rootError) throw rootError;
  if (!root) return null;

  const { data: companies, error: listError } = await ctx.callerDb
    .from("crm_companies")
    .select("id, parent_company_id")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .limit(5000);
  if (listError) throw listError;

  return collectCompanySubtreeIds(companies ?? [], companyId);
}

export async function getCompanyHierarchy(ctx: RouterCtx, companyId: string): Promise<unknown> {
  const { data: company, error: companyError } = await ctx.callerDb
    .from("crm_companies")
    .select("id, name, parent_company_id, assigned_rep_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) return null;

  const { data: companies, error: listError } = await ctx.callerDb
    .from("crm_companies")
    .select("id, name, parent_company_id")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .limit(5000);
  if (listError) throw listError;

  const map = new Map((companies ?? []).map((row) => [String(row.id), row]));
  const ancestors: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>([companyId]);
  let currentParent = company.parent_company_id ? String(company.parent_company_id) : null;
  while (currentParent && !seen.has(currentParent)) {
    const node = map.get(currentParent);
    if (!node) break;
    ancestors.unshift({ id: String(node.id), name: String(node.name) });
    seen.add(currentParent);
    currentParent = node.parent_company_id ? String(node.parent_company_id) : null;
  }

  const children = (companies ?? [])
    .filter((row) => String(row.parent_company_id ?? "") === companyId)
    .map((row) => ({ id: String(row.id), name: String(row.name) }));

  const subtree = collectCompanySubtreeIds(companies ?? [], companyId);

  const { data: rollups, error: rollupError } = await ctx.callerDb.rpc(
    "crm_company_subtree_rollups",
    {
      p_workspace_id: ctx.workspaceId,
      p_company_id: companyId,
    },
  );
  if (rollupError) throw rollupError;

  const counts = Array.isArray(rollups) ? rollups[0] : rollups;

  return {
    company: {
      id: String(company.id),
      name: String(company.name),
      assignedRepId: company.assigned_rep_id,
    },
    ancestors,
    children,
    rollups: {
      contacts: Number(counts?.contact_count ?? 0),
      equipment: Number(counts?.equipment_count ?? 0),
    },
    subtreeCompanyIds: Array.from(subtree),
  };
}

export async function refreshDuplicates(ctx: RouterCtx): Promise<void> {
  await ctx.admin.rpc("crm_refresh_duplicate_candidates", {
    p_workspace_id: ctx.workspaceId,
  });
}

export async function mergeContacts(
  ctx: RouterCtx,
  survivorId: string,
  loserId: string,
  idempotencyKey: string | null,
): Promise<unknown> {
  const { data, error } = await ctx.admin.rpc("crm_merge_contacts", {
    p_workspace_id: ctx.workspaceId,
    p_actor_user_id: ctx.caller.userId,
    p_survivor_contact_id: survivorId,
    p_loser_contact_id: loserId,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    if ((error.message || "").includes("hubspot_id_conflict")) {
      throw new Error("HUBSPOT_ID_CONFLICT");
    }
    throw error;
  }

  return data;
}
