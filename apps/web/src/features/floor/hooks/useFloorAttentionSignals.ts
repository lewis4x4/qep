import { useQuery } from "@tanstack/react-query";
import type { IronRole } from "@/features/qrm/lib/iron-roles";
import { supabase } from "@/lib/supabase";
import type { FloorAttentionSignals } from "../lib/attention";

type QueryBuilder = {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, values: unknown[]) => QueryBuilder;
  is: (column: string, value: unknown) => QueryBuilder;
  lt: (column: string, value: string) => QueryBuilder;
};

type SupabaseLoose = {
  from: (table: string) => QueryBuilder;
};

const db = supabase as unknown as SupabaseLoose;

export function useFloorAttentionSignals(role: IronRole, userId: string) {
  return useQuery({
    queryKey: ["floor", "attention-signals", role, userId],
    queryFn: () => fetchFloorAttentionSignals(userId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

async function fetchFloorAttentionSignals(userId: string): Promise<FloorAttentionSignals> {
  const staleCutoff = new Date();
  staleCutoff.setDate(staleCutoff.getDate() - 14);

  const [
    pendingDemos,
    pendingTrades,
    marginFlags,
    staleDeals,
    pendingInvoices,
    serviceTickets,
    quoteFollowups,
    counterInquiries,
  ] = await Promise.all([
    countRows("demos", (q) => q.eq("status", "requested")),
    countRows("trade_valuations", (q) => q.eq("status", "manager_review")),
    countRows("crm_deals", (q) => q.eq("margin_check_status", "flagged")),
    countRows("crm_deals", (q) =>
      q.is("deleted_at", null).lt("last_activity_at", staleCutoff.toISOString()),
    ),
    countRows("customer_invoices", (q) => q.in("status", ["draft", "pending", "open"])),
    countRows("service_jobs", (q) => q.in("status", ["open", "in_progress", "blocked"])),
    countRows("quote_packages", (q) =>
      q.eq("created_by", userId).in("status", ["draft", "sent", "viewed", "changes_requested"]),
    ),
    countRows("parts_inquiries", (q) => q.in("outcome", ["needs_quote", "unquoted"])),
  ]);

  return {
    approvalCount: pendingDemos + pendingTrades + marginFlags,
    staleDealCount: staleDeals,
    pendingInvoiceCount: pendingInvoices,
    openServiceTicketCount: serviceTickets,
    partsStockoutCount: 0,
    quoteFollowupCount: quoteFollowups,
    counterInquiryCount: counterInquiries,
    generatedAt: new Date().toISOString(),
  };
}

async function countRows(
  table: string,
  apply: (query: QueryBuilder) => QueryBuilder,
): Promise<number> {
  try {
    const { count, error } = (await apply(
      db.from(table).select("id", { count: "exact", head: true }),
    )) as unknown as { count: number | null; error: Error | null };
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
