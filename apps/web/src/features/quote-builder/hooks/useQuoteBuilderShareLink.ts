/**
 * Post–PR 21 orchestrator slimming: customer share-link issuance.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";

import { issueShareToken } from "@/features/deal-room/lib/deal-room-api";

export interface UseQuoteBuilderShareLinkInput {
  activeQuotePackageId: string | null;
  setShareUrl: Dispatch<SetStateAction<string | null>>;
  setShareBusy: Dispatch<SetStateAction<boolean>>;
  setShareError: Dispatch<SetStateAction<string | null>>;
}

export interface UseQuoteBuilderShareLinkResult {
  handleIssueShareLink: () => Promise<void>;
}

export function useQuoteBuilderShareLink({
  activeQuotePackageId,
  setShareUrl,
  setShareBusy,
  setShareError,
}: UseQuoteBuilderShareLinkInput): UseQuoteBuilderShareLinkResult {
  const handleIssueShareLink = useCallback(async () => {
    if (!activeQuotePackageId) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const { token } = await issueShareToken(activeQuotePackageId);
      const url = `${window.location.origin}/q/${token}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard can be unavailable in preview or restricted browsers.
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Unable to create share link.");
    } finally {
      setShareBusy(false);
    }
  }, [activeQuotePackageId, setShareBusy, setShareError, setShareUrl]);

  return { handleIssueShareLink };
}
