import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, DollarSign, Loader2, TrendingUp, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { buildAccountCommandHref } from "../lib/account-command";
import {
  buildServiceToSalesBoard,
  type ServiceToSalesFleetSignal,
  type ServiceToSalesJob,
  type ServiceToSalesMachine,
} from "../lib/service-to-sales";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

const DRAFT_EMAIL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-email`;

interface ServiceJobRow {
  id: string;
  customer_id: string | null;
  machine_id: string | null;
  current_stage: string;
  scheduled_end_at: string | null;
  created_at: string;
  customer_problem_summary: string | null;
  invoice_total: number | null;
}

interface MachineRow {
  id: string;
  company_id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  ownership: ServiceToSalesMachine["ownership"];
  engine_hours: number | null;
  current_market_value: number | null;
  replacement_cost: number | null;
}

interface FleetSignalRow {
  make: string;
  model: string;
  year: number | null;
  predicted_replacement_date: string | null;
  replacement_confidence: number | null;
  outreach_status: string | null;
  outreach_deal_value: number | null;
  equipment_serial: string | null;
}

export function ServiceToSalesPage() {
  const boardQuery = useQuery({
    queryKey: ["qrm", "service-to-sales"],
    queryFn: async () => {
      const [jobsResult, machinesResult, signalsResult] = await Promise.all([
        supabase
          .from("service_jobs")
          .select("id, customer_id, machine_id, current_stage, scheduled_end_at, created_at, customer_problem_summary, invoice_total")
          .is("deleted_at", null)
          .limit(1000),
        supabase
          .from("crm_equipment")
          .select("id, company_id, name, make, model, year, ownership, engine_hours, current_market_value, replacement_cost")
          .eq("ownership", "customer_owned")
          .is("deleted_at", null)
          .limit(1000),
        supabase
          .from("fleet_intelligence")
          .select("make, model, year, predicted_replacement_date, replacement_confidence, outreach_status, outreach_deal_value, equipment_serial")
          .limit(1000),
      ]);

      if (jobsResult.error) throw new Error(jobsResult.error.message);
      if (machinesResult.error) throw new Error(machinesResult.error.message);
      if (signalsResult.error) throw new Error(signalsResult.error.message);

      return buildServiceToSalesBoard(
        ((jobsResult.data ?? []) as ServiceJobRow[]).map((row) => ({
          id: row.id,
          customerId: row.customer_id,
          machineId: row.machine_id,
          currentStage: row.current_stage,
          scheduledEndAt: row.scheduled_end_at,
          createdAt: row.created_at,
          customerProblemSummary: row.customer_problem_summary,
          invoiceTotal: row.invoice_total,
        })),
        ((machinesResult.data ?? []) as MachineRow[]).map((row) => ({
          id: row.id,
          companyId: row.company_id,
          name: row.name,
          make: row.make,
          model: row.model,
          year: row.year,
          ownership: row.ownership,
          engineHours: row.engine_hours,
          currentMarketValue: row.current_market_value,
          replacementCost: row.replacement_cost,
        })),
        ((signalsResult.data ?? []) as FleetSignalRow[]).map((row) => ({
          make: row.make,
          model: row.model,
          year: row.year,
          predictedReplacementDate: row.predicted_replacement_date,
          replacementConfidence: row.replacement_confidence,
          outreachStatus: row.outreach_status,
          outreachDealValue: row.outreach_deal_value,
          equipmentSerial: row.equipment_serial,
        })),
      );
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const draftMutation = useMutation({
    mutationFn: async (input: { companyId: string; machineId: string }) => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${DRAFT_EMAIL_URL}/draft`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenario: "trade_up",
          company_id: input.companyId,
          equipment_id: input.machineId,
          context: {
            source_surface: "service_to_sales",
          },
          tone: "consultative",
          persist: true,
        }),
      });
      if (!res.ok) throw new Error("Draft failed");
      return res.json();
    },
  });

  const board = boardQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Service-to-Sales"
        subtitle="Recurring breakdowns and downtime risk translated into replacement and upgrade motion."
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading service-to-sales motion…</Card>
      ) : boardQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Service-to-sales is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Wrench} label="Cases" value={String(board.summary.totalCases)} detail="Machines with recurring service pain and upgrade pressure." />
            <SummaryCard icon={TrendingUp} label="High pressure" value={String(board.summary.highPressureCases)} detail="Immediate replacement or upgrade conversations." tone="warn" />
            <SummaryCard icon={DollarSign} label="Revenue candidates" value={String(board.summary.openRevenueCandidates)} detail="Cases already carrying outreach deal value." />
            <SummaryCard icon={Wrench} label="Overdue downtime" value={String(board.summary.overdueCases)} detail="Cases with overdue open service work." tone={board.summary.overdueCases > 0 ? "warn" : "default"} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Replacement motion queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customer-owned machines only. Ranked by recurring service pain, downtime exposure, and replacement confidence.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/service">
                  Open service <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {board.cases.length === 0 ? (
                <p className="text-sm text-muted-foreground">No service-driven replacement cases are active right now.</p>
              ) : (
                board.cases.slice(0, 12).map((item) => {
                  const drafting = draftMutation.isPending
                    && draftMutation.variables?.machineId === item.machineId;
                  return (
                    <div key={item.machineId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{item.machineName}</p>
                            <PressurePill level={item.tradePressure} />
                            {item.replacementDate ? (
                              <span className="text-[11px] text-muted-foreground">
                                replacement {new Date(item.replacementDate).toLocaleDateString()}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.serviceCount180d} service jobs in 180d
                            {item.openJobCount > 0 ? ` · ${item.openJobCount} open` : ""}
                            {item.overdueOpenJobs > 0 ? ` · ${item.overdueOpenJobs} overdue` : ""}
                            {item.engineHours != null ? ` · ${Math.round(item.engineHours).toLocaleString()}h` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.recurringProblem ?? "Recurring service pain detected"} · spend {formatCurrency(item.totalServiceSpend)}
                            {item.outreachDealValue != null ? ` · upside ${formatCurrency(item.outreachDealValue)}` : ""}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">{item.reasons.join(" · ")}</p>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <Button asChild size="sm" variant="ghost">
                            <Link to={buildAccountCommandHref(item.companyId)}>
                              Account <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/equipment/${item.machineId}`}>
                              Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => draftMutation.mutate({ companyId: item.companyId, machineId: item.machineId })}
                            disabled={draftMutation.isPending}
                          >
                            {drafting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <TrendingUp className="mr-1 h-3 w-3" />}
                            Draft trade-up
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function PressurePill({ level }: { level: "high" | "medium" | "low" }) {
  const tone = level === "high"
    ? "bg-red-500/10 text-red-300"
    : level === "medium"
      ? "bg-amber-500/10 text-amber-200"
      : "bg-emerald-500/10 text-emerald-200";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {level} pressure
    </span>
  );
}
