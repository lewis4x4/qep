import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Building2, Sparkles } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBranchBySlug } from "@/hooks/useBranches";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import {
  summarizeBranchCommand,
  type BranchInvoiceRow,
  type BranchIntakeRow,
  type BranchOpenDealRow,
  type BranchServiceJobRow,
  type BranchTrafficRow,
} from "../lib/branch-command";
import { buildBranchChiefBoard } from "../lib/branch-chief";

export function BranchChiefPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const branchQuery = useBranchBySlug(branchId ?? null);

  const [trafficQuery, intakeQuery, serviceQuery, invoiceQuery, openDealsQuery] = useQueries({
    queries: [
      {
        queryKey: ["branch-chief", branchId, "traffic"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchTrafficRow[]> => {
          const { data, error } = await supabase
            .from("traffic_tickets")
            .select("id, ticket_type, status, from_location, to_location")
            .order("shipping_date", { ascending: false })
            .limit(200);
          if (error) throw new Error(error.message);
          return (data ?? []) as BranchTrafficRow[];
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["branch-chief", branchId, "intake"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchIntakeRow[]> => {
          const { data, error } = await supabase
            .from("equipment_intake")
            .select("id, current_stage, pdi_completed, photo_ready, ship_to_branch")
            .limit(200);
          if (error) throw new Error(error.message);
          return (data ?? []) as BranchIntakeRow[];
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["branch-chief", branchId, "service-jobs"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchServiceJobRow[]> => {
          const { data, error } = await supabase
            .from("service_jobs")
            .select("id, customer_id, current_stage, invoice_total")
            .eq("branch_id", branchId!)
            .is("deleted_at", null)
            .limit(200);
          if (error) throw new Error(error.message);
          return (data ?? []) as BranchServiceJobRow[];
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["branch-chief", branchId, "invoices"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchInvoiceRow[]> => {
          const { data, error } = await supabase
            .from("customer_invoices")
            .select("id, total, amount_paid, balance_due, status")
            .eq("branch_id", branchId!)
            .limit(200);
          if (error) throw new Error(error.message);
          return (data ?? []) as BranchInvoiceRow[];
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["branch-chief", branchId, "open-deals"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchOpenDealRow[]> => {
          const { data, error } = await supabase
            .from("crm_deals")
            .select("id, company_id, name, amount")
            .is("deleted_at", null)
            .is("closed_at", null)
            .limit(400);
          if (error) throw new Error(error.message);
          return (data ?? []) as BranchOpenDealRow[];
        },
        staleTime: 60_000,
      },
    ],
  });

  const summary = useMemo(() => {
    if (!branchQuery.data) return null;
    return summarizeBranchCommand({
      slug: branchQuery.data.slug,
      displayName: branchQuery.data.display_name,
      trafficTickets: trafficQuery.data ?? [],
      intake: intakeQuery.data ?? [],
      serviceJobs: serviceQuery.data ?? [],
      invoices: invoiceQuery.data ?? [],
      openDeals: openDealsQuery.data ?? [],
    });
  }, [branchQuery.data, trafficQuery.data, intakeQuery.data, serviceQuery.data, invoiceQuery.data, openDealsQuery.data]);

  const board = useMemo(
    () =>
      branchQuery.data && summary
        ? buildBranchChiefBoard({
            branchId: branchQuery.data.slug,
            summary,
            trafficTickets: trafficQuery.data ?? [],
            serviceJobs: serviceQuery.data ?? [],
          })
        : null,
    [branchQuery.data, summary, trafficQuery.data, serviceQuery.data],
  );

  if (!branchId) {
    return <Navigate to="/admin/branches" replace />;
  }

  if (branchQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="h-32 animate-pulse border-border bg-muted/40" />
        <Card className="h-80 animate-pulse border-border bg-muted/40" />
      </div>
    );
  }

  if (branchQuery.isError || !branchQuery.data || !summary || !board) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">This branch chief surface isn&apos;t available right now.</p>
        </Card>
      </div>
    );
  }

  const branch = branchQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={`/qrm/branches/${branch.slug}/command`}>
            <ArrowLeft className="h-4 w-4" />
            Back to branch
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/service/dashboard">Service Dashboard</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/ops/traffic">Traffic</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${branch.display_name} — AI Branch Chief`}
        subtitle="Per-branch diagnostic guidance with confidence labels and traceable operational evidence."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard icon={Sparkles} label="Recommendations" value={String(board.summary.recommendationCount)} />
        <SummaryCard icon={AlertTriangle} label="Urgent" value={String(board.summary.urgentCount)} tone={board.summary.urgentCount > 0 ? "warn" : "default"} />
        <SummaryCard icon={Building2} label="Readiness Risk" value={board.summary.readinessRisk ? "Yes" : "No"} tone={board.summary.readinessRisk ? "warn" : "default"} />
        <SummaryCard icon={Building2} label="Revenue Leak" value={board.summary.revenueLeak ? "Yes" : "No"} tone={board.summary.revenueLeak ? "warn" : "default"} />
      </div>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Branch chief recommendations</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Branch-level guidance built from the current readiness, logistics, AR, service, and rental signals already present in the branch command stack.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to={`/qrm/branches/${branch.slug}/command`}>
              Open branch command <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {board.recommendations.map((item) => (
            <div key={item.key} className="rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{item.headline}</p>
                    <span className={`text-[11px] font-medium ${item.confidence === "high" ? "text-emerald-400" : item.confidence === "medium" ? "text-qep-orange" : "text-muted-foreground"}`}>
                      {item.confidence} confidence
                    </span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {item.trace.map((line) => (
                      <p key={line} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={item.href}>
                    {item.actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}
