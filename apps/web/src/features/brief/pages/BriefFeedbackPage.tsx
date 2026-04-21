/**
 * /brief/feedback — Stakeholder Build Hub feedback inbox.
 *
 * Two tabs: Mine (caller's rows) / All (everything the RLS policy allows).
 * Day 3-4 scope: rendering + scope toggle + manual refresh. The
 * "Draft Fix" + "Merge" admin buttons land in Day 5-6.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  draftFeedbackFix,
  listHubFeedback,
  mergeFeedbackPr,
  type FeedbackPriority,
  type FeedbackStatus,
  type HubFeedbackRow,
} from "../lib/brief-api";
import { FeedbackTimeline } from "../components/FeedbackTimeline";

interface BriefFeedbackPageProps {
  userId: string;
  canAdminister: boolean;
}

const STATUS_TONE: Record<FeedbackStatus, string> = {
  open: "bg-muted text-muted-foreground",
  triaged: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  drafting: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  awaiting_merge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  shipped: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  wont_fix: "bg-muted text-muted-foreground line-through",
};

const PRIORITY_TONE: Record<FeedbackPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  high: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export function BriefFeedbackPage({ userId, canAdminister }: BriefFeedbackPageProps) {
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const feedbackQuery = useQuery({
    queryKey: ["hub-feedback", scope, userId],
    queryFn: () => listHubFeedback({ scope, userId, limit: 100 }),
    staleTime: 15_000,
  });

  const rows = useMemo(() => feedbackQuery.data ?? [], [feedbackQuery.data]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Feedback inbox
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you've sent, auto-triaged by Claude. Admins see all
            workspace feedback.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => feedbackQuery.refetch()}
          disabled={feedbackQuery.isFetching}
        >
          {feedbackQuery.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      <Tabs value={scope} onValueChange={(v) => setScope(v as "mine" | "all")} className="mt-6">
        <TabsList>
          <TabsTrigger value="mine">Mine</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <TabsContent value={scope} className="mt-4">
          {feedbackQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading feedback…
            </div>
          ) : feedbackQuery.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
              Couldn't load feedback: {String((feedbackQuery.error as Error).message)}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState scope={scope} />
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <FeedbackCard key={row.id} row={row} canAdminister={canAdminister} />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ scope }: { scope: "mine" | "all" }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
      <p className="text-sm font-medium text-foreground">
        {scope === "mine" ? "You haven't sent feedback yet." : "No feedback in this workspace yet."}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Use the "Got feedback?" button anywhere in the Build Hub.
      </p>
    </div>
  );
}

function FeedbackCard({ row, canAdminister }: { row: HubFeedbackRow; canAdminister: boolean }) {
  const created = safeRelativeTime(row.created_at);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const draftMutation = useMutation({
    mutationFn: () => draftFeedbackFix(row.id),
    onSuccess: (result) => {
      const pr = result.pr_url ? `PR opened: ${result.pr_url}` : "Draft proposal saved";
      toast({
        title: "Draft ready",
        description: pr,
      });
      queryClient.invalidateQueries({ queryKey: ["hub-feedback"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't draft",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: () => mergeFeedbackPr(row.id),
    onSuccess: (result) => {
      toast({
        title: "Merged",
        description: `${result.merge_method} · ${result.merge_sha.slice(0, 8)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["hub-feedback"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Merge failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <li className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={STATUS_TONE[row.status] ?? "bg-muted text-muted-foreground"}>
            {row.status.replace("_", " ")}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {row.feedback_type}
          </Badge>
          <Badge className={PRIORITY_TONE[row.priority]}>{row.priority}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">{created}</span>
      </div>

      {row.ai_summary && (
        <p className="mt-3 text-sm font-medium text-foreground">{row.ai_summary}</p>
      )}
      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{row.body}</p>

      {row.ai_suggested_action && (
        <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Suggested:</span>{" "}
          {row.ai_suggested_action}
        </div>
      )}

      {row.claude_pr_url && (
        <div className="mt-3 text-xs">
          <a
            href={row.claude_pr_url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-sky-600 hover:underline dark:text-sky-400"
          >
            View draft PR →
          </a>
        </div>
      )}

      {/* v2.1 submitter loop-back — event ledger for this row. Compact view
          keeps the inbox scannable; full list is visible when the card is
          open (Build Hub v3 will add a disclosure). */}
      <FeedbackTimeline feedbackId={row.id} compact />

      {canAdminister && (row.status === "triaged" || row.status === "drafting") && (
        <div className="mt-4 flex gap-2 border-t border-border pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => draftMutation.mutate()}
            disabled={draftMutation.isPending}
          >
            {draftMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Drafting…
              </>
            ) : (
              "Draft fix"
            )}
          </Button>
        </div>
      )}

      {canAdminister && row.status === "awaiting_merge" && row.claude_pr_url && (
        <div className="mt-4 flex gap-2 border-t border-border pt-3">
          <Button
            size="sm"
            onClick={() => mergeMutation.mutate()}
            disabled={mergeMutation.isPending}
          >
            {mergeMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Merging…
              </>
            ) : (
              "Merge PR"
            )}
          </Button>
        </div>
      )}
    </li>
  );
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
