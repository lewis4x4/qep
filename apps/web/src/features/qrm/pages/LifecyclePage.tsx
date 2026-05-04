import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Phone, FileText, ShoppingBag, Wrench, Shield, MessageSquare, AlertTriangle, RotateCcw, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { fetchAccount360 } from "../lib/account-360-api";
import { buildAccountCommandHref } from "../lib/account-command";
import {
  eventLabel,
  normalizeCustomerLifecycleEventRows,
  type CustomerLifecycleEventRow,
} from "../lib/customer-timeline";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

const EVENT_META: Record<CustomerLifecycleEventRow["event_type"], { icon: React.ReactNode; tone: string }> = {
  first_contact:        { icon: <Phone className="h-3 w-3" />,         tone: "text-blue-400 border-blue-500/30" },
  first_quote:          { icon: <FileText className="h-3 w-3" />,      tone: "text-violet-400 border-violet-500/30" },
  first_purchase:       { icon: <ShoppingBag className="h-3 w-3" />,   tone: "text-emerald-400 border-emerald-500/30" },
  first_service:        { icon: <Wrench className="h-3 w-3" />,        tone: "text-qep-orange border-qep-orange/30" },
  first_warranty_claim: { icon: <Shield className="h-3 w-3" />,        tone: "text-amber-400 border-amber-500/30" },
  nps_response:         { icon: <MessageSquare className="h-3 w-3" />,  tone: "text-blue-400 border-blue-500/30" },
  churn_risk_flag:      { icon: <AlertTriangle className="h-3 w-3" />,   tone: "text-red-400 border-red-500/30" },
  won_back:             { icon: <RotateCcw className="h-3 w-3" />,     tone: "text-emerald-400 border-emerald-500/30" },
  lost:                 { icon: <XCircle className="h-3 w-3" />,       tone: "text-muted-foreground border-border" },
};

export function LifecyclePage() {
  const { companyId, accountId } = useParams<{ companyId?: string; accountId?: string }>();
  const resolvedCompanyId = accountId ?? companyId ?? null;

  const accountQuery = useQuery({
    queryKey: ["customer-timeline", resolvedCompanyId, "account"],
    queryFn: () => fetchAccount360(resolvedCompanyId!),
    enabled: Boolean(resolvedCompanyId),
    staleTime: 60_000,
  });

  const { data: timelineData, isLoading, isError } = useQuery({
    queryKey: ["lifecycle", resolvedCompanyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_lifecycle_events")
        .select("id, company_id, event_type, event_at, source_table, metadata")
        .eq("company_id", resolvedCompanyId!)
        .order("event_at", { ascending: true })
        .limit(500);
      if (error) throw new Error("Failed to load lifecycle");
      return normalizeCustomerLifecycleEventRows(data);
    },
    enabled: Boolean(resolvedCompanyId),
    staleTime: 60_000,
  });

  const timelineRows = timelineData ?? [];
  const counts = useMemo(() => ({
    firstContactCount: timelineRows.filter((event) => event.event_type === "first_contact").length,
    firstQuoteCount: timelineRows.filter((event) => event.event_type === "first_quote").length,
    firstPurchaseCount: timelineRows.filter((event) => event.event_type === "first_purchase").length,
    firstServiceCount: timelineRows.filter((event) => event.event_type === "first_service").length,
  }), [timelineRows]);

  if (!resolvedCompanyId) {
    return null;
  }

  if (accountQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">This customer timeline surface isn&apos;t available right now.</p>
        </DeckSurface>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="h-7 text-[11px] mb-2">
          <Link to={resolvedCompanyId ? buildAccountCommandHref(resolvedCompanyId) : "/qrm/companies"}>
            <ArrowLeft className="mr-1 h-3 w-3" /> Back to account
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-foreground">Customer 360 Timeline</h1>
        <p className="text-sm text-muted-foreground">
          Cinematic operating history for this relationship, powered by live lifecycle events.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            {EVENT_META["first_contact"].icon}
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contact</p>
          </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(counts.firstContactCount)}</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            {EVENT_META["first_quote"].icon}
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quote</p>
          </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(counts.firstQuoteCount)}</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            {EVENT_META["first_purchase"].icon}
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Purchase</p>
          </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(counts.firstPurchaseCount)}</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            {EVENT_META["first_service"].icon}
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Service</p>
          </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(counts.firstServiceCount)}</p>
        </DeckSurface>
      </div>

      <DeckSurface className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Lifecycle framing</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Customer 360 Timeline shows the full operating history: quotes, purchases, service, warranty, churn, and won-back events.
            </p>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link to="/qrm/companies">
              Refresh timeline <RotateCcw className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </DeckSurface>

      {isLoading && (
        <div className="space-y-3">
          <div className="h-8 bg-muted/20 rounded-sm animate-pulse" />
          <div className="h-8 bg-muted/20 rounded-sm animate-pulse" />
        </div>
      )}

      {isError && (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">Failed to load lifecycle events.</p>
        </DeckSurface>
      )}

      {!isLoading && !isError && timelineRows.length === 0 && (
        <DeckSurface className="border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">No lifecycle events yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Events populate from real activity. An admin can run <code className="rounded bg-muted px-1">select public.backfill_customer_lifecycle_events()</code> to seed from existing deals + service jobs.
          </p>
        </DeckSurface>
      )}

      {!isLoading && !isError && timelineRows.length > 0 && (
        <div className="space-y-3">
          {timelineRows.map((event) => {
            const meta = EVENT_META[event.event_type];
            return (
              <div key={event.id} className="relative pl-10">
                <div className={`absolute left-0 top-2 flex h-6 w-6 items-center justify-center rounded-full border bg-card ${meta.tone}`}>
                  {meta.icon}
                </div>
                <DeckSurface className={`p-3 ${meta.tone}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{eventLabel(event.event_type)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(event.event_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        {event.source_table && ` · ${event.source_table}`}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={resolvedCompanyId ? buildAccountCommandHref(resolvedCompanyId) : "/qrm/companies"}>
                        Account <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </DeckSurface>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
