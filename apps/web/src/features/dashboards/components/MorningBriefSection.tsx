/**
 * MorningBriefSection — self-fetching daily AI briefing card.
 *
 * Drop-in section that lives at the top of every Iron dashboard. Reads the
 * caller's row from public.morning_briefings (RLS scopes by user_id) and
 * renders the markdown content collapsibly. Has a "Generate now" path so a
 * user is never blocked on the cron — they can pull a fresh brief on demand.
 *
 * Collapsed state is persisted via the same localStorage key the legacy
 * SalesCommandCenter brief block uses, so users who collapsed it there still
 * see it collapsed here.
 */
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Sparkles, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const BRIEFING_COLLAPSED_KEY = "qep-briefing-collapsed";
const BRIEFING_QUERY_KEY = ["dashboard", "morning-brief", "today"] as const;

type Briefing = {
  id: string;
  content: string;
  briefing_date: string;
  created_at: string;
} | null;

function isBriefingCollapsedToday(): boolean {
  try {
    const stored = localStorage.getItem(BRIEFING_COLLAPSED_KEY);
    if (!stored) return false;
    const today = new Date().toISOString().split("T")[0];
    return stored === today;
  } catch {
    return false;
  }
}

function setBriefingCollapsedFlag(collapsed: boolean): void {
  try {
    if (collapsed) {
      localStorage.setItem(
        BRIEFING_COLLAPSED_KEY,
        new Date().toISOString().split("T")[0],
      );
    } else {
      localStorage.removeItem(BRIEFING_COLLAPSED_KEY);
    }
  } catch {
    // localStorage unavailable — ignore
  }
}

async function fetchTodayBrief(): Promise<Briefing> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("morning_briefings")
    .select("id, content, briefing_date, created_at")
    .eq("user_id", user.id)
    .eq("briefing_date", today)
    .maybeSingle();
  if (error) throw error;
  return (data as Briefing) ?? null;
}

async function generateBriefForCurrentUser(regenerate: boolean): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/morning-briefing`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ regenerate }),
    },
  );
  if (!res.ok) {
    throw new Error(`morning-briefing returned ${res.status}`);
  }
}

export function MorningBriefSection() {
  const queryClient = useQueryClient();
  const { data: briefing, isLoading } = useQuery({
    queryKey: BRIEFING_QUERY_KEY,
    queryFn: fetchTodayBrief,
    staleTime: 60_000,
  });

  const [collapsed, setCollapsed] = useState(() => isBriefingCollapsedToday());

  const mutation = useMutation({
    mutationFn: (regenerate: boolean) => generateBriefForCurrentUser(regenerate),
    onSuccess: () => {
      setCollapsed(false);
      setBriefingCollapsedFlag(false);
      queryClient.invalidateQueries({ queryKey: BRIEFING_QUERY_KEY });
    },
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      setBriefingCollapsedFlag(next);
      return next;
    });
  }, []);

  if (isLoading) {
    return <Card className="h-24 animate-pulse" />;
  }

  return (
    <section aria-label="Morning briefing">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
          AI Morning Briefing
        </h2>
        {briefing && (
          <button
            onClick={toggleCollapsed}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-qep-orange"
          >
            {collapsed ? "Show briefing" : "Minimize"}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                !collapsed && "rotate-180",
              )}
            />
          </button>
        )}
      </div>

      {briefing ? (
        collapsed ? (
          <button onClick={toggleCollapsed} className="w-full text-left">
            <Card className="border-border bg-gradient-to-br from-white/[0.04] to-white/[0.01] px-5 py-3 transition-all duration-150 hover:border-white/20 hover:shadow-md">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-qep-orange/10">
                  <Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Today's briefing ready</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(briefing.briefing_date + "T00:00:00").toLocaleDateString(
                      "en-US",
                      { weekday: "long", month: "long", day: "numeric" },
                    )}{" "}
                    — tap to expand
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </div>
            </Card>
          </button>
        ) : (
          <Card className="border-border bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-5">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />
              <span className="text-xs font-medium text-qep-orange">
                {new Date(briefing.briefing_date + "T00:00:00").toLocaleDateString(
                  "en-US",
                  { weekday: "long", month: "long", day: "numeric" },
                )}
              </span>
            </div>
            <div className="prose prose-sm prose-invert max-w-none text-foreground/90 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_li]:text-sm [&_ol]:pl-4 [&_p]:text-sm [&_strong]:text-foreground [&_ul]:pl-4">
              <div className="whitespace-pre-line">{briefing.content}</div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => mutation.mutate(true)}
                disabled={mutation.isPending}
                className="text-xs text-muted-foreground hover:text-qep-orange"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Refreshing…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-3 w-3" />
                    Refresh briefing
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleCollapsed}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Minimize for today
              </Button>
            </div>
          </Card>
        )
      ) : (
        <Card className="border-dashed border-border bg-card p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-qep-orange/10">
              <Sparkles className="h-6 w-6 text-qep-orange" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Your AI briefing is ready to generate
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Get a personalized summary of your pipeline, overdue follow-ups, and
                recommended priorities for today.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => mutation.mutate(false)}
              disabled={mutation.isPending}
              className="mt-1"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate briefing
                </>
              )}
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}
