/**
 * Wave 7.1 Iron Companion — global presence event bus.
 *
 * Anywhere in the app can `pushPresence(source, state, opts?)` to make the
 * Iron avatar reflect what's happening — long mutations, captured errors,
 * workspace switches, voice capture, TTS playback, flow execution, and
 * Iron's own classify-think-speak loop all share this single bus.
 *
 * The bus is a stack with priority resolution: when multiple sources are
 * active simultaneously, the highest-priority winning state is shown.
 *
 *   alert (10) > listening (8) > speaking (7) > thinking (6) >
 *   flow_active (5) > success (3) > idle (0)
 *
 * Usage:
 *   const release = pushPresence("my-mutation", "thinking");
 *   try { await doWork(); } finally { release(); }
 *
 *   // With auto-expiry — useful for transient flashes
 *   pushPresence("sentry-error", "alert", { ttlMs: 4000 });
 *
 *   // In React:
 *   const state = useIronPresenceState();
 *
 * Built on `useSyncExternalStore` so it works without React context — any
 * file can import and dispatch into it without dependency injection.
 */
import { useSyncExternalStore } from "react";
import type { IronAvatarState } from "./types";

const PRIORITY: Record<IronAvatarState, number> = {
  alert: 10,
  listening: 8,
  speaking: 7,
  thinking: 6,
  flow_active: 5,
  success: 3,
  idle: 0,
};

interface PresenceEntry {
  id: number;
  source: string;
  state: IronAvatarState;
  pushedAt: number;
  expiresAt?: number;
}

type Listener = () => void;

let entries: PresenceEntry[] = [];
let nextId = 1;
let cachedWinning: IronAvatarState = "idle";
const listeners = new Set<Listener>();

function recomputeWinning(): IronAvatarState {
  const now = Date.now();
  // Drop expired entries (compact in place)
  if (entries.some((e) => e.expiresAt !== undefined && e.expiresAt <= now)) {
    entries = entries.filter((e) => e.expiresAt === undefined || e.expiresAt > now);
  }
  if (entries.length === 0) return "idle";

  // Highest priority wins; ties broken by most recently pushed
  let winner: PresenceEntry | null = null;
  for (const entry of entries) {
    if (
      !winner ||
      PRIORITY[entry.state] > PRIORITY[winner.state] ||
      (PRIORITY[entry.state] === PRIORITY[winner.state] && entry.pushedAt > winner.pushedAt)
    ) {
      winner = entry;
    }
  }
  return winner?.state ?? "idle";
}

function emit(): void {
  const next = recomputeWinning();
  if (next !== cachedWinning) {
    cachedWinning = next;
  }
  // Always notify — listeners can dedupe via the snapshot identity check below.
  for (const listener of listeners) listener();
}

/**
 * Push a presence entry. Returns a `release()` function the caller MUST
 * invoke to remove the entry — call sites that forget to release leak
 * forever, so prefer `try { ... } finally { release() }` patterns.
 *
 * If `ttlMs` is set, the entry auto-expires and `release()` becomes a no-op.
 * Use ttlMs for transient flashes (Sentry errors, workspace switches).
 */
export function pushPresence(
  source: string,
  state: IronAvatarState,
  opts?: { ttlMs?: number },
): () => void {
  const id = nextId++;
  const now = Date.now();
  const entry: PresenceEntry = {
    id,
    source,
    state,
    pushedAt: now,
    expiresAt: opts?.ttlMs !== undefined ? now + opts.ttlMs : undefined,
  };
  entries.push(entry);
  emit();

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    const before = entries.length;
    entries = entries.filter((e) => e.id !== id);
    if (entries.length !== before) emit();
  };

  if (opts?.ttlMs !== undefined) {
    setTimeout(release, opts.ttlMs);
  }

  return release;
}

/**
 * Replace any existing entry with the same source. Useful for "the latest
 * push from this source wins, never stack mine on top of mine" patterns —
 * e.g., a mutation tracker that re-pushes on each state transition.
 */
export function replacePresence(
  source: string,
  state: IronAvatarState,
  opts?: { ttlMs?: number },
): () => void {
  entries = entries.filter((e) => e.source !== source);
  return pushPresence(source, state, opts);
}

/**
 * Drop all entries for a given source. Safe to call when not present.
 */
export function clearPresenceSource(source: string): void {
  const before = entries.length;
  entries = entries.filter((e) => e.source !== source);
  if (entries.length !== before) emit();
}

/**
 * Snapshot the currently-winning state. Cheap, safe in render paths.
 */
export function getCurrentPresenceState(): IronAvatarState {
  return recomputeWinning();
}

/**
 * Debug helper — returns a copy of the current stack.
 */
export function peekPresenceStack(): readonly PresenceEntry[] {
  return [...entries];
}

/**
 * Test-only helper to wipe all entries between tests.
 */
export function __resetPresenceForTests(): void {
  entries = [];
  nextId = 1;
  cachedWinning = "idle";
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook — returns the currently-winning presence state. Re-renders
 * whenever the winner changes. Use this in `IronAvatar` (or wherever you
 * want to mirror state) instead of subscribing to the per-feature store.
 */
export function useIronPresenceState(): IronAvatarState {
  return useSyncExternalStore(subscribe, getCurrentPresenceState, getCurrentPresenceState);
}
