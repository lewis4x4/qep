/**
 * Shared types + constants for handing a pre-seeded question to the Ask
 * Iron surface via React Router location state.
 *
 * Slice 8 of the 4-surface collapse. Where Slice 3 put ambient events on
 * Pulse, Slice 4 gave Iron tools, Slice 6 gave Iron write access, and
 * Slice 7 surfaced Iron's provenance on Today, this module is the hinge
 * that lets any surface (Pulse today, Graph tomorrow) say "ask Iron about
 * this" with one click.
 *
 * Why a separate module: PulseSurface writes the state, AskIronSurface
 * reads it. Both import from here so a typo in the state-key doesn't
 * create a silent handoff drop.
 *
 * Why kept pure (no React): Bun tests can import the constants and type
 * without spinning happy-dom.
 */

/** Path of the Ask Iron surface under the shell_v2 flag. */
export const ASK_IRON_PATH = "/qrm/operations-copilot";

/**
 * Location-state payload carried by react-router when a surface hands a
 * seeded question to Ask Iron.
 *
 * source / sourceId are optional metadata used for analytics and to let
 * Iron's future tool-catalog reason about the originating surface (e.g.
 * "don't suggest moves for signals already acted on").
 */
export interface AskIronSeedState {
  askIronSeed: {
    /** The composed question to auto-send on mount. */
    question: string;
    /** Which surface originated the handoff. */
    source: "pulse" | "graph" | "today" | "other";
    /** Optional id of the originating entity for downstream correlation. */
    sourceId?: string;
  };
}

/**
 * Narrow type-guard used by AskIronSurface when peeking at location.state.
 * Returns true only when the state carries a non-empty seed question —
 * refresh / back-nav strips the state down to `{}`, at which point we
 * must NOT re-fire.
 */
export function isAskIronSeedState(
  state: unknown,
): state is AskIronSeedState {
  if (!state || typeof state !== "object") return false;
  const candidate = (state as { askIronSeed?: unknown }).askIronSeed;
  if (!candidate || typeof candidate !== "object") return false;
  const { question } = candidate as { question?: unknown };
  return typeof question === "string" && question.trim().length > 0;
}
