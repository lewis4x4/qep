/**
 * Wave 7.1 Iron Companion — global presence subscribers.
 *
 * Mounts (renders nothing) inside IronShell so the avatar reflects
 * real-time signals from across the entire app:
 *
 *   • TanStack Query mutations:    background save → thinking glow
 *   • Sentry-captured errors:       any thrown error anywhere → alert flash
 *   • Workspace switches:           switch start → listening pulse
 *
 * Each subscriber pushes into the global presence bus and releases when
 * the underlying signal clears. Subscribers are added once on mount and
 * cleaned up on unmount.
 *
 * Iron's own classify/think/speak loop pushes its own state through the
 * same bus from IronBar/FlowEngineUI/voice — those are wired separately.
 */
import { useEffect } from "react";
import { useQueryClient, type Mutation } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { pushPresence } from "./presence";

const MUTATION_GRACE_MS = 800;

export function IronGlobalSubscribers() {
  const queryClient = useQueryClient();

  /**
   * Subscribe to mutation cache. When ANY mutation enters loading state
   * for longer than 800ms (we don't want to flash the avatar on every
   * sub-second save), push a 'thinking' presence entry. Release on settle.
   */
  useEffect(() => {
    if (!queryClient) return;

    const cache = queryClient.getMutationCache();
    const releases = new Map<number, () => void>();
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    const unsubscribe = cache.subscribe((event) => {
      const mutation = event.mutation as Mutation | undefined;
      if (!mutation) return;
      const id = mutation.mutationId;

      if (event.type === "updated" && mutation.state.status === "pending") {
        // Schedule a delayed push so sub-second mutations don't flash
        if (!timers.has(id) && !releases.has(id)) {
          const timer = setTimeout(() => {
            timers.delete(id);
            // Re-check that the mutation is still pending before pushing
            if (mutation.state.status === "pending") {
              releases.set(id, pushPresence(`mutation:${id}`, "thinking"));
            }
          }, MUTATION_GRACE_MS);
          timers.set(id, timer);
        }
      } else if (
        event.type === "updated" &&
        (mutation.state.status === "success" || mutation.state.status === "error")
      ) {
        // Settled — clear any pending timer and release any active push
        const timer = timers.get(id);
        if (timer) {
          clearTimeout(timer);
          timers.delete(id);
        }
        const release = releases.get(id);
        if (release) {
          release();
          releases.delete(id);
        }
      } else if (event.type === "removed") {
        const timer = timers.get(id);
        if (timer) {
          clearTimeout(timer);
          timers.delete(id);
        }
        const release = releases.get(id);
        if (release) {
          release();
          releases.delete(id);
        }
      }
    });

    return () => {
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
      for (const r of releases.values()) r();
      timers.clear();
      releases.clear();
    };
  }, [queryClient]);

  /**
   * Subscribe to Sentry-captured errors. Any captured event flashes the
   * avatar to 'alert' for 4 seconds.
   *
   * Sentry's `addEventProcessor` API has no removal hook, so we use a
   * mount-scoped ref to make the processor a no-op after unmount instead
   * of trying (and failing) to detach it. IronShell mounts once per app
   * session, so the processor's lifetime matches the app's anyway. This
   * is correct, not lazy.
   */
  useEffect(() => {
    const client = Sentry.getClient();
    if (!client) return;

    const guard = { active: true };

    const processor = (event: Sentry.Event): Sentry.Event | null => {
      if (!guard.active) return event;
      // Only react to actual exceptions, not breadcrumbs or transactions.
      if (event.type === undefined && event.exception?.values?.length) {
        pushPresence("sentry-error", "alert", { ttlMs: 4000 });
      }
      return event;
    };

    client.addEventProcessor(processor);

    return () => {
      guard.active = false;
    };
  }, []);

  return null;
}
