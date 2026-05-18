import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface RecentCapture {
  id: string;
  created_at: string;
  duration_seconds: number | null;
  transcript: string | null;
  sync_status: string;
  sentiment: string | null;
}

const FETCH_LIMIT = 5;

async function fetchRecentCaptures(): Promise<RecentCapture[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("voice_captures")
    .select(
      "id, created_at, duration_seconds, transcript, sync_status, sentiment",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(FETCH_LIMIT);

  if (error) throw error;
  return (data ?? []) as RecentCapture[];
}

export function useRecentCaptures() {
  return useQuery({
    queryKey: ["sales", "recent-captures"],
    queryFn: fetchRecentCaptures,
    staleTime: 30 * 1000,
  });
}
