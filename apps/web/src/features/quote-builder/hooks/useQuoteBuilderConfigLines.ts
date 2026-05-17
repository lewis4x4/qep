/**
 * Post–PR 21 orchestrator slimming: configure-step attachment/option line add.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import {
  buildConfigAttachmentLine,
  mergeConfigAttachment,
  type ConfigLineInput,
} from "../lib/configure-line-mutations";
import type { QuotePackageCatalogKind } from "../lib/quote-api";

export interface UseQuoteBuilderConfigLinesInput {
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
}

export function useQuoteBuilderConfigLines({
  setDraft,
}: UseQuoteBuilderConfigLinesInput): {
  addConfigLine: (kind: QuotePackageCatalogKind, input?: ConfigLineInput) => void;
} {
  const addConfigLine = useCallback((
    kind: QuotePackageCatalogKind,
    input?: ConfigLineInput,
  ) => {
    const line = buildConfigAttachmentLine(kind, input);
    setDraft((current) => ({
      ...current,
      attachments: mergeConfigAttachment(current.attachments, line),
    }));
  }, [setDraft]);

  return { addConfigLine };
}
