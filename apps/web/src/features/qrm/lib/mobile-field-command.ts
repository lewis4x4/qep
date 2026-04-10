import type { CommandCenterResponse, LaneKey, RecommendationCardPayload } from "../command-center/api/commandCenter.types";

export interface MobileFieldPriorityItem extends RecommendationCardPayload {
  source: "chief_of_staff" | "lane";
}

const LANE_PRIORITY: Record<LaneKey, number> = {
  blockers: 0,
  revenue_at_risk: 1,
  revenue_ready: 2,
};

function pushCard(
  bucket: MobileFieldPriorityItem[],
  seen: Set<string>,
  card: RecommendationCardPayload | null | undefined,
  source: MobileFieldPriorityItem["source"],
) {
  if (!card || seen.has(card.recommendationKey)) return;
  seen.add(card.recommendationKey);
  bucket.push({ ...card, source });
}

export function buildMobileFieldPriorityFeed(
  payload: Pick<CommandCenterResponse, "aiChiefOfStaff" | "actionLanes">,
): MobileFieldPriorityItem[] {
  const seen = new Set<string>();
  const items: MobileFieldPriorityItem[] = [];

  pushCard(items, seen, payload.aiChiefOfStaff.biggestRisk, "chief_of_staff");
  pushCard(items, seen, payload.aiChiefOfStaff.fastestPath, "chief_of_staff");
  pushCard(items, seen, payload.aiChiefOfStaff.bestMove, "chief_of_staff");

  for (const card of payload.actionLanes.blockers) pushCard(items, seen, card, "lane");
  for (const card of payload.actionLanes.revenueAtRisk) pushCard(items, seen, card, "lane");
  for (const card of payload.actionLanes.revenueReady) pushCard(items, seen, card, "lane");

  return items
    .sort((a, b) => {
      const laneOrder = LANE_PRIORITY[a.lane] - LANE_PRIORITY[b.lane];
      if (laneOrder !== 0) return laneOrder;
      if (b.score !== a.score) return b.score - a.score;
      return b.confidence - a.confidence;
    })
    .slice(0, 6);
}
