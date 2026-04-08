/**
 * Lightweight wrapper around `RecommendationCard` for the Action Lanes
 * surface. Lane cards are intentionally compact (the lanes can hold up to
 * 8 cards each). The hero variant is reserved for AI Chief of Staff.
 */

import { RecommendationCard } from "./RecommendationCard";
import type { RecommendationCardPayload } from "../api/commandCenter.types";

interface ActionLaneCardProps {
  card: RecommendationCardPayload;
  onAccept?: (card: RecommendationCardPayload) => void;
  onDismiss?: (card: RecommendationCardPayload) => void;
}

export function ActionLaneCard({ card, onAccept, onDismiss }: ActionLaneCardProps) {
  return (
    <RecommendationCard
      card={card}
      variant="compact"
      showLaneBadge={false}
      onAccept={onAccept}
      onDismiss={onDismiss}
    />
  );
}
