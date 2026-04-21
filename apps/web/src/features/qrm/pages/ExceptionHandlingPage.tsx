import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, StatusDot, type StatusTone } from "../components/command-deck";
import { buildExceptionHandlingBoard } from "../lib/exception-handling";

interface RevivalRow {
  id: string;
  name: string;
  amount: number | null;
  closed_at: string | null;
  loss_reason: string | null;
  competitor: string | null;
}

interface FailedDeliveryRow {
  id: string;
  stock_number: string;
  status: string;
  promised_delivery_at: string | null;
  problems_reported: string | null;
  to_location: string;
}

interface DamagedDemoRow {
  id: string;
  demo_id: string;
  damage_description: string | null;
  completed_at: string | null;
  demos: { deal_id: string | null } | { deal_id: string | null }[] | null;
}

interface RentalDisputeRow {
  id: string;
  equipment_id: string | null;
  status: string;
  refund_status: string | null;
  charge_amount: number | null;
  damage_description: string | null;
}

interface PaymentExceptionRow {
  id: string;
  amount: number;
  attempt_outcome: string | null;
  exception_reason: string | null;
  override_reason: string | null;
  invoice_reference: string | null;
}

export function ExceptionHandlingPage() {
  const boardQuery = useQuery({
    queryKey: ["qrm", "exception-handling"],
    queryFn: async () => {
      const [revivalsResult, trafficResult, demoResult, rentalResult, paymentResult] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("id, name, amount, closed_at, loss_reason, competitor, crm_deal_stages!inner(is_closed_lost)")
          .eq("crm_deal_stages.is_closed_lost", true)
          .not("closed_at", "is", null)
          .limit(200),
        supabase
          .from("traffic_tickets")
          .select("id, stock_number, status, promised_delivery_at, problems_reported, to_location")
          .or(`problems_reported.not.is.null,promised_delivery_at.lt.${new Date().toISOString()}`)
          .neq("status", "completed")
          .limit(200),
        supabase
          .from("demo_inspections")
          .select("id, demo_id, damage_description, completed_at, demos!inner(deal_id)")
          .eq("inspection_type", "post_demo")
          .eq("damage_found", true)
          .limit(200),
        supabase
          .from("rental_returns")
          .select("id, equipment_id, status, refund_status, charge_amount, damage_description")
          .or("refund_status.eq.pending,refund_status.eq.processing,has_charges.eq.true")
          .neq("status", "completed")
          .limit(200),
        supabase
          .from("payment_validations")
          .select("id, amount, attempt_outcome, exception_reason, override_reason, invoice_reference")
          .or("passed.eq.false,attempt_outcome.eq.override_granted")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      if (revivalsResult.error) throw new Error(revivalsResult.error.message);
      if (trafficResult.error) throw new Error(trafficResult.error.message);
      if (demoResult.error) throw new Error(demoResult.error.message);
      if (rentalResult.error) throw new Error(rentalResult.error.message);
      if (paymentResult.error) throw new Error(paymentResult.error.message);

      return buildExceptionHandlingBoard({
        revivals: ((revivalsResult.data ?? []) as RevivalRow[]).map((row) => ({
          id: row.id,
          name: row.name,
          amount: row.amount,
          closedAt: row.closed_at,
          lossReason: row.loss_reason,
          competitor: row.competitor,
        })),
        failedDeliveries: ((trafficResult.data ?? []) as FailedDeliveryRow[]).map((row) => ({
          id: row.id,
          stockNumber: row.stock_number,
          status: row.status,
          promisedDeliveryAt: row.promised_delivery_at,
          problemsReported: row.problems_reported,
          toLocation: row.to_location,
        })),
        damagedDemos: ((demoResult.data ?? []) as DamagedDemoRow[]).map((row) => ({
          id: row.id,
          demoId: row.demo_id,
          dealId: Array.isArray(row.demos) ? (row.demos[0]?.deal_id ?? "") : (row.demos?.deal_id ?? ""),
          damageDescription: row.damage_description,
          completedAt: row.completed_at,
        })),
        rentalDisputes: ((rentalResult.data ?? []) as RentalDisputeRow[]).map((row) => ({
          id: row.id,
          equipmentId: row.equipment_id,
          status: row.status,
          refundStatus: row.refund_status,
          chargeAmount: row.charge_amount,
          damageDescription: row.damage_description,
        })),
        paymentExceptions: ((paymentResult.data ?? []) as PaymentExceptionRow[]).map((row) => ({
          id: row.id,
          amount: row.amount,
          attemptOutcome: row.attempt_outcome,
          exceptionReason: row.exception_reason,
          overrideReason: row.override_reason,
          invoiceReference: row.invoice_reference,
        })),
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data;
  const summary = board?.summary ?? {
    revivalCount: 0,
    failedDeliveryCount: 0,
    damagedDemoCount: 0,
    rentalDisputeCount: 0,
    paymentExceptionCount: 0,
  };
  const totalExceptions =
    summary.revivalCount +
    summary.failedDeliveryCount +
    summary.damagedDemoCount +
    summary.rentalDisputeCount +
    summary.paymentExceptionCount;

  // Cascading Iron briefing — route to the sharpest exception lever.
  const exceptionsIronHeadline = boardQuery.isLoading
    ? "Fusing revivals, deliveries, demos, rentals, and payments into one intervention queue…"
    : boardQuery.isError
      ? "Exception handling offline — one of the feeders failed. Check the console."
      : summary.paymentExceptionCount > 0
        ? `${summary.paymentExceptionCount} payment exception${summary.paymentExceptionCount === 1 ? "" : "s"} open — cash is the sharpest lever, clear these first. ${summary.failedDeliveryCount} deliver${summary.failedDeliveryCount === 1 ? "y" : "ies"} · ${summary.rentalDisputeCount} rental.`
        : summary.failedDeliveryCount > 0
          ? `${summary.failedDeliveryCount} deliver${summary.failedDeliveryCount === 1 ? "y" : "ies"} stuck or late — trust compounds on these, unblock now. ${summary.damagedDemoCount} damaged demo${summary.damagedDemoCount === 1 ? "" : "s"}.`
          : summary.rentalDisputeCount > 0
            ? `${summary.rentalDisputeCount} rental dispute${summary.rentalDisputeCount === 1 ? "" : "s"} unresolved — reconcile refunds before they escalate.`
            : summary.damagedDemoCount > 0
              ? `${summary.damagedDemoCount} damaged demo${summary.damagedDemoCount === 1 ? "" : "s"} pending disposition — get approvals logged before the unit moves again.`
              : summary.revivalCount > 0
                ? `${summary.revivalCount} revival candidate${summary.revivalCount === 1 ? "" : "s"} from the last 30 days — replay the loss reason and re-open.`
                : "No active exceptions. The field is clean — keep the pace.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Exception Handling"
        subtitle="Revival candidates, failed deliveries, damaged demos, rental disputes, and payment exceptions in one intervention surface."
        crumb={{ surface: "PULSE", lens: "EXCEPTIONS", count: totalExceptions }}
        metrics={[
          { label: "Revivals", value: summary.revivalCount, tone: summary.revivalCount > 0 ? "active" : undefined },
          { label: "Deliveries", value: summary.failedDeliveryCount, tone: summary.failedDeliveryCount > 0 ? "warm" : undefined },
          { label: "Demos", value: summary.damagedDemoCount, tone: summary.damagedDemoCount > 0 ? "warm" : undefined },
          { label: "Rentals", value: summary.rentalDisputeCount, tone: summary.rentalDisputeCount > 0 ? "warm" : undefined },
          { label: "Payments", value: summary.paymentExceptionCount, tone: summary.paymentExceptionCount > 0 ? "hot" : undefined },
        ]}
        ironBriefing={{
          headline: exceptionsIronHeadline,
          actions: [
            { label: "Cross-functional inbox →", href: "/exceptions" },
            { label: "Approvals →", href: "/qrm/command/approvals" },
          ],
        }}
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading exception handling…</DeckSurface>
      ) : boardQuery.isError || !board ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Exception handling is unavailable right now."}
        </DeckSurface>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <BucketDeck
            title="Revival candidates"
            tone={summary.revivalCount > 0 ? "active" : "cool"}
            actionLabel="Open deals"
            actionHref="/qrm/deals"
            emptyText="No recent revival candidates."
          >
            {board.revivals.slice(0, 8).map((item) => (
              <BucketRow
                key={item.id}
                title={item.name}
                detail={`${formatCurrency(item.amount)} · ${item.lossReason ?? "loss reason missing"}${item.competitor ? ` · ${item.competitor}` : ""}`}
                href={`/qrm/deals/${item.id}/autopsy`}
                tone={summary.revivalCount > 0 ? "active" : "cool"}
              />
            ))}
          </BucketDeck>

          <BucketDeck
            title="Failed deliveries"
            tone={summary.failedDeliveryCount > 0 ? "warm" : "cool"}
            actionLabel="Traffic"
            actionHref="/ops/traffic"
            emptyText="No failed deliveries."
          >
            {board.failedDeliveries.slice(0, 8).map((item) => (
              <BucketRow
                key={item.id}
                title={item.stockNumber}
                detail={`${item.status.replace(/_/g, " ")} · ${item.toLocation}${item.problemsReported ? ` · ${item.problemsReported}` : ""}`}
                href="/ops/traffic"
                tone={summary.failedDeliveryCount > 0 ? "warm" : "cool"}
              />
            ))}
          </BucketDeck>

          <BucketDeck
            title="Damaged demos"
            tone={summary.damagedDemoCount > 0 ? "warm" : "cool"}
            actionLabel="Approvals"
            actionHref="/qrm/command/approvals"
            emptyText="No damaged demos."
          >
            {board.damagedDemos.slice(0, 8).map((item) => (
              <BucketRow
                key={item.id}
                title={`Demo ${item.demoId.slice(0, 8)}`}
                detail={item.damageDescription ?? "Damage recorded"}
                href={`/qrm/deals/${item.dealId}/room`}
                tone={summary.damagedDemoCount > 0 ? "warm" : "cool"}
              />
            ))}
          </BucketDeck>

          <BucketDeck
            title="Rental disputes"
            tone={summary.rentalDisputeCount > 0 ? "warm" : "cool"}
            actionLabel="Returns"
            actionHref="/ops/returns"
            emptyText="No rental disputes."
          >
            {board.rentalDisputes.slice(0, 8).map((item) => (
              <BucketRow
                key={item.id}
                title={item.status.replace(/_/g, " ")}
                detail={`${item.refundStatus ?? "refund pending"} · ${formatCurrency(item.chargeAmount)}${item.damageDescription ? ` · ${item.damageDescription}` : ""}`}
                href="/ops/returns"
                tone={summary.rentalDisputeCount > 0 ? "warm" : "cool"}
              />
            ))}
          </BucketDeck>

          <BucketDeck
            title="Payment exceptions"
            tone={summary.paymentExceptionCount > 0 ? "hot" : "cool"}
            actionLabel="Validation"
            actionHref="/ops/payments"
            emptyText="No payment exceptions."
          >
            {board.paymentExceptions.slice(0, 8).map((item) => (
              <BucketRow
                key={item.id}
                title={item.invoiceReference ?? "Payment validation"}
                detail={`${formatCurrency(item.amount)} · ${item.attemptOutcome ?? "exception"}${item.exceptionReason ? ` · ${item.exceptionReason}` : ""}${item.overrideReason ? ` · ${item.overrideReason}` : ""}`}
                href="/ops/payments"
                tone={summary.paymentExceptionCount > 0 ? "hot" : "cool"}
              />
            ))}
          </BucketDeck>
        </div>
      )}
    </div>
  );
}

function BucketDeck({
  title,
  tone,
  actionLabel,
  actionHref,
  emptyText,
  children,
}: {
  title: string;
  tone: StatusTone;
  actionLabel: string;
  actionHref: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <DeckSurface className="p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusDot tone={tone} pulse={tone === "hot"} />
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">{title}</h2>
        </div>
        <Button asChild size="sm" variant="outline" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em]">
          <Link to={actionHref}>
            {actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
      <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
        {hasChildren ? children : <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>}
      </div>
    </DeckSurface>
  );
}

function BucketRow({
  title,
  detail,
  href,
  tone,
}: {
  title: string;
  detail: string;
  href: string;
  tone: StatusTone;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <StatusDot tone={tone} pulse={tone === "hot"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">{detail}</p>
      </div>
      <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
        <Link to={href}>
          Open <ArrowUpRight className="ml-1 h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}
