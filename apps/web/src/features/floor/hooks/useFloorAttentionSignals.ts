import { useQuery } from "@tanstack/react-query";
import type { IronRole } from "@/features/qrm/lib/iron-roles";
import { supabase } from "@/lib/supabase";
import type { FloorAttentionSignals } from "../lib/attention";

type CountResponse = {
  count: number | null;
  error: { message: string } | null;
};

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
    readCount(
      supabase.from("demos").select("id", { count: "exact", head: true }).eq("status", "requested"),
    ),
    readCount(
      supabase
        .from("trade_valuations")
        .select("id", { count: "exact", head: true })
        .eq("status", "manager_review"),
    ),
    readCount(
      supabase
        .from("crm_deals")
        .select("id", { count: "exact", head: true })
        .eq("margin_check_status", "flagged"),
    ),
    readCount(
      supabase
        .from("crm_deals")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .lt("last_activity_at", staleCutoff.toISOString()),
    ),
    readCount(
      supabase
        .from("customer_invoices")
        .select("id", { count: "exact", head: true })
        .in("status", ["draft", "pending", "open"]),
    ),
    readCount(
      supabase
        .from("service_jobs")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .is("closed_at", null),
    ),
    readCount(
      supabase
        .from("quote_packages")
        .select("id", { count: "exact", head: true })
        .eq("created_by", userId)
        .in("status", ["draft", "sent", "viewed", "changes_requested"]),
    ),
    readCount(
      supabase
        .from("counter_inquiries")
        .select("id", { count: "exact", head: true })
        .in("outcome", ["needs_quote", "unquoted"]),
    ),
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

async function readCount(request: PromiseLike<CountResponse>): Promise<number> {
  try {
    const { count, error } = await request;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
