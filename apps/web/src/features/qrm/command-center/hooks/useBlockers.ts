/**
 * Blocker Board — data hook.
 *
 * Fetches blocked deals + deposit details + critical anomalies in parallel.
 * Reuses useApproveMargin + useVerifyDeposit from useApprovals.ts.
 * Adds useAcknowledgeAnomaly for critical anomaly resolution.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { BlockerDealRow, BlockerDepositRow, BlockerAnomalyRow } from "../lib/blockerTypes";

const QUERY_KEY = ["qrm", "blockers"];

export function useBlockers() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const [dealsRes, depositsRes, anomaliesRes] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("id, name, amount, stage_id, deposit_status, margin_check_status, margin_pct, expected_close_on, last_activity_at, crm_deal_stages(name, sort_order), crm_contacts(first_name, last_name), crm_companies(name)")
          .is("deleted_at", null)
          .is("closed_at", null)
          .or("deposit_status.eq.pending,margin_check_status.eq.flagged")
          .order("amount", { ascending: false })
          .limit(200),
        supabase
          .from("deposits")
          .select("id, deal_id, amount, status, tier, required_amount")
          .in("status", ["pending", "requested", "received"])
          .limit(200),
        supabase
          .from("anomaly_alerts")
          .select("id, entity_id, alert_type, severity, title, description, acknowledged, created_at")
          .eq("entity_type", "deal")
          .eq("severity", "critical")
          .eq("acknowledged", false)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      if (dealsRes.error) console.error("[blockers] deals query failed:", dealsRes.error.message);
      if (depositsRes.error) console.error("[blockers] deposits query failed:", depositsRes.error.message);
      if (anomaliesRes.error) console.error("[blockers] anomalies query failed:", anomaliesRes.error.message);

      // Normalize Supabase joined relations
      const normalize = <T extends Record<string, unknown>>(rows: T[] | null): T[] =>
        (rows ?? []).map((row) => {
          const out = { ...row } as Record<string, unknown>;
          for (const key of Object.keys(out)) {
            if (Array.isArray(out[key])) {
              out[key] = (out[key] as unknown[])[0] ?? null;
            }
          }
          return out as T;
        });

      return {
        deals: normalize(dealsRes.data) as BlockerDealRow[],
        deposits: (depositsRes.data ?? []) as BlockerDepositRow[],
        anomalies: (anomaliesRes.data ?? []) as BlockerAnomalyRow[],
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Acknowledge a critical anomaly (removes it from the blocker board). */
export function useAcknowledgeAnomaly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (anomalyId: string) => {
      const { error } = await supabase
        .from("anomaly_alerts")
        .update({
          acknowledged: true,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", anomalyId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["qrm", "approvals"] });
    },
  });
}
