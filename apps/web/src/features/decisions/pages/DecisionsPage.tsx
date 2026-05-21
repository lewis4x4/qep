import { useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  applyOwnerDecisionAction,
  listDecisionTriageQueue,
  type OwnerDecisionAction,
  type TriageCitation,
  type TriageDecisionRow,
} from "../lib/triage-api";

const OWNER_DECISIONS_QUERY_KEY = ["qep-decisions-owner-queue"] as const;

interface DecisionsPageProps {
  actorName?: string | null;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = value.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readableAction(action: OwnerDecisionAction): string {
  if (action === "need_info") return "Need info";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export function DecisionsPage({ actorName }: DecisionsPageProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const queueQuery = useQuery({
    queryKey: OWNER_DECISIONS_QUERY_KEY,
    queryFn: () => listDecisionTriageQueue(200),
    staleTime: 30_000,
  });

  const rows = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const activeDecision = rows[activeIndex] ?? rows[0] ?? null;
  const activePosition = activeDecision ? rows.findIndex((row) => row.id === activeDecision.id) : -1;

  useEffect(() => {
    if (activeIndex > Math.max(rows.length - 1, 0)) {
      setActiveIndex(Math.max(rows.length - 1, 0));
    }
  }, [activeIndex, rows.length]);

  const actionMutation = useMutation({
    mutationFn: ({ decisionId, action }: { decisionId: string; action: OwnerDecisionAction }) =>
      applyOwnerDecisionAction({ decisionId, action, actorName }),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<TriageDecisionRow[] | undefined>(OWNER_DECISIONS_QUERY_KEY, (current) => {
        if (!current) return current;
        if (result.status === "answered") {
          return current.filter((row) => row.id !== variables.decisionId);
        }
        const nextStatus: TriageDecisionRow["status"] = result.status === "escalated" ? "escalated" : "open";
        return current.map((row) =>
          row.id === variables.decisionId
            ? {
                ...row,
                status: nextStatus,
                aiPrepPacket: {
                  ...row.aiPrepPacket,
                  owner_web_last_action: {
                    action: variables.action,
                    actor: result.actor,
                    at: result.actionAt,
                    surface: "/decisions",
                  },
                },
              }
            : row,
        );
      });
      void queryClient.invalidateQueries({ queryKey: OWNER_DECISIONS_QUERY_KEY });
      toast({
        title: `${readableAction(variables.action)} recorded`,
        description:
          result.status === "answered"
            ? "The decision was answered and gated work can continue."
            : "The decision remains in the owner queue with an owner-web stamp.",
      });
    },
    onError: (error) => {
      toast({
        title: "Decision action failed",
        description: errorMessage(error, "Could not save the owner decision action."),
        variant: "destructive",
      });
    },
  });

  function goPrevious() {
    setActiveIndex((current) => Math.max(current - 1, 0));
  }

  function goNext() {
    setActiveIndex((current) => Math.min(current + 1, Math.max(rows.length - 1, 0)));
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;
    const endX = event.changedTouches[0]?.clientX ?? startX;
    const delta = endX - startX;
    if (Math.abs(delta) < 50) return;
    if (delta < 0) goNext();
    else goPrevious();
  }

  function act(decisionId: string, action: OwnerDecisionAction) {
    actionMutation.mutate({ decisionId, action });
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] px-3 py-5 text-slate-950 sm:px-5 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="rounded-3xl border border-stone-200 bg-white/80 p-5 shadow-sm backdrop-blur sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Quiet Operator</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                Decisions
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                A calm fallback queue for owners to review every open decision, one clear choice at a time.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-stone-600">
              <Badge variant="outline" className="border-stone-300 bg-white">
                {rows.length} open
              </Badge>
              <Badge variant="outline" className="border-stone-300 bg-white">
                owner-safe actions
              </Badge>
            </div>
          </div>
        </header>

        {queueQuery.isLoading ? (
          <StateCard>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading owner decisions…
          </StateCard>
        ) : queueQuery.error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Could not load decisions: {errorMessage(queueQuery.error, "Unknown error")}
          </div>
        ) : rows.length === 0 ? (
          <StateCard>
            <div>
              <p className="font-medium text-slate-950">No open decisions right now.</p>
              <p className="mt-1 text-xs text-stone-500">When a decision blocks QEP work, it will land here.</p>
            </div>
          </StateCard>
        ) : (
          <>
            <section className="md:hidden" aria-label="Mobile decision browser">
              <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} className="touch-pan-y">
                {activeDecision ? (
                  <DecisionCard
                    decision={activeDecision}
                    index={activePosition + 1}
                    total={rows.length}
                    onAction={act}
                    isBusy={actionMutation.isPending}
                    mobile
                  />
                ) : null}
              </div>
              <div className="sticky bottom-3 mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-stone-200 bg-white/90 p-2 shadow-lg backdrop-blur">
                <Button variant="outline" onClick={goPrevious} disabled={activeIndex === 0 || actionMutation.isPending}>
                  Previous
                </Button>
                <Button variant="outline" onClick={goNext} disabled={activeIndex >= rows.length - 1 || actionMutation.isPending}>
                  Next
                </Button>
              </div>
              <p className="mt-2 text-center text-xs text-stone-500">Swipe left or right to move through the queue.</p>
            </section>

            <section className="hidden gap-5 md:grid md:grid-cols-[340px_minmax(0,1fr)]" aria-label="Desktop decision browser">
              <aside className="rounded-3xl border border-stone-200 bg-white/80 p-3 shadow-sm">
                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Queue</p>
                <div className="space-y-2">
                  {rows.map((row, index) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        activeDecision?.id === row.id
                          ? "border-slate-900 bg-slate-950 text-white"
                          : "border-stone-200 bg-white text-slate-950 hover:border-stone-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{row.code}</span>
                        <span className="text-[11px] uppercase tracking-wide opacity-70">{row.lane}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 opacity-80">{row.questionPlain}</p>
                    </button>
                  ))}
                </div>
              </aside>

