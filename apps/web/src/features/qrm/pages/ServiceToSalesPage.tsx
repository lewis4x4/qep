import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Loader2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { DeckSurface, SignalChip, StatusDot, type StatusTone } from "../components/command-deck";

const DRAFT_EMAIL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-email`;

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

function pressureTone(level: "high" | "medium" | "low"): StatusTone {
  if (level === "high") return "hot";
  if (level === "medium") return "warm";
  return "cool";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeServiceJobs(rows: unknown): ServiceToSalesJob[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): ServiceToSalesJob | null => {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.current_stage !== "string" || typeof row.created_at !== "string") {
        return null;
      }
      return {
        id: row.id,
        customerId: nullableString(row.customer_id),
        machineId: nullableString(row.machine_id),
        currentStage: row.current_stage,
        scheduledEndAt: nullableString(row.scheduled_end_at),
        createdAt: row.created_at,
        customerProblemSummary: nullableString(row.customer_problem_summary),
        invoiceTotal: nullableNumber(row.invoice_total),
      };
    })
    .filter((row): row is ServiceToSalesJob => row !== null);
}

function normalizeMachineOwnership(value: unknown): ServiceToSalesMachine["ownership"] | null {
  return value === "owned" ||
    value === "leased" ||
    value === "customer_owned" ||
    value === "rental_fleet" ||
    value === "consignment"
    ? value
    : null;
}

function normalizeMachines(rows: unknown): ServiceToSalesMachine[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): ServiceToSalesMachine | null => {
      if (!isRecord(row) || typeof row.id !== "string") return null;
      const companyId = nullableString(row.company_id);
      const ownership = normalizeMachineOwnership(row.ownership);
      if (!companyId || !ownership) return null;
      return {
        id: row.id,
        companyId,
        name: nullableString(row.name) ?? "Unnamed machine",
        make: nullableString(row.make),
        model: nullableString(row.model),
        year: nullableNumber(row.year),
        ownership,
        engineHours: nullableNumber(row.engine_hours),
        currentMarketValue: nullableNumber(row.current_market_value),
        replacementCost: nullableNumber(row.replacement_cost),
      };
    })
    .filter((row): row is ServiceToSalesMachine => row !== null);
}

function normalizeFleetSignals(rows: unknown): ServiceToSalesFleetSignal[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): ServiceToSalesFleetSignal | null => {
      if (!isRecord(row) || typeof row.make !== "string" || typeof row.model !== "string") return null;
      return {
        make: row.make,
        model: row.model,
        year: nullableNumber(row.year),
        predictedReplacementDate: nullableString(row.predicted_replacement_date),
        replacementConfidence: nullableNumber(row.replacement_confidence),
        outreachStatus: nullableString(row.outreach_status),
        outreachDealValue: nullableNumber(row.outreach_deal_value),
        equipmentSerial: nullableString(row.equipment_serial),
      };
    })
    .filter((row): row is ServiceToSalesFleetSignal => row !== null);
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
        normalizeServiceJobs(jobsResult.data),
        normalizeMachines(machinesResult.data),
        normalizeFleetSignals(signalsResult.data),
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
  const summary = board?.summary ?? {
    totalCases: 0,
    highPressureCases: 0,
    openRevenueCandidates: 0,
    overdueCases: 0,
  };

  // Cascading Iron briefing — route to the sharpest svc→sales lever.
  const svcSalesIronHeadline = boardQuery.isLoading
    ? "Fusing service jobs, fleet machines, and replacement signals…"
    : boardQuery.isError
      ? "Service-to-sales offline — one of the feeders failed. Check the console."
      : summary.highPressureCases > 0
        ? `${summary.highPressureCases} high-pressure case${summary.highPressureCases === 1 ? "" : "s"} — recurring service pain ready for a trade-up conversation. ${summary.overdueCases} overdue.`
        : summary.overdueCases > 0
          ? `${summary.overdueCases} case${summary.overdueCases === 1 ? "" : "s"} with overdue downtime — unblock the service work before the replacement talk.`
          : summary.openRevenueCandidates > 0
            ? `${summary.openRevenueCandidates} revenue candidate${summary.openRevenueCandidates === 1 ? "" : "s"} carrying outreach value — draft the trade-up before the window closes.`
            : summary.totalCases > 0
              ? `${summary.totalCases} case${summary.totalCases === 1 ? "" : "s"} tracked. No acute pressure — work the consultative motion.`
              : "No service-to-sales motion right now. Keep an eye on fresh breakdowns.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Service-to-Sales"
        subtitle="Recurring breakdowns and downtime risk translated into replacement and upgrade motion."
        crumb={{ surface: "PULSE", lens: "SVC→SALES", count: summary.totalCases }}
        metrics={[
          { label: "Cases", value: summary.totalCases, tone: summary.totalCases > 0 ? "active" : undefined },
          { label: "High press.", value: summary.highPressureCases, tone: summary.highPressureCases > 0 ? "hot" : undefined },
          { label: "Revenue", value: summary.openRevenueCandidates, tone: summary.openRevenueCandidates > 0 ? "live" : undefined },
          { label: "Overdue", value: summary.overdueCases, tone: summary.overdueCases > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: svcSalesIronHeadline,
          actions: [{ label: "Service board →", href: "/service" }],
        }}
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading service-to-sales motion…</DeckSurface>
      ) : boardQuery.isError || !board ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Service-to-sales is unavailable right now."}
        </DeckSurface>
      ) : (
        <DeckSurface className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Replacement motion queue</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Customer-owned machines only. Ranked by recurring service pain, downtime exposure, and replacement confidence.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em]">
              <Link to="/service">
                Service <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>

          <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
            {board.cases.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No service-driven replacement cases are active right now.</p>
            ) : (
              board.cases.slice(0, 12).map((item) => {
                const tone = pressureTone(item.tradePressure);
                const drafting = draftMutation.isPending && draftMutation.variables?.machineId === item.machineId;
                return (
                  <div key={item.machineId} className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-2">
                      <StatusDot tone={tone} pulse={tone === "hot"} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-medium text-foreground">{item.machineName}</p>
                          <SignalChip label={`${item.tradePressure} pressure`} tone={tone} />
                          {item.replacementDate ? (
                            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                              rep {new Date(item.replacementDate).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {item.serviceCount180d} svc/180d
                          {item.openJobCount > 0 ? ` · ${item.openJobCount} open` : ""}
                          {item.overdueOpenJobs > 0 ? ` · ${item.overdueOpenJobs} overdue` : ""}
                          {item.engineHours != null ? ` · ${Math.round(item.engineHours).toLocaleString()}h` : ""}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {item.recurringProblem ?? "Recurring service pain detected"} · spend {formatCurrency(item.totalServiceSpend)}
                          {item.outreachDealValue != null ? ` · upside ${fmtMoney(item.outreachDealValue)}` : ""}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{item.reasons.join(" · ")}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 lg:shrink-0 lg:justify-end">
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                        <Link to={buildAccountCommandHref(item.companyId)}>
                          Account <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                        <Link to={`/equipment/${item.machineId}`}>
                          Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => draftMutation.mutate({ companyId: item.companyId, machineId: item.machineId })}
                        disabled={draftMutation.isPending}
                        className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em]"
                      >
                        {drafting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <TrendingUp className="mr-1 h-3 w-3" />}
                        Draft
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DeckSurface>
      )}
    </div>
  );
}
