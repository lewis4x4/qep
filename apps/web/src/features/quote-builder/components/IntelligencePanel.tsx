import { AiRecommendationCard } from "./AiRecommendationCard";
import { FinancingPreviewCard } from "./FinancingPreviewCard";
import { CompetitiveBattleCard } from "./CompetitiveBattleCard";
import type { QuoteRecommendation } from "../../../../../../shared/qep-moonshot-contracts";
import type { QuoteFinancingRequest } from "../lib/quote-api";

interface IntelligencePanelProps {
  recommendation: QuoteRecommendation | null;
  voiceSummary?: string | null;
  onSelectPrimary: () => void;
  onSelectAlternative?: () => void;
  onBrowseCatalog: () => void;
  financingInput: QuoteFinancingRequest;
  equipmentMake?: string;
  // Competitive intel
  userRole: string | null;
  equipmentModel?: string;
}

export function IntelligencePanel({
  recommendation,
  voiceSummary,
  onSelectPrimary,
  onSelectAlternative,
  onBrowseCatalog,
  financingInput,
  equipmentMake,
  userRole,
  equipmentModel,
}: IntelligencePanelProps) {
  const isManagerOrOwner = userRole === "manager" || userRole === "owner";

  return (
    <div className="flex flex-col gap-4">
      {recommendation && recommendation.machine && (
        <AiRecommendationCard
          recommendation={recommendation}
          voiceSummary={voiceSummary}
          onSelectPrimary={onSelectPrimary}
          onSelectAlternative={onSelectAlternative}
          onBrowseCatalog={onBrowseCatalog}
        />
      )}

      {financingInput.packageSubtotal > 0 && (
        <FinancingPreviewCard input={financingInput} />
      )}

      {isManagerOrOwner && equipmentMake && (
        <CompetitiveBattleCard
          make={equipmentMake}
          model={equipmentModel}
        />
      )}
    </div>
  );
}
