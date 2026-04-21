/**
 * /brief — Dashboard.
 *
 * Personalized AI morning brief + 4 status tiles + live activity feed.
 * Tiles pull counts from hub_build_items / hub_feedback. The brief is read
 * from morning_briefings (today's row, written by stakeholder-morning-brief
 * cron); a "Refresh brief" button invokes the cron fn to regenerate.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Inbox,
  Loader2,
  MessageSquareMore,
  RefreshCw,
  Rocket,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  loadDashboardBundle,
  refreshStakeholderBrief,
  type HubChangelogRow,
} from "../lib/brief-api";

type Subrole = "owner" | "primary_contact" | "technical" | "admin";

interface BriefDashboardPageProps {
  userId: string;
  stakeholderName: string | null;
  subrole: Subrole | null;
}

const SUBROLE_FRAMING: Record<Subrole, string> = {
  owner: "Executive view — revenue, risk, roadmap.",
  primary_contact: "UX + flow view — what shipped, what's stuck, what to try today.",
  technical: "Integration view — schemas, APIs, webhooks.",
  admin: "Operations view — feedback queue, daily digest, shipped tally.",
};

const CHANGE_TONE: Record<HubChangelogRow["change_type"], string> = {
  shipped: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  fixed: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  updated: "bg-muted text-muted-foreground",
  started: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export function BriefDashboardPage({
  userId,
  stakeholderName,
  subrole,
}: BriefDashboardPageProps) {
  const firstName = stakeholderName?.split(/\s+/)[0] ?? "there";
  const framing = subrole ? SUBROLE_FRAMING[subrole] : "QEP OS Build Hub preview.";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const bundleQuery = useQuery({
    queryKey: ["brief-dashboard", userId],
    queryFn: () => loadDashboardBundle(userId),
    staleTime: 30_000,
  });

  const refreshMutation = useMutation({
    mutationFn: refreshStakeholderBrief,
    onSuccess: () => {
      toast({
        title: "Brief refreshed",
        description: "Your morning brief was regenerated from the latest activity.",
      });
      queryClient.invalidateQueries({ queryKey: ["brief-dashboard", userId] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't refresh",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const tiles = bundleQuery.data?.tiles;
  const briefing = bundleQuery.data?.briefing ?? null;
  const feed = useMemo(() => bundleQuery.data?.feed ?? [], [bundleQuery.data?.feed]);

  const handleManualRefresh = useCallback(() => {
    bundleQuery.refetch();
  }, [bundleQuery]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <Sparkles className="h-4 w-4" aria-hidden />
            QEP OS · Stakeholder Build Hub
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Good morning, {firstName}.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{framing}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleManualRefresh}
          disabled={bundleQuery.isFetching}
        >
          {bundleQuery.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* ── Briefing card ─────────────────────────────────────── */}
      <section className="mt-8 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Today's brief</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            {refreshMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Regenerating…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Regenerate
              </>
            )}
          </Button>
        </div>
        <div className="mt-3 text-sm leading-relaxed text-foreground">
          {bundleQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your brief…
            </div>
          ) : briefing?.content ? (
            <p className="whitespace-pre-wrap">{briefing.content}</p>
          ) : (
            <p className="text-muted-foreground">
              Your brief for today hasn't been generated yet. Tap Regenerate to
              synthesize one from the last 24 hours of activity.
            </p>
          )}
        </div>
        {briefing?.created_at && (
          <p className="mt-3 text-xs text-muted-foreground">
            Generated {safeRelativeTime(briefing.created_at)} · model{" "}
            {extractModelName(briefing.data)}
          </p>
        )}
      </section>

      {/* ── Tiles ─────────────────────────────────────────────── */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          icon={<Rocket className="h-4 w-4" />}
          label="Shipped this week"
          value={tiles?.shipped_this_week}
          tone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          loading={bundleQuery.isLoading}
        />
        <Tile
          icon={<Wrench className="h-4 w-4" />}
          label="In progress"
          value={tiles?.in_progress}
          tone="bg-sky-500/10 text-sky-700 dark:text-sky-300"
          loading={bundleQuery.isLoading}
        />
        <Tile
          icon={<MessageSquareMore className="h-4 w-4" />}
          label="Needs your input"
          value={tiles?.needs_your_input}
          tone="bg-amber-500/10 text-amber-700 dark:text-amber-300"
          loading={bundleQuery.isLoading}
        />
        <Tile
          icon={<Inbox className="h-4 w-4" />}
          label="Open feedback"
          value={tiles?.open_feedback}
          tone="bg-violet-500/10 text-violet-700 dark:text-violet-300"
          loading={bundleQuery.isLoading}
        />
      </section>

      {/* ── Activity feed ─────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recent activity</h2>
          <span className="text-xs text-muted-foreground">last 12 events</span>
        </div>
        {bundleQuery.isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
          </div>
        ) : bundleQuery.error ? (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Couldn't load activity: {String((bundleQuery.error as Error).message)}
          </div>
        ) : feed.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No recent activity yet. As soon as a commit lands on main the changelog
            cron will log it here.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {feed.map((row) => (
              <li key={row.id} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${CHANGE_TONE[row.change_type] ?? "bg-muted text-muted-foreground"}`}
                >
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  {row.change_type}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground">{row.summary}</p>
                  {row.details && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.details}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {safeRelativeTime(row.created_at)}
                    {row.demo_url && (
                      <>
                        {" · "}
                        <a
                          className="text-sky-600 hover:underline dark:text-sky-400"
                          href={row.demo_url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          view
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile(props: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  tone: string;
  loading: boolean;
}) {
  return (
    <div className={`rounded-xl border border-border p-3 shadow-sm ${props.tone}`}>
      <div className="flex items-center gap-2 text-xs font-medium opacity-80">
        {props.icon}
        {props.label}
      </div>
      <div className="mt-2 text-2xl font-semibold">
        {props.loading ? <Loader2 className="h-5 w-5 animate-spin opacity-70" /> : (props.value ?? 0)}
      </div>
    </div>
  );
}

/**
 * Defensive extractor for `briefing.data.model`. The `data` column is jsonb
 * on the server; shape drift (old rows, renamed model field, malformed insert)
 * shouldn't crash the dashboard. Falls back to the default Sonnet slug.
 */
function extractModelName(data: unknown): string {
  if (data && typeof data === "object" && "model" in data) {
    const model = (data as { model?: unknown }).model;
    if (typeof model === "string" && model.length > 0) return model;
  }
  return "claude-sonnet-4-6";
}

function safeRelativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diffMs)) return iso;
    const absSec = Math.max(1, Math.floor(Math.abs(diffMs) / 1000));
    if (absSec < 60) return `${absSec}s ago`;
    const min = Math.floor(absSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    const wk = Math.floor(day / 7);
    if (wk < 5) return `${wk}w ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
