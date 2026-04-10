import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, RefreshCcw, ShieldAlert, Truck, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Exception Handling"
        subtitle="Revival candidates, failed deliveries, damaged demos, rental disputes, and payment exceptions in one intervention surface."
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading exception handling…</Card>
      ) : boardQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Exception handling is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <SummaryCard icon={RefreshCcw} label="Revivals" value={String(board.summary.revivalCount)} />
            <SummaryCard icon={Truck} label="Deliveries" value={String(board.summary.failedDeliveryCount)} tone={board.summary.failedDeliveryCount > 0 ? "warn" : "default"} />
            <SummaryCard icon={AlertTriangle} label="Damaged demos" value={String(board.summary.damagedDemoCount)} tone={board.summary.damagedDemoCount > 0 ? "warn" : "default"} />
            <SummaryCard icon={RefreshCcw} label="Rental disputes" value={String(board.summary.rentalDisputeCount)} tone={board.summary.rentalDisputeCount > 0 ? "warn" : "default"} />
            <SummaryCard icon={Wallet} label="Payment exceptions" value={String(board.summary.paymentExceptionCount)} tone={board.summary.paymentExceptionCount > 0 ? "warn" : "default"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <BucketCard title="Revival candidates" actionLabel="Open deals" actionHref="/qrm/deals">
              {board.revivals.length === 0 ? (
                <Empty text="No recent revival candidates." />
              ) : (
                board.revivals.slice(0, 8).map((item) => (
                  <BucketRow key={item.id} title={item.name} detail={`${formatCurrency(item.amount)} · ${item.lossReason ?? "loss reason missing"}${item.competitor ? ` · ${item.competitor}` : ""}`} href={`/qrm/deals/${item.id}/autopsy`} />
                ))
              )}
            </BucketCard>

            <BucketCard title="Failed deliveries" actionLabel="Open traffic" actionHref="/ops/traffic">
              {board.failedDeliveries.length === 0 ? (
                <Empty text="No failed deliveries." />
              ) : (
                board.failedDeliveries.slice(0, 8).map((item) => (
                  <BucketRow key={item.id} title={item.stockNumber} detail={`${item.status.replace(/_/g, " ")} · ${item.toLocation}${item.problemsReported ? ` · ${item.problemsReported}` : ""}`} href="/ops/traffic" />
                ))
              )}
            </BucketCard>

            <BucketCard title="Damaged demos" actionLabel="Open approvals" actionHref="/qrm/command/approvals">
              {board.damagedDemos.length === 0 ? (
                <Empty text="No damaged demos." />
              ) : (
                board.damagedDemos.slice(0, 8).map((item) => (
                  <BucketRow key={item.id} title={`Demo ${item.demoId.slice(0, 8)}`} detail={item.damageDescription ?? "Damage recorded"} href={`/qrm/deals/${item.dealId}/room`} />
                ))
              )}
            </BucketCard>

            <BucketCard title="Rental disputes" actionLabel="Open returns" actionHref="/ops/returns">
              {board.rentalDisputes.length === 0 ? (
                <Empty text="No rental disputes." />
              ) : (
                board.rentalDisputes.slice(0, 8).map((item) => (
                  <BucketRow key={item.id} title={item.status.replace(/_/g, " ")} detail={`${item.refundStatus ?? "refund pending"} · ${formatCurrency(item.chargeAmount)}${item.damageDescription ? ` · ${item.damageDescription}` : ""}`} href="/ops/returns" />
                ))
              )}
            </BucketCard>

            <BucketCard title="Payment exceptions" actionLabel="Open validation" actionHref="/ops/payments">
              {board.paymentExceptions.length === 0 ? (
                <Empty text="No payment exceptions." />
              ) : (
                board.paymentExceptions.slice(0, 8).map((item) => (
                  <BucketRow key={item.id} title={item.invoiceReference ?? "Payment validation"} detail={`${formatCurrency(item.amount)} · ${item.attemptOutcome ?? "exception"}${item.exceptionReason ? ` · ${item.exceptionReason}` : ""}${item.overrideReason ? ` · ${item.overrideReason}` : ""}`} href="/ops/payments" />
                ))
              )}
            </BucketCard>
          </div>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Cross-functional inbox</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The generic exception queue is still the canonical work log for system-raised incidents.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/exceptions">
                  Open inbox <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
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
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
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
      <p className={`mt-3 text-3xl font-semibold ${tone === "warn" ? "text-amber-400" : "text-foreground"}`}>{value}</p>
    </Card>
  );
}

function BucketCard({
  title,
  actionLabel,
  actionHref,
  children,
}: {
  title: string;
  actionLabel: string;
  actionHref: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Button asChild size="sm" variant="outline">
          <Link to={actionHref}>
            {actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </Card>
  );
}

function BucketRow({ title, detail, href }: { title: string; detail: string; href: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link to={href}>
            Open <ArrowUpRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
