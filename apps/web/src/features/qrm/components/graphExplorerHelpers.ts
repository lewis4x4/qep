/**
 * Pure helpers for GraphExplorer presentation. Kept free of react / supabase
 * imports so Bun's test runner can exercise them without spinning up the
 * whole web app (mirrors the signalCardHelpers + moveProvenance pattern).
 *
 * The central export is `formatIronGraphPrompt` — the Slice 9 mirror of
 * Slice 8's `formatIronTriagePrompt`. Where the Pulse handoff said
 * "triage this signal", the Graph handoff says "brief me on this entity"
 * — same one-click pattern, different verb, different expected tools on
 * the Iron side.
 */

import type { QrmSearchItem, QrmSearchEntityType } from "../lib/types";

/**
 * Human label for each Graph entity type. Used inside the composed Iron
 * prompt and also as a seed for the entity-specific opener ("this deal"
 * vs "this machine").
 */
export function labelForGraphEntity(type: QrmSearchEntityType): string {
  switch (type) {
    case "deal": return "deal";
    case "company": return "company";
    case "contact": return "contact";
    case "equipment": return "machine";
    case "rental": return "rental request";
  }
}

/**
 * The opening verb sentence for each entity type. Distinct copy per type
 * so the conversation feels on-topic from the first line — a generic
 * "give me info on this entity" bleeds affordance.
 *
 * Case tuning:
 *   - deal: status + next move (sales-motion vocabulary)
 *   - company: account landscape (multi-deal thinking)
 *   - contact: relationship state (person-centric)
 *   - equipment: availability / service / pressure (iron-centric)
 *   - rental: fulfillment state (utilization / return)
 */
function openerForGraphEntity(type: QrmSearchEntityType): string {
  switch (type) {
    case "deal":
      return "Brief me on this deal — stage, health, and the single best next move.";
    case "company":
      return "Give me the account picture for this company — open deals, recent signals, and any moves worth queueing.";
    case "contact":
      return "What's the state of this contact — recent touches, open threads, and whether a follow-up is overdue?";
    case "equipment":
      return "Status of this machine — availability, service history, and any signals tying it to an open deal or rental.";
    case "rental":
      return "Where is this rental request — fulfillment status, blocking signals, and the next action if any.";
  }
}

/**
 * Per-entity synthesizer hint. Slice 17: Iron now has three dedicated
 * synthesizer tools (summarize_deal / summarize_company / summarize_contact)
 * that bundle the entity row + related rows + signals into a single tool
 * call. Naming the tool by hand in the prompt keeps Iron's tool selection
 * stable as the catalog grows — otherwise the model may default to the
 * cheaper but noisier get_*_detail + list_recent_signals chain.
 *
 * Returns null for entity types that don't have a synthesizer yet
 * (equipment, rental) — those keep the generic closer.
 */
function toolHintForGraphEntity(type: QrmSearchEntityType): string | null {
  switch (type) {
    case "deal":
      return "Call summarize_deal with this deal_id to pull the deal row + recent activities + open signals in one shot.";
    case "company":
      return "Call summarize_company with this company_id to pull the account row + open deals + recent activities + signals in one shot.";
    case "contact":
      return "Call summarize_contact with this contact_id to pull the person + related deals at their company + recent activities + open signals in one shot.";
    case "equipment":
    case "rental":
      return null;
  }
}

/**
 * Slice 9 — Graph → Ask Iron deep-brief handoff.
 *
 * Build a well-scoped seed question for Ask Iron when the operator clicks
 * "Ask Iron" on a Graph row. The question carries the entity's type +
 * title + id (so Iron's detail tools can look up the row directly), plus
 * the subtitle when present (often a one-line qualifier like stage,
 * company, or serial number) and the updatedAt timestamp as a freshness
 * hint.
 *
 * Kept pure so Bun can exercise formatting without the HTTP client: the
 * caller composes a string, navigates to the Ask Iron surface with it in
 * router state, and AskIronSurface auto-sends on mount.
 *
 * Not a system-prompt override: this is a user-role message. Iron's
 * existing system prompt already tells it to use tools and only propose
 * moves when explicitly asked — the closing line here gives it the
 * explicit propose_move permission.
 */
export function formatIronGraphPrompt(item: QrmSearchItem): string {
  const parts: string[] = [];
  parts.push(openerForGraphEntity(item.type));

  const kindLabel = labelForGraphEntity(item.type);
  const title = item.title.trim() || "(untitled)";
  parts.push(`• ${kindLabel}: ${title}`);

  if (item.subtitle && item.subtitle.trim().length > 0) {
    const sub = item.subtitle.replace(/\s+/g, " ").trim();
    // Cap at 200 — subtitles are already short but defend against future
    // backend changes that could cram payload into them.
    const capped = sub.length > 200 ? `${sub.slice(0, 199)}…` : sub;
    parts.push(`• Detail: ${capped}`);
  }

  // Entity scope hint — lets Iron go straight to a detail tool instead of
  // starting with search_entities.
  parts.push(`• Entity: ${item.type} (${item.id})`);

  // Slice 17 — if the entity has a synthesizer tool, name it explicitly.
  // The system prompt already describes the synthesizer for narrative
  // questions, but handoffs are user-role messages and benefit from
  // belt-and-suspenders tool-naming. Equipment / rental keep the generic
  // closer since they have no synthesizer yet.
  const toolHint = toolHintForGraphEntity(item.type);
  if (toolHint) {
    parts.push(toolHint);
    parts.push(
      "If there's a clear follow-up, call propose_move; otherwise tell me what you'd want to know before queueing anything.",
    );
  } else {
    parts.push(
      "Use the detail tools and recent signals to ground your answer. If there's a clear follow-up, call propose_move; otherwise explain what you'd want to know before queueing anything.",
    );
  }

  return parts.join("\n");
}
