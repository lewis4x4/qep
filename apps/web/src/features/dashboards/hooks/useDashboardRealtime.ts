import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { channelNameForRole, tablesForIronRole, type IronRoleKey } from "../lib/realtime-tables";

/**
 * Dashboard realtime subscription (Track 5 Slice 5.7).
 *
 * Subscribes to `postgres_changes` on the tables the caller's Iron role
 * cares about. On any INSERT/UPDATE/DELETE the React Query cache for the
 * caller-supplied `queryKey` is invalidated. A 250 ms trailing debounce
 * prevents bulk mutations (e.g. a cron that updates every prospecting_kpi
 * row at midnight) from storming `refetch`.
 *
 * Best-effort — if Supabase Realtime is unavailable (edge), the hook
 * silently no-ops after logging a single warning. The existing React
 * Query `refetchInterval` in useDashboardData is the safety net.
 *
 * @param role      iron role whose table-map drives the subscription
 * @param queryKey  React Query key to invalidate on any event
 * @param scopeKey  optional extra dimension (e.g. user id for Iron Advisor)
 *                  so two advisors on the same page don't share a channel
 */
export function useDashboardRealtime(
  role: IronRoleKey,
  queryKey: readonly unknown[],
  scopeKey?: string | null,
): void {
  const qc = useQueryClient();
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tables = tablesForIronRole(role);
    if (tables.length === 0) return;

    let disposed = false;
    let debounceHandle: number | null = null;

    const channelName = channelNameForRole(role, scopeKey ?? null);
    const channel = supabase.channel(channelName);

    const scheduleInvalidate = () => {
      if (disposed) return;
      if (debounceHandle !== null) window.clearTimeout(debounceHandle);
      debounceHandle = window.setTimeout(() => {
        debounceHandle = null;
        if (disposed) return;
        qc.invalidateQueries({ queryKey: queryKeyRef.current as unknown[] });
      }, 250);
    };

    for (const table of tables) {
      // supabase-js v2 typings for `on` are untyped in a non-schema-generic
      // context; cast to unknown to keep the call site readable.
      (channel as unknown as {
        on: (
          event: "postgres_changes",
          filter: { event: "*"; schema: string; table: string },
          cb: () => void,
        ) => unknown;
      }).on("postgres_changes", { event: "*", schema: "public", table }, scheduleInvalidate);
    }

    let subscribed = false;
    try {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") subscribed = true;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[useDashboardRealtime] channel ${channelName} status=${status}`);
        }
      });
    } catch (err) {
      console.warn(`[useDashboardRealtime] subscribe threw for ${channelName}:`, err);
    }

    return () => {
      disposed = true;
      if (debounceHandle !== null) window.clearTimeout(debounceHandle);
      try {
        if (subscribed) {
          void supabase.removeChannel(channel);
        } else {
          void channel.unsubscribe();
        }
      } catch {
        // Ignore teardown errors — the page is unmounting anyway.
      }
    };
  }, [role, scopeKey, qc]);
}
