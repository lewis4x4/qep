import { supabase } from "@/lib/supabase";

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

export type PortalOrderForFulfillmentLink = {
  id: string;
  status: string;
  fulfillment_run_id: string | null;
  created_at: string;
  portal_customers: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Find portal parts orders in the same workspace for linking a service job to a fulfillment run.
 * Searches recent orders and filters by order id substring, customer email, or name.
 */
export async function searchPortalPartsOrdersForFulfillmentLink(
  workspaceId: string,
  searchQuery: string,
): Promise<PortalOrderForFulfillmentLink[]> {
  const q = searchQuery.trim();
  if (q.length < 2) return [];

  const select =
    "id, status, fulfillment_run_id, created_at, portal_customers ( first_name, last_name, email )";

  if (UUID_RE.test(q)) {
    const { data, error } = await supabase
      .from("parts_orders")
      .select(select)
      .eq("workspace_id", workspaceId)
      .eq("id", q)
      .maybeSingle();
    if (error) throw error;
    if (!data) return [];
    const row = data as Record<string, unknown>;
    return [
      {
        ...row,
        portal_customers: one(row.portal_customers as PortalOrderForFulfillmentLink["portal_customers"] | unknown[]),
      } as PortalOrderForFulfillmentLink,
    ];
  }

  const { data, error } = await supabase
    .from("parts_orders")
    .select(select)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  const needle = q.toLowerCase();
  const rows = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      portal_customers: one(row.portal_customers as PortalOrderForFulfillmentLink["portal_customers"] | unknown[]),
    } as PortalOrderForFulfillmentLink;
  });
  return rows
    .filter((row) => {
      if (row.id.toLowerCase().includes(needle)) return true;
      const c = row.portal_customers;
      if (!c) return false;
      const email = (c.email ?? "").toLowerCase();
      const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase().trim();
      return email.includes(needle) || name.includes(needle);
    })
    .slice(0, 25);
}
