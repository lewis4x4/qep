import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleSlash, FileSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  fetchEquipmentInvoiceReversalCandidate,
  type EquipmentInvoiceReversalCandidate,
} from "../lib/qrm-router-api";

interface EquipmentReversalReadinessCardProps {
  stockNumber: string | null | undefined;
  canReadReadiness: boolean;
}

const blockerLabels: Record<string, string> = {
  missing_stock_number: "Stock number is required before the readiness guard can run.",
  equipment_not_found: "No active QRM equipment record matches this stock number.",
  no_direct_equipment_invoice: "No direct equipment sale invoice is linked to this stock number.",
  invoice_status_blocks_reversal: "Partially paid, paid, void, or already reversed invoices are blocked pending finance policy.",
  quickbooks_posted_invoice_requires_finance_policy: "QuickBooks-posted invoices require an approved finance reversal policy.",
  no_gl_period_for_invoice_date: "No GL period covers the invoice date.",
  hard_closed_gl_period: "The matching GL period is hard closed.",
  equipment_not_marked_sold: "Equipment is not currently marked sold.",
};

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{fmt(value)}</div>
    </div>
  );
}

function CandidateDetails({ candidate }: { candidate: EquipmentInvoiceReversalCandidate }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Detail label="Invoice" value={candidate.invoiceNumber ?? candidate.invoiceId} />
      <Detail label="Invoice status" value={candidate.invoiceStatus} />
      <Detail label="QuickBooks / GL" value={candidate.quickbooksGlStatus} />
      <Detail label="GL period" value={candidate.postingPeriodStatus} />
      <Detail label="Equipment state" value={candidate.equipmentInOutState} />
      <Detail label="Stock number" value={candidate.stockNumber} />
    </div>
  );
}

export function EquipmentReversalReadinessCard({
  stockNumber,
  canReadReadiness,
}: EquipmentReversalReadinessCardProps) {
  const normalizedStockNumber = stockNumber?.trim() ?? "";
  const shouldRunReadiness = canReadReadiness && normalizedStockNumber.length > 0;
  const candidateQuery = useQuery({
    queryKey: ["crm", "equipment", "reversal-candidate", normalizedStockNumber],
    queryFn: () => fetchEquipmentInvoiceReversalCandidate(normalizedStockNumber),
    enabled: shouldRunReadiness,
    retry: false,
    staleTime: 30_000,
  });

  return (
    <Card className="border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-qep-orange" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Sale Reversal Readiness
            </h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Diagnostic only. JAR-103 remains blocked until finance approves credit memo, GL, tax, paid/posted,
            closed-period, rental-branch, authorization, and idempotency policy.
          </p>
        </div>
        <Badge variant="outline">Read-only</Badge>
      </div>

      {!canReadReadiness && (
        <div className="mt-4 flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <CircleSlash className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Elevated QRM access is required to run the stock-number reversal readiness guard.</span>
        </div>
      )}

      {canReadReadiness && !normalizedStockNumber && (
        <div className="mt-4 flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Add a stock number before checking reversal readiness.</span>
        </div>
      )}

      {shouldRunReadiness && candidateQuery.isLoading && (
        <div className="mt-4 h-20 animate-pulse rounded-md bg-muted/40" aria-label="Loading reversal readiness" />
      )}

      {shouldRunReadiness && candidateQuery.isError && (
        <div className="mt-4 flex gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Readiness check unavailable: {candidateQuery.error instanceof Error ? candidateQuery.error.message : "Unknown error"}
          </span>
        </div>
      )}

      {shouldRunReadiness && candidateQuery.data && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {candidateQuery.data.candidateStatus === "ready" ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Candidate ready
              </Badge>
            ) : (
              <Badge variant="warning" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> Candidate blocked
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              This status enables triage only; it does not authorize reversal execution.
            </span>
          </div>

          <CandidateDetails candidate={candidateQuery.data} />

          {candidateQuery.data.blockers.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-200">Blockers</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100">
                {candidateQuery.data.blockers.map((blocker) => (
                  <li key={blocker}>{blockerLabels[blocker] ?? fmt(blocker)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
