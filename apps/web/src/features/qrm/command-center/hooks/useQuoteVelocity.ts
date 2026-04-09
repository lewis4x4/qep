/**
 * Quote Velocity Center — data hook.
 *
 * Fetches quote_packages + quote_signatures in parallel via the Supabase
 * callerClient (RLS-enforced, workspace-scoped). No edge function needed —
 * all computation happens client-side in computeQuoteVelocity().
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useQuoteVelocity() {
  return useQuery({
    queryKey: ["qrm", "quote-velocity"],
    queryFn: async () => {
      const [packagesRes, signaturesRes] = await Promise.all([
        supabase
          .from("quote_packages")
          .select(
            "id, deal_id, status, created_at, updated_at, sent_at, expires_at, net_total, margin_pct, entry_mode, requires_requote, crm_deals(name), crm_contacts(first_name, last_name)",
          )
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("quote_signatures")
          .select("id, quote_package_id, signed_at")
          .limit(500),
      ]);

      if (packagesRes.error) {
        console.error("[quote-velocity] packages query failed:", packagesRes.error.message);
      }
      if (signaturesRes.error) {
        console.error("[quote-velocity] signatures query failed:", signaturesRes.error.message);
      }

      // Supabase returns joined relations as arrays. Normalize to single objects.
      const packages = (packagesRes.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        deal_id: row.deal_id as string | null,
        status: row.status as string | null,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
        sent_at: row.sent_at as string | null,
        expires_at: row.expires_at as string | null,
        net_total: row.net_total as number | null,
        margin_pct: row.margin_pct as number | null,
        entry_mode: row.entry_mode as string | null,
        requires_requote: row.requires_requote as boolean | null,
        crm_deals: Array.isArray(row.crm_deals) ? (row.crm_deals[0] as { name: string } | undefined) ?? null : (row.crm_deals as { name: string } | null),
        crm_contacts: Array.isArray(row.crm_contacts) ? (row.crm_contacts[0] as { first_name: string | null; last_name: string | null } | undefined) ?? null : (row.crm_contacts as { first_name: string | null; last_name: string | null } | null),
      }));

      const signatures = (signaturesRes.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        quote_package_id: row.quote_package_id as string,
        signed_at: row.signed_at as string,
      }));

      return { packages, signatures };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
}
