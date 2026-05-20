import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isMissingSummaryBulletsColumnError } from "@/lib/voice-summary-column";

export interface RecentCapture {
  id: string;
  created_at: string;
  duration_seconds: number | null;
  transcript: string | null;
  summary_bullets: string[] | null;
  sync_status: string;
  sentiment: string | null;
}

const FETCH_LIMIT = 5;

async function fetchRecentCaptures(): Promise<RecentCapture[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const selectBase = "id, created_at, duration_seconds, transcript, sync_status, sentiment";
  const buildQuery = (selectColumns: string) => supabase
    .from("voice_captures")
    .select(selectColumns)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(FETCH_LIMIT);

  let { data, error } = await buildQuery(`${selectBase}, summary_bullets`);
  if (error && isMissingSummaryBulletsColumnError(error)) {
    console.warn("useRecentCaptures: summary_bullets unavailable; loading without summaries");
    const fallback = await buildQuery(selectBase);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return (data ?? []) as unknown as RecentCapture[];
}

export function useRecentCaptures() {
  return useQuery({
    queryKey: ["sales", "recent-captures"],
    queryFn: fetchRecentCaptures,
    staleTime: 30 * 1000,
  });
}
