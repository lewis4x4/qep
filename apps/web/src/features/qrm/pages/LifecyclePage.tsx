import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Phone, FileText, ShoppingBag, Wrench, Shield, MessageSquare, AlertTriangle, RotateCcw, XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface LifecycleEvent {
  id: string;
  company_id: string;
  event_type:
    | "first_contact"
    | "first_quote"
    | "first_purchase"
    | "first_service"
    | "first_warranty_claim"
    | "nps_response"
    | "churn_risk_flag"
    | "won_back"
    | "lost";
  event_at: string;
  metadata: Record<string, unknown>;
  source_table: string | null;
}

const EVENT_META: Record<LifecycleEvent["event_type"], { label: string; icon: React.ReactNode; tone: string }> = {
  first_contact:        { label: "First contact",         icon: <Phone className="h-3 w-3" />,         tone: "text-blue-400 border-blue-500/30" },
  first_quote:          { label: "First quote",           icon: <FileText className="h-3 w-3" />,      tone: "text-violet-400 border-violet-500/30" },
  first_purchase:       { label: "First purchase",        icon: <ShoppingBag className="h-3 w-3" />,   tone: "text-emerald-400 border-emerald-500/30" },
  first_service:        { label: "First service",         icon: <Wrench className="h-3 w-3" />,        tone: "text-qep-orange border-qep-orange/30" },
  first_warranty_claim: { label: "First warranty claim",  icon: <Shield className="h-3 w-3" />,        tone: "text-amber-400 border-amber-500/30" },
  nps_response:         { label: "NPS response",          icon: <MessageSquare className="h-3 w-3" />, tone: "text-blue-400 border-blue-500/30" },
  churn_risk_flag:      { label: "Churn risk flagged",    icon: <AlertTriangle className="h-3 w-3" />, tone: "text-red-400 border-red-500/30" },
  won_back:             { label: "Won back",              icon: <RotateCcw className="h-3 w-3" />,     tone: "text-emerald-400 border-emerald-500/30" },
  lost:                 { label: "Lost",                  icon: <XCircle className="h-3 w-3" />,       tone: "text-muted-foreground border-border" },
};

export function LifecyclePage() {
  const { companyId } = useParams<{ companyId: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["lifecycle", companyId],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, o: Record<string, boolean>) => Promise<{ data: LifecycleEvent[] | null; error: unknown }> } } };
      }).from("customer_lifecycle_events")
        .select("*")
        .eq("company_id", companyId!)
        .order("event_at", { ascending: true });
      if (error) throw new Error("Failed to load lifecycle");
      return data ?? [];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="h-7 text-[11px] mb-2">
          <Link to={`/qrm/companies/${companyId}`}>
            <ArrowLeft className="mr-1 h-3 w-3" aria-hidden /> Back to account
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-foreground">Customer Lifecycle</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Multi-year customer arc on a single timeline. Auto-populated by mig 174 trigger network from real activity.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}
        </div>
      )}

      {isError && (
        <Card className="border-red-500/20 p-4">
          <p className="text-xs text-red-400">Failed to load lifecycle events.</p>
        </Card>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <Card className="border-dashed p-8 text-center">
          <p className="text-sm text-foreground">No lifecycle events yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Events populate from real activity. An admin can run <code className="rounded bg-muted px-1">select public.backfill_customer_lifecycle_events()</code> to seed from existing deals + service jobs.
          </p>
        </Card>
      )}

      {!isLoading && !isError && (data?.length ?? 0) > 0 && (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-3 top-0 bottom-0 w-px bg-border" aria-hidden />

          <div className="space-y-3">
            {(data ?? []).map((event) => {
              const meta = EVENT_META[event.event_type];
              return (
                <div key={event.id} className="relative pl-10">
                  <div className={`absolute left-0 top-2 flex h-6 w-6 items-center justify-center rounded-full border bg-card ${meta.tone}`}>
                    {meta.icon}
                  </div>
                  <Card className={`p-3 ${meta.tone}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-foreground">{meta.label}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {new Date(event.event_at).toLocaleString()}
                          {event.source_table && ` · ${event.source_table}`}
                        </p>
                      </div>
                    </div>
                    {Object.keys(event.metadata ?? {}).length > 0 && (
                      <pre className="mt-2 overflow-x-auto rounded bg-muted/20 p-2 text-[9px] text-muted-foreground">
                        {JSON.stringify(event.metadata, null, 0)}
                      </pre>
                    )}
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
