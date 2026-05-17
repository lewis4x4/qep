/**
 * Post–PR 21 orchestrator slimming: catalog equipment + package item mutations.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import type { QuotePackageCatalogItem } from "../lib/quote-api";
import {
  buildEquipmentLineFromCatalog,
  buildPackageCatalogLine,
  catalogAttachmentToPackageItem,
  mergeUniqueAttachmentLine,
  mergeUniqueEquipmentLine,
} from "../lib/catalog-line-mutations";
import type { CatalogAttachmentMatch, CatalogEntryMatch } from "../lib/quote-builder-page-helpers";

export interface UseQuoteBuilderCatalogActionsInput {
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  setAvailableOptions: Dispatch<SetStateAction<Array<{ id: string; name: string; price: number }>>>;
  setAvailableOptionsLabel: Dispatch<SetStateAction<string | null>>;
}

export function useQuoteBuilderCatalogActions({
  setDraft,
  setAvailableOptions,
  setAvailableOptionsLabel,
}: UseQuoteBuilderCatalogActionsInput) {
  const addPackageCatalogItem = useCallback((entry: QuotePackageCatalogItem) => {
    const line = buildPackageCatalogLine(entry);
    setDraft((current) => ({
      ...current,
      attachments: mergeUniqueAttachmentLine(current.attachments, line),
    }));
  }, [setDraft]);

  const addCatalogEquipment = useCallback((entry: CatalogEntryMatch) => {
    setAvailableOptions(entry.attachments ?? []);
    setAvailableOptionsLabel(`${entry.make} ${entry.model}`);
    const nextLine = buildEquipmentLineFromCatalog(entry);
    setDraft((current) => ({
      ...current,
      equipment: mergeUniqueEquipmentLine(current.equipment, nextLine),
    }));
  }, [setAvailableOptions, setAvailableOptionsLabel, setDraft]);

  const addCatalogAttachment = useCallback((entry: CatalogAttachmentMatch) => {
    addPackageCatalogItem(catalogAttachmentToPackageItem(entry));
  }, [addPackageCatalogItem]);

  return { addCatalogEquipment, addCatalogAttachment, addPackageCatalogItem };
}
