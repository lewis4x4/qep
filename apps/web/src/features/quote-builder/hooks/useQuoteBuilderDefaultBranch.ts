/**
 * Post–PR 21 orchestrator slimming: auto-select sole active branch.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface BranchOption {
  slug: string;
}

export interface UseQuoteBuilderDefaultBranchInput {
  branchSlug: string | undefined;
  branches: BranchOption[];
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
}

export function useQuoteBuilderDefaultBranch({
  branchSlug,
  branches,
  setDraft,
}: UseQuoteBuilderDefaultBranchInput): void {
  useEffect(() => {
    if (branchSlug || branches.length !== 1) return;
    setDraft((current) => current.branchSlug
      ? current
      : { ...current, branchSlug: branches[0]!.slug });
  }, [branchSlug, branches, setDraft]);
}