              <main>
                {activeDecision ? (
                  <DecisionCard
                    decision={activeDecision}
                    index={activePosition + 1}
                    total={rows.length}
                    onAction={act}
                    isBusy={actionMutation.isPending}
                  />
                ) : null}
              </main>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function DecisionCard({
  decision,
  index,
  total,
  onAction,
  isBusy,
  mobile = false,
}: {
  decision: TriageDecisionRow;
  index: number;
  total: number;
  onAction: (decisionId: string, action: OwnerDecisionAction) => void;
  isBusy: boolean;
  mobile?: boolean;
}) {
  const voiceMemo = asRecord(decision.aiPrepPacket.voice_memo_candidate);
  const hasVoiceMemo = Object.keys(voiceMemo).length > 0;
  const canApprove = Boolean(decision.recommendedOption?.trim());

  return (
    <article className={`rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6 ${mobile ? "min-h-[calc(100svh-14rem)]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            {index} of {total}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{decision.code}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-stone-300">{decision.status}</Badge>
          <Badge variant="outline" className="border-stone-300">{decision.lane}</Badge>
          <Badge variant="outline" className="border-stone-300">owner: {decision.ownerRole}</Badge>
        </div>
      </div>

      <section className="mt-6 rounded-3xl bg-stone-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Question</p>
        <p className="mt-3 text-lg leading-8 text-slate-950">{decision.questionPlain}</p>
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="space-y-4">
          <QuietBlock title="Recommendation">
            <p className="text-base font-medium text-slate-950">{decision.recommendedOption ?? "No recommendation recorded"}</p>
            {decision.recommendedRationale ? (
              <p className="mt-3 text-sm leading-6 text-stone-600">{decision.recommendedRationale}</p>
            ) : null}
          </QuietBlock>

          <QuietBlock title="Gated task impact">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Tasks" value={`${decision.gatedTaskCount}`} />
              <Metric label="Streams" value={decision.gatedStreams.join(", ") || "—"} />
              <Metric label="Reversal cost" value={decision.reversalCost ?? "—"} />
            </div>
          </QuietBlock>

          {hasVoiceMemo ? (
            <QuietBlock title="Voice memo candidate">
              <div className="space-y-2 text-sm leading-6 text-stone-700">
                <p><span className="font-medium text-slate-950">Action:</span> {String(voiceMemo.action ?? "—")}</p>
                {typeof voiceMemo.rationale === "string" ? (
                  <p><span className="font-medium text-slate-950">Rationale:</span> {voiceMemo.rationale}</p>
                ) : null}
                {typeof voiceMemo.transcript === "string" ? (
                  <p className="rounded-2xl bg-white p-3 text-stone-600">{voiceMemo.transcript}</p>
                ) : null}
              </div>
            </QuietBlock>
          ) : null}
        </div>

        <div className="space-y-4">
          <QuietBlock title="Citations">
            {decision.citations.length > 0 ? (
              <div className="space-y-3">
                {decision.citations.map((citation, citationIndex) => (
                  <CitationView key={`${citation.source}-${citation.ref}-${citationIndex}`} citation={citation} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-500">No citations attached.</p>
            )}
          </QuietBlock>

          <QuietBlock title="Owner action">
            <div className="grid gap-2">
              <Button
                onClick={() => onAction(decision.id, "approve")}
                disabled={isBusy || !canApprove}
                className="justify-center"
                title={canApprove ? "Approve the recommended option" : "A recommendation is required before approval"}
              >
                {isBusy ? "Saving…" : canApprove ? "Approve" : "No recommendation to approve"}
              </Button>
              <Button variant="outline" onClick={() => onAction(decision.id, "block")} disabled={isBusy} className="justify-center border-red-200 text-red-700 hover:bg-red-50">
                Block
              </Button>
              <Button variant="outline" onClick={() => onAction(decision.id, "need_info")} disabled={isBusy} className="justify-center border-blue-200 text-blue-700 hover:bg-blue-50">
                Need info
              </Button>
            </div>
            <p className="mt-3 text-xs leading-5 text-stone-500">
              Approve answers the decision. Block escalates it. Need info keeps it open. All actions stamp owner-web metadata.
            </p>
          </QuietBlock>
        </div>
      </div>
    </article>
  );
}

function QuietBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
    </div>
  );
}

function CitationView({ citation }: { citation: TriageCitation }) {
  return (
    <div className="rounded-2xl bg-stone-50 p-3 text-sm leading-6">
      <p className="font-medium text-slate-950">{citation.ref || citation.source || "Citation"}</p>
      {citation.source ? <p className="text-xs uppercase tracking-wide text-stone-500">{citation.source}</p> : null}
      {citation.excerpt ? <p className="mt-2 text-stone-600">{citation.excerpt}</p> : null}
    </div>
  );
}

function StateCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-stone-200 bg-white/80 p-6 text-sm text-stone-600 shadow-sm">
      {children}
    </div>
  );
}
