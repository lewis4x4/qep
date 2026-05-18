// QRM Quote Builder — approval-case + bypass state hook.
//
// Introduced as PR 7 of the IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
// Bundles the existing client-side approval state into a single named
// seam so PR 18 (ReviewStep extraction) can consume one import instead
// of seven page-local derivations.
//
// Scope is **strictly the strangler-fig extraction** — no client-side
// mirror of the server `approval_bypass_rules` evaluator (that lives in
// supabase/functions/quote-builder-v2/index.ts::resolveApprovalBypassRule
// and stays the source of truth). The "bypass" name reflects that one
// of the bundled signals — `bypassApprovedWithoutCase` — encodes the
// post-condition "edge bypass took effect" by observing that the quote
// moved past `draft` status without ever creating an approval-case row.
//
// Behavior contract (preserved 1:1 from QuoteBuilderV2Page.tsx):
//   - approvalCase: getQuoteApprovalCase result, gated on quotePackageId,
//     5s stale time (matches saveMutation invalidation cadence).
//   - pending: quoteStatus === "pending_approval".
//   - bypassApprovedWithoutCase: no approval-case row AND quoteStatus is
//     one of approved / sent / accepted.
//   - canSend: approvalCase.canSend === true OR bypassApprovedWithoutCase.
//   - granted: quoteStatus is one of approved /
//     approved_with_conditions / sent / accepted.
//   - canSubmit: draft is ready, branch chosen, and status is none of
//     pending / approved / approved_with_conditions / sent / accepted.

import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryObserverResult,
  type RefetchOptions,
} from "@tanstack/react-query";

import type { QuoteApprovalCaseSummary } from "../../../../../../shared/qep-moonshot-contracts";
import { supabase } from "@/lib/supabase";
import { getQuoteApprovalCase } from "../lib/quote-api";

const APPROVAL_CASE_STALE_MS = 5_000;

const BYPASS_APPROVED_STATUSES = new Set([
  "approved",
  "approved_with_conditions",
  "sent",
  "accepted",
]);

/** Pure helper — exported for unit tests and ReviewStep bypass badge logic. */
export function isBypassApprovedWithoutCase(
  approvalCase: QuoteApprovalCaseSummary | null,
  quoteStatus: string,
): boolean {
  return !approvalCase && BYPASS_APPROVED_STATUSES.has(quoteStatus);
}

export interface UseApprovalBypassInput {
  quotePackageId: string | null;
  /** `draft.quoteStatus ?? "draft"` — caller normalizes the null. */
  quoteStatus: string;
  /** Truthy when `draft.branchSlug` is set. */
  draftHasBranch: boolean;
  /** `packetReadiness.draft.ready` from useLiveMargin. */
  draftReady: boolean;
}

export interface UseApprovalBypassResult {
  approvalCase: QuoteApprovalCaseSummary | null;
  caseLoading: boolean;
  refetchCase: (options?: RefetchOptions) => Promise<QueryObserverResult<QuoteApprovalCaseSummary | null, Error>>;
  pending: boolean;
  bypassApprovedWithoutCase: boolean;
  canSend: boolean;
  granted: boolean;
  canSubmit: boolean;
}

export function useApprovalBypass({
  quotePackageId,
  quoteStatus,
  draftHasBranch,
  draftReady,
}: UseApprovalBypassInput): UseApprovalBypassResult {
  const queryClient = useQueryClient();
  const caseQuery = useQuery({
    queryKey: ["quote-builder", "approval-case", quotePackageId],
    queryFn: () => getQuoteApprovalCase(quotePackageId!),
    enabled: Boolean(quotePackageId),
    staleTime: APPROVAL_CASE_STALE_MS,
  });

  const approvalCase = caseQuery.data ?? null;
  const activeApprovalCaseId = approvalCase?.id ?? null;

  // Phase 1 quote-approval feedback loop: Supabase Realtime subscription
  // on the active case row. Replaces poll-style latency (the 5s
  // staleTime above is retained as a passive safety net for tab focus
  // and refetch-on-mount; the realtime channel drives the fast path).
  // The channel is keyed on the case id so we re-subscribe whenever a
  // new case is created for a different package.
  useEffect(() => {
    if (!activeApprovalCaseId) return;
    // Snapshot the package id so the invalidation callback uses the
    // value at subscribe time even if the parent rerenders before the
    // channel tears down.
    const scopedPackageId = quotePackageId;
    const channel = supabase
      .channel(`quote-approval-case-${activeApprovalCaseId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "quote_approval_cases",
          filter: `id=eq.${activeApprovalCaseId}`,
        },
        () => {
          // Invalidate both the keyed and the broad query so any
          // panels (ReviewWorkflowPanels, MarginCheckBanner, etc.)
          // that read the same key refetch the latest case row.
          queryClient.invalidateQueries({
            queryKey: ["quote-builder", "approval-case", scopedPackageId],
          });
          queryClient.invalidateQueries({
            queryKey: ["quote-builder", "approval-case"],
          });
        },
      )
      .subscribe();
    // Always-on teardown: removeChannel is safe to call even if the
    // subscribe handshake never completed (Supabase queues the unsub
    // internally and the channel is removed from the client registry).
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeApprovalCaseId, queryClient, quotePackageId]);
  const pending = quoteStatus === "pending_approval";
  const bypassApprovedWithoutCase = isBypassApprovedWithoutCase(approvalCase, quoteStatus);
  const canSend = approvalCase?.canSend === true || bypassApprovedWithoutCase;
  const granted =
    quoteStatus === "approved"
    || quoteStatus === "approved_with_conditions"
    || quoteStatus === "sent"
    || quoteStatus === "accepted";
  const canSubmit =
    draftReady
    && draftHasBranch
    && quoteStatus !== "sent"
    && quoteStatus !== "accepted"
    && !pending
    && quoteStatus !== "approved"
    && quoteStatus !== "approved_with_conditions";

  return {
    approvalCase,
    caseLoading: caseQuery.isLoading,
    refetchCase: caseQuery.refetch,
    pending,
    bypassApprovedWithoutCase,
    canSend,
    granted,
    canSubmit,
  };
}
