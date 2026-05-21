import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  approveDecisionTriage,
  listDecisionTriageQueue,
  type TriageDecisionRow,
} from "../lib/triage-api";

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = value.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function DecisionsTriagePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queueQuery = useQuery({
    queryKey: ["qep-decisions-triage-queue"],
    queryFn: () => listDecisionTriageQueue(200),
    staleTime: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: (decisionId: string) => approveDecisionTriage({ decisionId, approvedBy: "brian" }),
    onSuccess: (_, decisionId) => {
      queryClient.setQueryData<TriageDecisionRow[] | undefined>(
        ["qep-decisions-triage-queue"],
        (current) =>
          current?.map((row) =>
            row.id === decisionId
              ? {
                  ...row,
                  aiPrepPacket: {
                    ...row.aiPrepPacket,
                    brian_triage_approved_at: new Date().toISOString(),
                    brian_triage_approved_by: "brian",
                  },
                }
              : row,
          ) ?? current,
      );
      toast({ title: "Triage approved", description: "Decision kept open and marked for owner review queue." });
    },
    onError: (error) => {
      toast({
        title: "Approval failed",
        description: errorMessage(error, "Could not record Brian triage approval."),
        variant: "destructive",
      });
    },
  });

  const rows = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Brian Triage Queue
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One-screen AI triage approvals for open, escalated, and shadow-ship decisions.
        </p>
      </div>

      {queueQuery.isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading triage queue…
        </div>
      ) : queueQuery.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Could not load triage queue: {errorMessage(queueQuery.error, "Unknown error")}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm font-medium text-foreground">No triage items right now.</p>
          <p className="mt-1 text-xs text-muted-foreground">New auto-triage rows will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const isApproved =
              typeof row.aiPrepPacket.brian_triage_approved_at === "string" &&
              row.aiPrepPacket.brian_triage_approved_at.trim().length > 0;

            return (
              <article key={row.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{row.code}</p>
                    <p className="mt-1 text-sm text-foreground">{row.questionPlain}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{row.status}</Badge>
                    <Badge variant="outline">lane: {row.lane}</Badge>
                    <Badge variant="outline">owner: {row.ownerRole}</Badge>
                    {isApproved ? <Badge className="bg-emerald-600/15 text-emerald-700">approved</Badge> : null}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Recommended option" value={row.recommendedOption ?? "—"} />
                  <Field label="Reversal cost" value={row.reversalCost ?? "—"} />
                  <Field label="Gated tasks" value={`${row.gatedTaskCount}`} />
                  <Field label="Gated streams" value={row.gatedStreams.join(", ") || "—"} />
                  <Field label="Age (days)" value={row.ageDays.toFixed(1)} />
                  <Field
                    label="Citations"
                    value={
                      row.citations.length > 0
                        ? row.citations
                            .slice(0, 3)
                            .map((citation) => citation.ref || citation.source)
                            .filter(Boolean)
                            .join(" • ") || "present"
                        : "—"
                    }
                  />
                </div>

                {row.recommendedRationale ? (
                  <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Rationale:</span> {row.recommendedRationale}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={approveMutation.isPending || isApproved}
                    onClick={() => approveMutation.mutate(row.id)}
                  >
                    {approveMutation.isPending ? "Approving…" : isApproved ? "Approved" : "Approve triage"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Approval stamps ai_prep_packet metadata only. Owner answer still required.
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}
