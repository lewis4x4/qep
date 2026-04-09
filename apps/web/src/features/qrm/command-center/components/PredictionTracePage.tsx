/**
 * PredictionTracePage — Phase 0 P0.8 trace viewer.
 *
 * Full-page route at `/qrm/command/trace/:predictionId` that renders the
 * step-by-step trace for a given prediction: scoring factors, rationale,
 * and any linked outcomes. Manager-gated (admin/manager/owner).
 *
 * Follows the timeline pattern from FlowRunHistoryDrawer.tsx.
 */
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Clock, Sparkles, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";

interface TraceStep {
  factor: string;
  value: number;
  weight: number;
  contribution: number;
}

interface TraceResponse {
  prediction: {
    id: string;
    trace_id: string;
    prediction_kind: string;
    score: number;
    rationale: string[];
    trace_steps: TraceStep[];
    model_source: string;
    predicted_at: string;
    outcome: string | null;
    outcome_at: string | null;
    subject_type: string;
    subject_id: string;
  };
  outcomes: Array<{
    id: string;
    outcome: string;
    observed_at: string;
    evidence: Record<string, unknown>;
    source: string;
  }>;
}

async function fetchPredictionTrace(predictionId: string): Promise<TraceResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${supabaseUrl}/functions/v1/qrm-prediction-trace?predictionId=${encodeURIComponent(predictionId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }

  return res.json();
}

function outcomeTone(outcome: string | null): "green" | "red" | "neutral" | "orange" {
  switch (outcome) {
    case "won": return "green";
    case "lost": return "red";
    case "expired": return "orange";
    default: return "neutral";
  }
}

function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "pending";
  return outcome.replace(/_/g, " ");
}

export function PredictionTracePage() {
  const { predictionId } = useParams<{ predictionId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["prediction-trace", predictionId],
    queryFn: () => fetchPredictionTrace(predictionId!),
    enabled: !!predictionId,
  });

  const pred = data?.prediction;
  const outcomes = data?.outcomes ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/qrm/command")}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-foreground">
            Prediction Trace
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            {predictionId?.slice(0, 8)}…
          </p>
        </div>
        {pred && (
          <Badge variant="outline" className="text-xs">
            {pred.model_source}
          </Badge>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading trace…
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="flex items-center gap-2 border-red-500/30 p-4 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error.message}
        </Card>
      )}

      {pred && (
        <>
          {/* Status card */}
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant={pred.outcome ? "default" : "outline"}
                  className={
                    pred.outcome === "won" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" :
                    pred.outcome === "lost" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                    pred.outcome === "expired" ? "bg-orange-500/15 text-orange-400 border-orange-500/30" :
                    ""
                  }
                >
                  {outcomeLabel(pred.outcome)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {pred.prediction_kind}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {new Date(pred.predicted_at).toLocaleString()}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Score: <strong className="text-foreground">{pred.score.toFixed(3)}</strong></span>
              <span>·</span>
              <span>{pred.subject_type}: {pred.subject_id.slice(0, 8)}…</span>
            </div>
          </Card>

          {/* Rationale */}
          {pred.rationale.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Rationale
              </p>
              <ul className="space-y-1.5">
                {pred.rationale.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-qep-orange" />
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Trace steps (scoring factors) */}
          <Card className="p-4">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Scoring factors
            </p>
            {pred.trace_steps.length === 0 ? (
              <p className="text-xs text-muted-foreground">No trace steps recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {pred.trace_steps.map((step, i) => {
                  const absContrib = Math.abs(step.contribution);
                  const barPct = Math.min(100, absContrib * 100);
                  return (
                    <div key={i} className="rounded border border-border/60 bg-muted/10 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-foreground">
                          {step.factor}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {step.contribution >= 0 ? "+" : ""}{step.contribution.toFixed(3)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1 flex-1 rounded-full bg-muted/30 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              step.contribution >= 0 ? "bg-emerald-500/60" : "bg-red-500/40"
                            }`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                          v={step.value.toFixed(2)} w={step.weight.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Outcomes */}
          {outcomes.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Outcomes
              </p>
              <div className="space-y-1.5">
                {outcomes.map((o) => (
                  <div key={o.id} className="rounded border border-border/60 bg-muted/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={
                          o.outcome === "won" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" :
                          o.outcome === "lost" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                          "bg-orange-500/15 text-orange-400 border-orange-500/30"
                        }
                      >
                        {o.outcome}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(o.observed_at).toLocaleString()} · {o.source}
                      </span>
                    </div>
                    {o.evidence && Object.keys(o.evidence).length > 0 && (
                      <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted/30 p-1 text-[9px] text-muted-foreground">
                        {JSON.stringify(o.evidence, null, 0)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
