/**
 * Approval Center — data hook with one-click mutations.
 *
 * Fetches 4 approval types in parallel, provides mutation hooks for
 * approve/deny with optimistic updates.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { MarginRow, DepositRow, TradeRow, DemoRow, QuoteApprovalRow } from "../lib/approvalTypes";

const QUERY_KEY = ["qrm", "approvals"];

// ─── Query hook ────────────────────────────────────────────────────────────

export function useApprovals() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const [marginRes, depositsRes, tradesRes, demosRes, quotesRes] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("id, name, amount, margin_pct, margin_amount, margin_check_status, updated_at, crm_contacts(first_name, last_name)")
          .eq("margin_check_status", "flagged")
          .is("deleted_at", null)
          .is("closed_at", null)
          .limit(100),
        supabase
          .from("deposits")
          .select("id, deal_id, amount, status, tier, created_at, crm_deals(name, amount)")
          .in("status", ["pending", "requested", "received"])
          .limit(100),
        supabase
          .from("trade_valuations")
          .select("id, deal_id, status, make, model, year, preliminary_value, created_at, crm_deals(name)")
          .eq("status", "manager_review")
          .limit(100),
        supabase
          .from("demos")
          .select("id, deal_id, status, equipment_category, scheduled_date, needs_assessment_complete, buying_intent_confirmed, created_at, crm_deals(name)")
          .eq("status", "requested")
          .limit(100),
        supabase
          .from("flow_approvals")
          .select("id, workflow_slug, subject, detail, status, requested_at, due_at, escalate_at, context_summary")
          .eq("workflow_slug", "quote-manager-approval")
          .in("status", ["pending", "escalated"])
          .order("requested_at", { ascending: false })
          .limit(100),
      ]);

      // Log errors but don't throw — individual types degrade gracefully
      if (marginRes.error) console.error("[approvals] margin query failed:", marginRes.error.message);
      if (depositsRes.error) console.error("[approvals] deposits query failed:", depositsRes.error.message);
      if (tradesRes.error) console.error("[approvals] trades query failed:", tradesRes.error.message);
      if (demosRes.error) console.error("[approvals] demos query failed:", demosRes.error.message);
      if (quotesRes.error) console.error("[approvals] quote query failed:", quotesRes.error.message);

      // Normalize Supabase joined relations (arrays → single objects)
      const normalizeJoin = <T extends Record<string, unknown>>(rows: T[] | null): T[] =>
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
        margin: normalizeJoin(marginRes.data) as MarginRow[],
        deposits: normalizeJoin(depositsRes.data) as DepositRow[],
        trades: normalizeJoin(tradesRes.data) as TradeRow[],
        demos: normalizeJoin(demosRes.data) as DemoRow[],
        quotes: normalizeJoin(quotesRes.data) as QuoteApprovalRow[],
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Mutation hooks ────────────────────────────────────────────────────────

export function useApproveMargin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: string) => {
      const { error } = await supabase
        .from("crm_deals")
        .update({ margin_check_status: "approved_by_manager" })
        .eq("id", dealId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useVerifyDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (depositId: string) => {
      const { error } = await supabase
        .from("deposits")
        .update({
          status: "verified",
          verified_at: new Date().toISOString(),
        })
        .eq("id", depositId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useApproveTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tradeId, notes }: { tradeId: string; notes?: string }) => {
      const { error } = await supabase
        .from("trade_valuations")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          approval_notes: notes ?? null,
        })
        .eq("id", tradeId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useApproveDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (demoId: string) => {
      const { error } = await supabase
        .from("demos")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .eq("id", demoId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDecideQuoteApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      approvalId: string;
      decision: "approved" | "rejected";
      reason?: string;
    }) => {
      const { error: approvalError } = await supabase.rpc("decide_flow_approval", {
        p_approval_id: input.approvalId,
        p_decision: input.decision,
        p_reason: input.reason ?? null,
      });
      if (approvalError) throw new Error(approvalError.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["flow-approvals-pending"] });
      qc.invalidateQueries({ queryKey: ["flow-admin-recent-runs"] });
      qc.invalidateQueries({ queryKey: ["quote-builder", "list"] });
    },
  });
}
