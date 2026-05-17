/**
 * Post–PR 21 orchestrator slimming: intelligence panel wiring from orchestrator page.
 */

import type { QuoteFinancingRequest } from "../lib/quote-api";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import { IntelligencePanel } from "./IntelligencePanel";

export interface QuoteBuilderIntelligencePanelHostProps {
  draft: QuoteWorkspaceDraft;
  financingInput: QuoteFinancingRequest;
  equipmentMake: string | undefined;
  equipmentModel: string | undefined;
  userRole: string | null;
  onSelectPrimary: () => void;
  onSelectAlternative: (() => void) | undefined;
  onBrowseCatalog: () => void;
}

export function QuoteBuilderIntelligencePanelHost({
  draft,
  financingInput,
  equipmentMake,
  equipmentModel,
  userRole,
  onSelectPrimary,
  onSelectAlternative,
  onBrowseCatalog,
}: QuoteBuilderIntelligencePanelHostProps) {
  return (
    <IntelligencePanel
      recommendation={draft.recommendation}
      voiceSummary={draft.voiceSummary}
      onSelectPrimary={onSelectPrimary}
      onSelectAlternative={onSelectAlternative}
      onBrowseCatalog={onBrowseCatalog}
      financingInput={financingInput}
      equipmentMake={equipmentMake}
      userRole={userRole}
      equipmentModel={equipmentModel}
    />
  );
}
