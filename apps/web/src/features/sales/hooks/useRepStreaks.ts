/**
 * useRepStreaks — ambient activity-streak signal for the Today screen.
 *
 * Reads from the public.v_rep_streaks view (migration 584), filtered to the
 * authenticated user. The view returns zero rows when the rep has no
 * 90-day history at all — that's a valid "Day 1" state, not an error.
 *
 * Zero-blocking: query failures or unauthenticated state degrade to a
 * silent no-streak shape so the UI can render its empty-state chip.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const QUERY_KEY = ["sales", "rep-streaks"] as const;
const STALE_MS = 5 * 60 * 1000;

export interface RepStreaks {
  visitsToday: number;
  quotesToday: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveAt: string | null;
  isLoading: boolean;
}

interface RawStreakRow {
  rep_id: string;
  visits_today: number | null;
  quotes_today: number | null;
  current_streak_days: number | null;
  longest_streak_days: number | null;
  last_active_at: string | null;
}

async function fetchRepStreak(): Promise<Omit<RepStreaks, "isLoading">> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      visitsToday: 0,
      quotesToday: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveAt: null,
    };
  }

  const { data, error } = await supabase
    .from("v_rep_streaks")
    .select(
      "rep_id, visits_today, quotes_today, current_streak_days, longest_streak_days, last_active_at",
    )
    .eq("rep_id", user.id)
    .maybeSingle();

  if (error) throw error;

  const row = (data ?? null) as RawStreakRow | null;
  return {
    visitsToday: row?.visits_today ?? 0,
    quotesToday: row?.quotes_today ?? 0,
    currentStreak: row?.current_streak_days ?? 0,
    longestStreak: row?.longest_streak_days ?? 0,
    lastActiveAt: row?.last_active_at ?? null,
  };
}

export function useRepStreaks(): RepStreaks {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchRepStreak,
    staleTime: STALE_MS,
    retry: 1,
  });

  const data = query.data ?? {
    visitsToday: 0,
    quotesToday: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveAt: null,
  };

  return {
    ...data,
    isLoading: query.isLoading,
  };
}
