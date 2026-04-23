import type { FloorLayoutWidget } from "./layout-types";
import type { FloorWidgetDescriptor } from "./floor-widget-registry";

export const FLOOR_ATTENTION_PIN_THRESHOLD = 70;

export interface FloorAttentionSignals {
  approvalCount: number;
  staleDealCount: number;
  pendingInvoiceCount: number;
  openServiceTicketCount: number;
  partsStockoutCount: number;
  quoteFollowupCount: number;
  counterInquiryCount: number;
  generatedAt: string;
}

export interface FloorAttentionScore {
  score: number;
  reason?: string;
}

export type FloorWidgetWithAttention = FloorLayoutWidget & {
  attention?: FloorAttentionScore;
  attentionPinned?: boolean;
};

export function clampAttentionScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function applyAttentionPinning(
  layoutWidgets: FloorLayoutWidget[],
  registry: Record<string, FloorWidgetDescriptor>,
  signals: FloorAttentionSignals | null | undefined,
): FloorWidgetWithAttention[] {
  const scored = layoutWidgets.map((widget, index) => {
    const descriptor = registry[widget.id];
    const attention = signals && descriptor?.getAttentionScore
      ? normalizeAttentionScore(descriptor.getAttentionScore(signals))
      : undefined;
    return {
      ...widget,
      attention,
      attentionPinned: Boolean(attention && attention.score >= FLOOR_ATTENTION_PIN_THRESHOLD),
      originalIndex: index,
    };
  });

  return scored
    .sort((a, b) => {
      if (a.attentionPinned !== b.attentionPinned) return a.attentionPinned ? -1 : 1;
      if (a.attentionPinned && b.attentionPinned) {
        const delta = (b.attention?.score ?? 0) - (a.attention?.score ?? 0);
        if (delta !== 0) return delta;
      }
      return a.originalIndex - b.originalIndex;
    })
    .map(({ originalIndex: _originalIndex, ...widget }) => widget);
}

function normalizeAttentionScore(score: FloorAttentionScore): FloorAttentionScore {
  return {
    score: clampAttentionScore(score.score),
    reason: score.reason,
  };
}
