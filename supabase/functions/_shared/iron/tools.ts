/**
 * Wave 7.2 Iron Companion — agent tool registry.
 *
 * The model decides which of these to call based on the user's question.
 * Each tool has:
 *   - an Anthropic tool definition (name + description + input_schema)
 *   - a server-side executor that runs against the real Postgres tables
 *
 * Tool surface intentionally covers the operational query surface:
 *   inventory lookups, parts orders, customer/contact lookups, equipment
 *   search, service jobs, semantic KB, and web search.
 *
 * To add a new tool:
 *   1. Add a definition to IRON_TOOL_DEFINITIONS
 *   2. Add a case to executeIronTool
 *   3. Implement the executor function
 *   4. Done — the model picks it up automatically on next call
 *
 * Hard rules:
 *   - All executors are read-only. NO mutations. Mutations belong in flows
 *     so they go through iron-execute-flow-step + the undo/idempotency
 *     guard rails.
 *   - All executors filter by workspace_id from ToolContext (server-side
 *     enforcement of tenant isolation, never trust the model).
 *   - All executors return JSON-serializable results capped at ~4KB so
 *     the conversation history doesn't blow up the model context.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { embedText, formatVectorLiteral } from "../openai-embeddings.ts";

/* ─── Anthropic tool definitions ────────────────────────────────────────── */

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const IRON_TOOL_DEFINITIONS: AnthropicToolDef[] = [
  {
    name: "lookup_part_inventory",
    description:
      "Look up the on-hand quantity of a specific part across all branches. Returns inventory rows with branch_id, qty_on_hand, bin_location, and catalog details (description, manufacturer, list_price). USE THIS WHEN: the user asks 'how many of X do we have', 'is X in stock', 'where is X stored', or any question about a specific part number.",
    input_schema: {
      type: "object",
      properties: {
        part_number: {
          type: "string",
          description: "The exact part number to look up, e.g. 'BLADE-EDGE-60' or 'SEAL-KIT-12'",
        },
      },
      required: ["part_number"],
    },
  },
  {
    name: "search_parts",
    description:
      "Fuzzy search the parts catalog by description, manufacturer name, or part number prefix. Returns up to 20 candidates with their descriptions, manufacturers, list prices, and current total inventory. USE THIS WHEN: the user describes a part by what it is rather than its exact part number, e.g. 'do we have any hydraulic seals' or 'find me Caterpillar filters'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search term" },
        category: { type: "string", description: "Optional category filter" },
        limit: { type: "number", description: "Max results (default 15)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_low_stock_parts",
    description:
      "List parts whose total inventory is at or below a threshold across all branches. Returns part_number, description, total_qty, branches with low counts. USE THIS WHEN: the user asks 'what's running low', 'what do we need to reorder', 'show me parts under N units', etc.",
    input_schema: {
      type: "object",
      properties: {
        branch_id: { type: "string", description: "Optional branch filter (e.g. 'gulf-depot')" },
        threshold: { type: "number", description: "Max quantity to consider low (default 5)" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "list_parts_orders",
    description:
      "List parts orders filtered by status, date range, or urgency. Returns order id, status, total, customer company name, line items count, machine-down flag, and creation date. USE THIS WHEN: the user asks 'show me pending parts orders', 'what parts orders are open', 'urgent machine-down orders', 'orders this week', etc.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Optional status filter (e.g. 'pending', 'fulfilled', 'shipped', 'cancelled')",
        },
        days_back: { type: "number", description: "Last N days (default 30)" },
        is_machine_down: { type: "boolean", description: "Filter to machine-down (urgent) orders only" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "lookup_company",
    description:
      "Find a customer company by name (fuzzy match). Returns company id, name, address, city/state, and id. USE THIS WHEN: the user mentions a customer by name, e.g. 'find Anderson Equipment' or 'do we have a record for Acme Construction'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Company name (partial match supported)" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["name"],
    },
  },
  {
    name: "lookup_contact",
    description:
      "Find a contact person by first name, last name, or email. Returns contact id, name, email, phone, title, and primary company. USE THIS WHEN: the user mentions a person by name, e.g. 'find John Smith' or 'who is the contact at Acme'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "First name, last name, or both" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["name"],
    },
  },
  {
    name: "search_equipment",
    description:
      "Search equipment inventory by make, model, year, category, condition, or availability. Returns equipment with serial, year, hours, current market value, daily rental rate, and location. USE THIS WHEN: the user asks about equipment in stock, rental rates, or to find a specific machine, e.g. 'do we have any 2020 Bobcats' or 'show available skid steers'.",
    input_schema: {
      type: "object",
      properties: {
        make: { type: "string" },
        model: { type: "string" },
        year: { type: "number" },
        category: { type: "string" },
        availability: {
          type: "string",
          description: "e.g. 'available', 'on_rent', 'sold', 'in_service'",
        },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "list_service_jobs",
    description:
      "List service jobs filtered by stage, branch, priority, or recency. Returns job id, customer problem summary, current stage, scheduled date, branch, and priority. USE THIS WHEN: the user asks about open service work, scheduled jobs, urgent jobs, or jobs at a specific branch.",
    input_schema: {
      type: "object",
      properties: {
        current_stage: {
          type: "string",
          description:
            "e.g. 'intake', 'diagnosis', 'awaiting_parts', 'in_progress', 'completed', 'invoiced'",
        },
        branch_id: { type: "string" },
        priority: {
          type: "string",
          description: "e.g. 'urgent', 'high', 'normal', 'low'",
        },
        days_back: { type: "number", description: "Last N days (default 30)" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "semantic_kb_search",
    description:
      "Semantic search over uploaded documents, manuals, SOPs, machine knowledge notes, and CRM embeddings. Use for unstructured knowledge questions like 'what's our return policy', 'how do I service a hydraulic pump', or 'what does our SOP say about trade-ins'. NOT for inventory or transactional data — use the dedicated tools for those.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language query" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the public web via Tavily for OEM specs, market prices, news, or any external/public information that isn't in the QEP database. USE THIS WHEN: the user asks for things like 'torque spec for a CAT 320 final drive', 'current used market price for a 2018 Bobcat T770', or 'what's the warranty period on a Kubota L4060'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Web search query" },
      },
      required: ["query"],
    },
  },
];

/* ─── Tool execution context ────────────────────────────────────────────── */

export interface ToolContext {
  admin: SupabaseClient;
  workspaceId: string;
  userRole: string;
  tavilyApiKey: string;
}

/* ─── Tool dispatcher ───────────────────────────────────────────────────── */

export async function executeIronTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  try {
    switch (name) {
      case "lookup_part_inventory":
        return await toolLookupPartInventory(String(input.part_number ?? ""), ctx);
      case "search_parts":
        return await toolSearchParts(
          String(input.query ?? ""),
          input.category as string | undefined,
          (input.limit as number | undefined) ?? 15,
          ctx,
        );
      case "list_low_stock_parts":
        return await toolListLowStockParts(
          input.branch_id as string | undefined,
          (input.threshold as number | undefined) ?? 5,
          (input.limit as number | undefined) ?? 25,
          ctx,
        );
      case "list_parts_orders":
        return await toolListPartsOrders(
          input.status as string | undefined,
          (input.days_back as number | undefined) ?? 30,
          input.is_machine_down as boolean | undefined,
          (input.limit as number | undefined) ?? 25,
          ctx,
        );
      case "lookup_company":
        return await toolLookupCompany(
          String(input.name ?? ""),
          (input.limit as number | undefined) ?? 10,
          ctx,
        );
      case "lookup_contact":
        return await toolLookupContact(
          String(input.name ?? ""),
          (input.limit as number | undefined) ?? 10,
          ctx,
        );
      case "search_equipment":
        return await toolSearchEquipment(
          input.make as string | undefined,
          input.model as string | undefined,
          input.year as number | undefined,
          input.category as string | undefined,
          input.availability as string | undefined,
          (input.limit as number | undefined) ?? 10,
          ctx,
        );
      case "list_service_jobs":
        return await toolListServiceJobs(
          input.current_stage as string | undefined,
          input.branch_id as string | undefined,
          input.priority as string | undefined,
          (input.days_back as number | undefined) ?? 30,
          (input.limit as number | undefined) ?? 25,
          ctx,
        );
      case "semantic_kb_search":
        return await toolSemanticKbSearch(String(input.query ?? ""), ctx);
      case "web_search":
        return await toolWebSearch(String(input.query ?? ""), ctx);
      default:
        return { error: `unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[iron-tool:${name}] threw`, err);
    return { error: `tool execution failed: ${(err as Error).message}` };
  }
}

/* ─── Tool implementations ──────────────────────────────────────────────── */

async function toolLookupPartInventory(partNumber: string, ctx: ToolContext) {
  if (!partNumber) return { error: "part_number is required" };
  const trimmed = partNumber.trim().toUpperCase();

  const { data: invRows, error: invErr } = await ctx.admin
    .from("parts_inventory")
    .select("part_number, branch_id, qty_on_hand, bin_location, catalog_id")
    .eq("part_number", trimmed)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null);

  if (invErr) return { error: invErr.message };
  if (!invRows || invRows.length === 0) {
    return { found: false, part_number: trimmed, message: "No inventory rows found." };
  }

  // Pull catalog details (one query, one part)
  const { data: catalogRows } = await ctx.admin
    .from("parts_catalog")
    .select("part_number, description, manufacturer, list_price, category, uom")
    .eq("part_number", trimmed)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();

  const total = invRows.reduce((sum, r) => sum + (r.qty_on_hand ?? 0), 0);

  return {
    found: true,
    part_number: trimmed,
    description: catalogRows?.description ?? null,
    manufacturer: catalogRows?.manufacturer ?? null,
    category: catalogRows?.category ?? null,
    list_price_usd: catalogRows?.list_price ?? null,
    unit_of_measure: catalogRows?.uom ?? null,
    total_on_hand: total,
    branch_count: invRows.length,
    branches: invRows.map((r) => ({
      branch_id: r.branch_id,
      qty: r.qty_on_hand,
      bin_location: r.bin_location,
    })),
  };
}

async function toolSearchParts(
  query: string,
  category: string | undefined,
  limit: number,
  ctx: ToolContext,
) {
  if (!query) return { error: "query is required" };
  const term = query.trim().replace(/[%_]/g, "").slice(0, 80);
  const orFilter = `description.ilike.%${term}%,manufacturer.ilike.%${term}%,part_number.ilike.%${term}%`;

  let q = ctx.admin
    .from("parts_catalog")
    .select("part_number, description, manufacturer, category, list_price, uom")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .or(orFilter);
  if (category) q = q.eq("category", category);

  const { data, error } = await q.limit(Math.min(limit, 25));
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { count: 0, parts: [] };

  // Pull total inventory for each found part
  const partNumbers = data.map((p) => p.part_number).filter(Boolean);
  const { data: invRows } = await ctx.admin
    .from("parts_inventory")
    .select("part_number, qty_on_hand")
    .in("part_number", partNumbers)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null);

  const totalsByPart = new Map<string, number>();
  for (const inv of invRows ?? []) {
    const cur = totalsByPart.get(inv.part_number) ?? 0;
    totalsByPart.set(inv.part_number, cur + (inv.qty_on_hand ?? 0));
  }

  return {
    count: data.length,
    parts: data.map((p) => ({
      part_number: p.part_number,
      description: p.description,
      manufacturer: p.manufacturer,
      category: p.category,
      list_price_usd: p.list_price,
      unit_of_measure: p.uom,
      total_on_hand: totalsByPart.get(p.part_number) ?? 0,
    })),
  };
}

async function toolListLowStockParts(
  branchId: string | undefined,
  threshold: number,
  limit: number,
  ctx: ToolContext,
) {
  let q = ctx.admin
    .from("parts_inventory")
    .select("part_number, branch_id, qty_on_hand, bin_location")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .lte("qty_on_hand", Math.max(0, threshold))
    .order("qty_on_hand", { ascending: true });
  if (branchId) q = q.eq("branch_id", branchId);

  const { data, error } = await q.limit(Math.min(limit, 100));
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { count: 0, low_stock: [] };

  // Hydrate descriptions
  const partNumbers = Array.from(new Set(data.map((r) => r.part_number)));
  const { data: catalog } = await ctx.admin
    .from("parts_catalog")
    .select("part_number, description, manufacturer, list_price")
    .in("part_number", partNumbers)
    .eq("workspace_id", ctx.workspaceId);

  const descByPart = new Map<string, { description: string | null; manufacturer: string | null; list_price: number | null }>();
  for (const c of catalog ?? []) {
    descByPart.set(c.part_number, {
      description: c.description ?? null,
      manufacturer: c.manufacturer ?? null,
      list_price: c.list_price ?? null,
    });
  }

  return {
    threshold,
    branch_filter: branchId ?? null,
    count: data.length,
    low_stock: data.map((r) => ({
      part_number: r.part_number,
      description: descByPart.get(r.part_number)?.description ?? null,
      manufacturer: descByPart.get(r.part_number)?.manufacturer ?? null,
      branch_id: r.branch_id,
      qty: r.qty_on_hand,
      bin_location: r.bin_location,
    })),
  };
}

async function toolListPartsOrders(
  status: string | undefined,
  daysBack: number,
  isMachineDown: boolean | undefined,
  limit: number,
  ctx: ToolContext,
) {
  const since = new Date(Date.now() - Math.max(1, daysBack) * 86400_000).toISOString();
  let q = ctx.admin
    .from("parts_orders")
    .select(
      "id, status, total, subtotal, is_machine_down, crm_company_id, created_at, estimated_delivery, tracking_number, line_items, notes",
    )
    .eq("workspace_id", ctx.workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  if (typeof isMachineDown === "boolean") q = q.eq("is_machine_down", isMachineDown);

  const { data, error } = await q.limit(Math.min(limit, 50));
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { count: 0, orders: [] };

  // Hydrate company names
  const companyIds = Array.from(new Set(data.map((o) => o.crm_company_id).filter(Boolean) as string[]));
  let companyById = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await ctx.admin
      .from("qrm_companies")
      .select("id, name")
      .in("id", companyIds);
    for (const c of companies ?? []) companyById.set(c.id, c.name);
  }

  return {
    filter: { status, days_back: daysBack, is_machine_down: isMachineDown },
    count: data.length,
    orders: data.map((o) => ({
      id: o.id,
      status: o.status,
      total_usd: o.total,
      is_machine_down: o.is_machine_down,
      customer: o.crm_company_id ? companyById.get(o.crm_company_id) ?? null : null,
      created_at: o.created_at,
      estimated_delivery: o.estimated_delivery,
      tracking_number: o.tracking_number,
      line_count: Array.isArray(o.line_items) ? (o.line_items as unknown[]).length : 0,
      notes: o.notes ? String(o.notes).slice(0, 200) : null,
    })),
  };
}

async function toolLookupCompany(name: string, limit: number, ctx: ToolContext) {
  if (!name) return { error: "name is required" };
  const term = `%${name.replace(/[%_]/g, "").slice(0, 80)}%`;
  const { data, error } = await ctx.admin
    .from("qrm_companies")
    .select("id, name, city, state, postal_code, country, address_line_1")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .ilike("name", term)
    .order("name")
    .limit(Math.min(limit, 25));
  if (error) return { error: error.message };
  return { count: data?.length ?? 0, companies: data ?? [] };
}

async function toolLookupContact(name: string, limit: number, ctx: ToolContext) {
  if (!name) return { error: "name is required" };
  const term = `%${name.replace(/[%_]/g, "").slice(0, 80)}%`;
  const orFilter = `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`;
  const { data, error } = await ctx.admin
    .from("qrm_contacts")
    .select("id, first_name, last_name, email, phone, title, primary_company_id")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .or(orFilter)
    .limit(Math.min(limit, 25));
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { count: 0, contacts: [] };

  const companyIds = Array.from(
    new Set(data.map((c) => c.primary_company_id).filter(Boolean) as string[]),
  );
  let companyById = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await ctx.admin
      .from("qrm_companies")
      .select("id, name")
      .in("id", companyIds);
    for (const c of companies ?? []) companyById.set(c.id, c.name);
  }

  return {
    count: data.length,
    contacts: data.map((c) => ({
      id: c.id,
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      email: c.email,
      phone: c.phone,
      title: c.title,
      company: c.primary_company_id ? companyById.get(c.primary_company_id) ?? null : null,
    })),
  };
}

async function toolSearchEquipment(
  make: string | undefined,
  model: string | undefined,
  year: number | undefined,
  category: string | undefined,
  availability: string | undefined,
  limit: number,
  ctx: ToolContext,
) {
  let q = ctx.admin
    .from("qrm_equipment")
    .select(
      "id, name, asset_tag, serial_number, make, model, year, category, condition, availability, engine_hours, current_market_value, daily_rental_rate, location_description",
    )
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .order("year", { ascending: false });
  if (make) q = q.ilike("make", `%${make}%`);
  if (model) q = q.ilike("model", `%${model}%`);
  if (year) q = q.eq("year", year);
  if (category) q = q.eq("category", category);
  if (availability) q = q.eq("availability", availability);

  const { data, error } = await q.limit(Math.min(limit, 25));
  if (error) return { error: error.message };
  return { count: data?.length ?? 0, equipment: data ?? [] };
}

async function toolListServiceJobs(
  currentStage: string | undefined,
  branchId: string | undefined,
  priority: string | undefined,
  daysBack: number,
  limit: number,
  ctx: ToolContext,
) {
  const since = new Date(Date.now() - Math.max(1, daysBack) * 86400_000).toISOString();
  let q = ctx.admin
    .from("service_jobs")
    .select(
      "id, current_stage, priority, branch_id, customer_problem_summary, scheduled_start_at, scheduled_end_at, quote_total, invoice_total, requested_by_name, customer_id, machine_id, created_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (currentStage) q = q.eq("current_stage", currentStage);
  if (branchId) q = q.eq("branch_id", branchId);
  if (priority) q = q.eq("priority", priority);

  const { data, error } = await q.limit(Math.min(limit, 50));
  if (error) return { error: error.message };
  return { count: data?.length ?? 0, jobs: data ?? [] };
}

async function toolSemanticKbSearch(query: string, ctx: ToolContext) {
  if (!query) return { error: "query is required" };
  let embedding: number[];
  try {
    embedding = await embedText(query);
  } catch (err) {
    return { error: `embedding failed: ${(err as Error).message}` };
  }

  const { data, error } = await ctx.admin.rpc("retrieve_document_evidence", {
    query_embedding: formatVectorLiteral(embedding),
    keyword_query: query.slice(0, 200),
    user_role: ctx.userRole,
    match_count: 8,
    semantic_match_threshold: 0.45,
    p_workspace_id: ctx.workspaceId,
  });

  if (error) return { error: error.message };
  if (!Array.isArray(data) || data.length === 0) return { count: 0, results: [] };

  return {
    count: data.length,
    results: (data as Array<Record<string, unknown>>).map((row) => ({
      kind: row.source_type ?? "document",
      id: row.source_id ?? null,
      title: row.source_title ?? "Untitled",
      excerpt: String(row.excerpt ?? "").slice(0, 600),
      confidence: Number(row.confidence ?? 0),
    })),
  };
}

async function toolWebSearch(query: string, ctx: ToolContext) {
  if (!query) return { error: "query is required" };
  if (!ctx.tavilyApiKey) return { error: "TAVILY_API_KEY not configured on this function" };

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: ctx.tavilyApiKey,
        query,
        max_results: 5,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { error: `tavily ${res.status}` };
    }
    const payload = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const results = (payload.results ?? []).slice(0, 5).map((r) => ({
      title: String(r.title ?? r.url ?? "Web result"),
      url: String(r.url ?? ""),
      excerpt: String(r.content ?? r.snippet ?? "").slice(0, 600),
    }));
    return { count: results.length, results };
  } catch (err) {
    return { error: `web search failed: ${(err as Error).message}` };
  }
}
