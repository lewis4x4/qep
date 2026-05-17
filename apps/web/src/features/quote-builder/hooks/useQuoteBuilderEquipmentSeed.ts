/**
 * Post–PR 21 orchestrator slimming: CRM equipment deep-link seeding.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { getCrmEquipmentQuoteSeed } from "../lib/quote-api";
import {
  buildEquipmentLine,
  equipmentKeyForLine,
} from "../lib/quote-builder-page-helpers";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface UseQuoteBuilderEquipmentSeedInput {
  equipmentId: string;
  packageId: string;
  dealId: string;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  setAvailableOptions: Dispatch<SetStateAction<Array<{ id: string; name: string; price: number }>>>;
  setAvailableOptionsLabel: Dispatch<SetStateAction<string | null>>;
}

export function useQuoteBuilderEquipmentSeed({
  equipmentId,
  packageId,
  dealId,
  setDraft,
  setAvailableOptions,
  setAvailableOptionsLabel,
}: UseQuoteBuilderEquipmentSeedInput): void {
  const equipmentSeedAppliedRef = useRef<string | null>(null);

  const equipmentSeedQuery = useQuery({
    queryKey: ["quote-builder", "crm-equipment-seed", equipmentId],
    queryFn: () => getCrmEquipmentQuoteSeed(equipmentId),
    enabled: Boolean(equipmentId) && !packageId && !dealId,
    staleTime: 60_000,
  });

  useEffect(() => {
    const seed = equipmentSeedQuery.data;
    if (!seed) return;
    const seedKey = seed.sourceId || seed.id || equipmentId;
    if (!seedKey || equipmentSeedAppliedRef.current === seedKey) return;

    const nextLine = buildEquipmentLine(seed);
    const nextKey = equipmentKeyForLine(nextLine);
    equipmentSeedAppliedRef.current = seedKey;
    setAvailableOptions(seed.attachments ?? []);
    setAvailableOptionsLabel(
      `${seed.make} ${seed.model}`.trim() || seed.long_description || "Selected equipment",
    );
    setDraft((current) => ({
      ...current,
      equipment: current.equipment.some((item) => equipmentKeyForLine(item) === nextKey)
        ? current.equipment
        : [...current.equipment, nextLine],
    }));
  }, [
    equipmentId,
    equipmentSeedQuery.data,
    setAvailableOptions,
    setAvailableOptionsLabel,
    setDraft,
  ]);
}
