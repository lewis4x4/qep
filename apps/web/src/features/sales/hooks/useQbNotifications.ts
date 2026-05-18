/**
 * useQbNotifications — read+mark the current user's qb_notifications.
 *
 * Surfaces both quote-approval flows that write to public.qb_notifications:
 *   - type='quote_approval_pending'   (manager-side, written by
 *     insertQuoteApprovalBellNotification when a rep submits a quote for
 *     approval)
 *   - type='quote_approval_decision'  (rep-side, written when their submitted
 *     quote is approved or rejected)
 *
 * Reads are scoped to the current authenticated user via RLS — the
 * "qb_notifications read own" policy filters server-side, so the .eq()
 * below is defense-in-depth.
 *
 * Zero-blocking: if auth is missing or the query fails (e.g., transient
 * network, RLS rejects a non-matching workspace) the hook resolves to an
 * empty list. The bell renders silently with no badge.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface QbNotification {
  id: string;
  user_id: string | null;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

const FETCH_LIMIT = 20;
const REFETCH_INTERVAL_MS = 30_000;

const QB_NOTIFICATIONS_QUERY_KEY = ["sales", "qb-notifications"] as const;

async function fetchQbNotifications(): Promise<QbNotification[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("qb_notifications")
    .select("id, user_id, type, title, body, metadata, read_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(FETCH_LIMIT);

  if (error) throw error;
  return (data ?? []) as QbNotification[];
}

async function markOneRead(id: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("qb_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) throw error;
}

async function markAllReadForUser(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("qb_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) throw error;
}

export function useQbNotifications() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QB_NOTIFICATIONS_QUERY_KEY,
    queryFn: fetchQbNotifications,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: 15_000,
    // Silent failure: render as "no notifications" if the query errors.
    retry: 1,
  });

  const markReadMutation = useMutation({
    mutationFn: markOneRead,
    // Optimistic flip — the bell badge drops instantly. If the server
    // mutation fails we restore the previous snapshot in onError so the
    // count stays truthful.
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: QB_NOTIFICATIONS_QUERY_KEY });
      const previous = queryClient.getQueryData<QbNotification[]>(QB_NOTIFICATIONS_QUERY_KEY);
      if (previous) {
        const now = new Date().toISOString();
        queryClient.setQueryData<QbNotification[]>(
          QB_NOTIFICATIONS_QUERY_KEY,
          previous.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)),
        );
      }
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QB_NOTIFICATIONS_QUERY_KEY, context.previous);
      }
      console.warn("qb-notifications: markRead failed", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QB_NOTIFICATIONS_QUERY_KEY });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllReadForUser,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: QB_NOTIFICATIONS_QUERY_KEY });
      const previous = queryClient.getQueryData<QbNotification[]>(QB_NOTIFICATIONS_QUERY_KEY);
      if (previous) {
        const now = new Date().toISOString();
        queryClient.setQueryData<QbNotification[]>(
          QB_NOTIFICATIONS_QUERY_KEY,
          previous.map((n) => (n.read_at ? n : { ...n, read_at: now })),
        );
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QB_NOTIFICATIONS_QUERY_KEY, context.previous);
      }
      console.warn("qb-notifications: markAllRead failed", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QB_NOTIFICATIONS_QUERY_KEY });
    },
  });

  const notifications: QbNotification[] = query.data ?? [];
  const unreadCount = notifications.reduce(
    (count, n) => (n.read_at ? count : count + 1),
    0,
  );

  return {
    notifications,
    unreadCount,
    markRead: (id: string) => markReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
