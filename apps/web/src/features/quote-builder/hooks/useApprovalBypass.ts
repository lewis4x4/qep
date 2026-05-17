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

import {
  useQuery,
  type QueryObserverResult,
  type RefetchOptions,
} from "@tanstack/react-query";

import type { QuoteApprovalCaseSummary } from "../../../../../../shared/qep-moonshot-contracts";
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
  const caseQuery = useQuery({
    queryKey: ["quote-builder", "approval-case", quotePackageId],
    queryFn: () => getQuoteApprovalCase(quotePackageId!),
    enabled: Boolean(quotePackageId),
    staleTime: APPROVAL_CASE_STALE_MS,
  });

  const approvalCase = caseQuery.data ?? null;
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
