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

export interface CrmSearchResult {
  type: "company" | "contact";
  id: string;
  title: string;
  subtitle: string | null;
  updatedAt: string;
  rank: number;
}

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
    ? (req.headers.get("x-workspace-id")?.trim() || "default")
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
  if (ctx.caller.isServiceRole) return;
  if (!ctx.caller.userId || !ctx.caller.role || !CRM_ROLES.has(ctx.caller.role)) {
    throw new Error("UNAUTHORIZED");
  }
}

export function requireElevated(ctx: RouterCtx): void {
  if (ctx.caller.isServiceRole) return;
  if (!ctx.caller.role || !ELEVATED_ROLES.has(ctx.caller.role)) {
    throw new Error("FORBIDDEN");
  }
}

export function requireDefinitionWriter(ctx: RouterCtx): void {
  if (ctx.caller.isServiceRole) return;
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
    .filter((value) => value === "company" || value === "contact");
  const includeTypes = types.length > 0 ? new Set(types) : new Set(["company", "contact"]);

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

  return results
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    })
    .slice(0, 25);
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

  const stack = [companyId];
  const subtree = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (subtree.has(id)) continue;
    subtree.add(id);
    for (const row of companies ?? []) {
      if (String(row.parent_company_id ?? "") === id) {
        stack.push(String(row.id));
      }
    }
  }

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
