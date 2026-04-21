import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, ClipboardList, Receipt, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { listCrmWeightedOpenDeals } from "../lib/qrm-deals-api";
import { buildOperationsCopilotBoard } from "../lib/operations-copilot";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { supabase } from "@/lib/supabase";

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
  }
}

export function OperationsCopilotPage() {
  const dealsQuery = useQuery({
    queryKey: ["operations-copilot", "deals"],
    queryFn: () => listCrmWeightedOpenDeals(),
    staleTime: 60_000,
  });

  const dataQuery = useQuery({
    queryKey: ["operations-copilot", "signals"],
    queryFn: async () => {
      const [depositsResult, billingResult, invoicesResult] = await Promise.all([
        supabase
          .from("deposits")
          .select("id, deal_id, status, required_amount, created_at, received_at, verification_cycle_hours")
          .in("status", ["pending", "requested", "received"])
          .limit(200),
        supabase
          .from("service_internal_billing_line_staging")
          .select("id, service_job_id, created_at, line_total, description, status")
          .eq("status", "draft")
          .limit(200),
        supabase
          .from("customer_invoices")
          .select("id, invoice_number, service_job_id, status")
          .is("branch_id", null)
          .not("service_job_id", "is", null)
          .limit(200),
      ]);

      if (depositsResult.error) throw new Error(depositsResult.error.message);
      if (billingResult.error) throw new Error(billingResult.error.message);
      if (invoicesResult.error) throw new Error(invoicesResult.error.message);

      return {
        deposits: (depositsResult.data ?? []).map((row) => ({
          id: row.id,
          dealId: row.deal_id,
          status: row.status,
          requiredAmount: row.required_amount,
          createdAt: row.created_at,
          receivedAt: row.received_at,
          verificationCycleHours: row.verification_cycle_hours,
        })),
        billingDrafts: (billingResult.data ?? []).map((row) => ({
          id: row.id,
          serviceJobId: row.service_job_id,
          createdAt: row.created_at,
          lineTotal: row.line_total,
          description: row.description,
          status: row.status,
        })),
        invoicesMissingBranch: (invoicesResult.data ?? []).map((row) => ({
          id: row.id,
          invoiceNumber: row.invoice_number,
          serviceJobId: row.service_job_id,
          status: row.status,
        })),
      };
    },
    staleTime: 60_000,
  });

  const board = useMemo(
    () =>
      buildOperationsCopilotBoard({
        deals: dealsQuery.data ?? [],
        deposits: dataQuery.data?.deposits ?? [],
        billingDrafts: dataQuery.data?.billingDrafts ?? [],
        invoicesMissingBranch: dataQuery.data?.invoicesMissingBranch ?? [],
      }),
    [dealsQuery.data, dataQuery.data],
  );

  const isLoading = dealsQuery.isLoading || dataQuery.isLoading;
  const isError = dealsQuery.isError || dataQuery.isError;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="AI Operations Copilot"
        subtitle="Incomplete deals, delayed deposits, and billing handoff drift translated into traceable operational actions."
      />
      <QrmSubNav />

      {isLoading ? (
        <DeckSurface className="p-6 text-center text-sm text-muted-foreground">Loading operations copilot…</DeckSurface>
      ) : isError ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">Operations copilot is unavailable right now.</p>
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recommendations</p>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{String(board.summary.recommendationCount)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Incomplete Deals</p>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{String(board.summary.incompleteDeals)}</p>
            </DeckSurface>
            <DeckSurface className={`p-4 ${board.summary.delayedDeposits > 0 ? "border-qep-warm/40" : ""}`}>
              <div className="flex items-center gap-2">
                <Wallet className={`h-4 w-4 ${board.summary.delayedDeposits > 0 ? "text-qep-warm" : "text-qep-orange"}`} />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Delayed Deposits</p>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{String(board.summary.delayedDeposits)}</p>
            </DeckSurface>
            <DeckSurface className={`p-4 ${board.summary.billingIssues > 0 ? "border-qep-warm/40" : ""}`}>
              <div className="flex items-center gap-2">
                <Receipt className={`h-4 w-4 ${board.summary.billingIssues > 0 ? "text-qep-warm" : "text-qep-orange"}`} />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Billing Issues</p>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{String(board.summary.billingIssues)}</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Operational guidance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each recommendation includes a confidence label and a visible trace of the data that triggered it.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/qrm/companies">
                  Open deals <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical routes</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Operations Copilot is a command surface. For deals, open the Deals list. For deposits and billing, use the Service Dashboard.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to="/service/dashboard">
                  Service Dashboard <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Operations Copilot connects to AI Deal Coach for pipeline guidance and Service Dashboard for handoff resolution.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/qrm/deals">
                  Deals <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Refresh signals</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Force reload all operational signals to see latest incomplete deals, deposits, and billing issues.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                Refresh
              </Button>
            </div>
          </DeckSurface>
        </>
      )}
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
    <DeckSurface className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </DeckSurface>
  );
}
