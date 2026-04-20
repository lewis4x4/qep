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

interface BriefFeedbackPageProps {
  userId: string;
  canAdminister: boolean;
}

const STATUS_TONE: Record<FeedbackStatus, string> = {
  open: "bg-slate-100 text-slate-700",
  triaged: "bg-sky-100 text-sky-800",
  drafting: "bg-amber-100 text-amber-900",
  awaiting_merge: "bg-violet-100 text-violet-900",
  shipped: "bg-emerald-100 text-emerald-900",
  wont_fix: "bg-slate-200 text-slate-600 line-through",
};

const PRIORITY_TONE: Record<FeedbackPriority, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-900",
  high: "bg-rose-100 text-rose-900",
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
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Feedback inbox
          </h1>
          <p className="mt-1 text-sm text-slate-600">
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
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading feedback…
            </div>
          ) : feedbackQuery.error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
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
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-sm font-medium text-slate-700">
        {scope === "mine" ? "You haven't sent feedback yet." : "No feedback in this workspace yet."}
      </p>
      <p className="mt-1 text-xs text-slate-500">
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
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={STATUS_TONE[row.status] ?? "bg-slate-100 text-slate-700"}>
            {row.status.replace("_", " ")}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {row.feedback_type}
          </Badge>
          <Badge className={PRIORITY_TONE[row.priority]}>{row.priority}</Badge>
        </div>
        <span className="text-xs text-slate-500">{created}</span>
      </div>

      {row.ai_summary && (
        <p className="mt-3 text-sm font-medium text-slate-900">{row.ai_summary}</p>
      )}
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{row.body}</p>

      {row.ai_suggested_action && (
        <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Suggested:</span>{" "}
          {row.ai_suggested_action}
        </div>
      )}

      {row.claude_pr_url && (
        <div className="mt-3 text-xs">
          <a
            href={row.claude_pr_url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-sky-700 hover:underline"
          >
            View draft PR →
          </a>
        </div>
      )}

      {canAdminister && (row.status === "triaged" || row.status === "drafting") && (
        <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
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
        <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
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
