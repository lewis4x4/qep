import { AiRecommendationCard } from "./AiRecommendationCard";
import { FinancingPreviewCard } from "./FinancingPreviewCard";
import { TradeInInputCard } from "./TradeInInputCard";
import { CompetitiveBattleCard } from "./CompetitiveBattleCard";
import type { QuoteRecommendation } from "../../../../../../shared/qep-moonshot-contracts";

interface IntelligencePanelProps {
  recommendation: QuoteRecommendation | null;
  voiceSummary?: string | null;
  onSelectPrimary: () => void;
  onSelectAlternative?: () => void;
  onBrowseCatalog: () => void;
  // Financing preview
  netTotal: number;
  marginPct: number;
  equipmentMake?: string;
  equipmentKey: string;
  // Trade-in (standalone — no deal linked)
  hasDeal: boolean;
  tradeAllowance: number;
  onTradeChange: (value: number) => void;
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
  netTotal,
  marginPct,
  equipmentMake,
  equipmentKey,
  hasDeal,
  tradeAllowance,
  onTradeChange,
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

      {netTotal > 0 && (
        <FinancingPreviewCard
          netTotal={netTotal}
          marginPct={marginPct}
          make={equipmentMake}
          equipmentKey={equipmentKey}
        />
      )}

      {!hasDeal && (
        <TradeInInputCard
          tradeAllowance={tradeAllowance}
          onChange={onTradeChange}
        />
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
