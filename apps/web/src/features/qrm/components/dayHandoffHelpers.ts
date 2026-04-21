/**
 * Pure helpers for the Today → Ask Iron "Brief my day" handoff (Slice 15).
 *
 * Where Slice 12's moveHandoffHelpers seeds Iron with a single-move
 * defend-or-challenge brief, this module seeds a surface-level morning
 * briefing that lands Iron on the summarize_day synthesizer (Slice 14).
 *
 * Why this exists as its own helper rather than in moveHandoffHelpers:
 * the day-brief question has no QrmMove input and no kind-specific
 * opener logic — it's shaped entirely by the operator's current scope
 * (my queue vs. team queue) and role. Keeping it in its own module
 * keeps moveHandoffHelpers' surface area tight and makes the Bun test
 * easy to reason about in isolation.
 *
 * Kept free of React / supabase imports so Bun can exercise formatting
 * without spinning up happy-dom (same rule as the Slice 8/9/12 helpers).
 */

/**
 * Which lens the operator currently has on the Today feed. "mine" is the
 * rep's own queue (also the default for elevated callers who haven't
 * switched to team view); "team" is the elevated-only workspace-wide
 * view. The Today surface is the only caller, so the set is exhaustive
 * and small on purpose.
 */
export type IronDayBriefScope = "mine" | "team";

/**
 * Human label for the chip button. Mirrors the scope toggle copy so the
 * operator doesn't need to translate between the pill and the action.
 */
export function labelForDayBriefScope(scope: IronDayBriefScope): string {
  return scope === "team" ? "Brief the team" : "Brief my day";
}

/**
 * Build the seed question Ask Iron receives when the operator taps the
 * "Brief my day" chip on Today. The prompt is intentionally explicit
 * about the summarize_day tool and its inputs so Iron doesn't spend a
 * turn guessing which synthesizer to reach for.
 *
 * Two branches:
 *
 *   - "mine": asks Iron to call summarize_day scoped to the caller.
 *     summarize_day pins rep callers to self regardless of rep_id input
 *     and leaves rep_id null when an elevated caller omits it, so the
 *     prompt doesn't need to reason about role — it just describes the
 *     intended lens in operator terms.
 *   - "team": asks Iron to call summarize_day workspace-wide (rep_id
 *     omitted). Only elevated callers can reach this branch because
 *     TodaySurface gates the scope toggle on role.
 *
 * Both branches close with an explicit propose_move nudge: if Iron
 * spots an obvious gap in the briefing (a stalled deal with no queued
 * play, a signal no one's acted on), it should write the move rather
 * than just narrate the hole.
 *
 * Why hand-tuned windows + bullets rather than a terse one-liner: Iron
 * has 10 tools and will default to the cheapest read if the prompt is
 * vague. Naming summarize_day by hand keeps the tool-selection stable
 * as new tools ship.
 */
export function formatIronDayBriefPrompt(scope: IronDayBriefScope): string {
  if (scope === "team") {
    return [
      "Brief me on the team's day so far.",
      "• Window: last 24 hours (this shift).",
      "• Use summarize_day with no rep_id so it pulls the full workspace view.",
      "• Call out what's in flight across reps, what got completed, fresh customer touches worth flagging, and any medium+ severity signals that need attention.",
      "If you spot a gap — a stalled deal without a queued play, or a signal no one's acting on — call propose_move to queue it.",
    ].join("\n");
  }
  return [
    "Brief me on my day.",
    "• Window: last 24 hours (this shift).",
    "• Use summarize_day with lookback_hours=24 — you'll be pinned to my rep_id automatically.",
    "• Call out active moves on my plate, what I closed today, fresh touches I logged, and any medium+ severity signals on the yard's radar that could affect my deals.",
    "If a clear next play shows up that isn't already queued, call propose_move.",
  ].join("\n");
}
