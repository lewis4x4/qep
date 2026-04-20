/**
 * Pure helpers for the AskIronSurface chat UI. No React, no supabase — kept
 * in a standalone module so Bun tests can exercise the logic without the
 * happy-dom / render pipeline.
 */

import type {
  AskIronMessage,
  AskIronToolTraceEntry,
} from "../lib/ask-iron-types";

/**
 * Trim the message list used to seed the next LLM turn.
 *
 * The edge function accepts up to 12 prior turns, but we cap at 8 here to
 * keep individual requests small (most useful context is recency-weighted
 * anyway). Tool traces are stripped because the LLM only needs the text.
 */
export function buildHistoryPayload(
  messages: AskIronMessage[],
  max = 8,
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m) => m.content.length > 0)
    .slice(-max)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Collapse an Iron answer into a single-line preview for chip rendering.
 * Used in the "Latest answer" card above the input bar on small screens.
 */
export function oneLinePreview(answer: string, maxChars = 120): string {
  const collapsed = answer.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Humanize a tool name into a verb phrase the operator can parse at a
 * glance ("Checked moves", "Searched contacts"). We don't expose the raw
 * Claude tool name — operators don't care.
 */
export function humanizeToolName(tool: string): string {
  switch (tool) {
    case "list_my_moves":
      return "Checked moves";
    case "list_recent_signals":
      return "Checked signals";
    case "search_entities":
      return "Searched graph";
    case "get_deal_detail":
      return "Pulled deal detail";
    case "get_company_detail":
      return "Pulled company detail";
    default:
      return `Called ${tool}`;
  }
}

/**
 * Suggested starter questions shown on first load when the chat is empty.
 * Ordered by "most likely to be useful on Monday morning" first.
 */
export const SUGGESTED_STARTERS: string[] = [
  "What's on my plate right now?",
  "Any hot signals in the last 24 hours?",
  "Find Acme Construction",
  "Which deals are stalled more than a week?",
];

/**
 * Count unique entities a trace referenced. Shown as a small footer on each
 * answer ("Touched 3 moves · 5 signals") so operators can see how wide the
 * model went before it responded.
 */
export function summarizeToolTrace(
  trace: AskIronToolTraceEntry[] | undefined,
): { moves: number; signals: number; entities: number } {
  const summary = { moves: 0, signals: 0, entities: 0 };
  if (!trace) return summary;

  for (const entry of trace) {
    if (!entry.ok) continue;
    if (entry.tool === "list_my_moves") {
      const moves = (entry.result as { moves?: unknown[] } | null)?.moves;
      if (Array.isArray(moves)) summary.moves += moves.length;
    } else if (entry.tool === "list_recent_signals") {
      const signals = (entry.result as { signals?: unknown[] } | null)?.signals;
      if (Array.isArray(signals)) summary.signals += signals.length;
    } else if (entry.tool === "search_entities") {
      const matches = (entry.result as { matches?: unknown[] } | null)?.matches;
      if (Array.isArray(matches)) summary.entities += matches.length;
    } else if (
      entry.tool === "get_deal_detail" || entry.tool === "get_company_detail"
    ) {
      if ((entry.result as { found?: boolean } | null)?.found) {
        summary.entities += 1;
      }
    }
  }

  return summary;
}
