import { useMemo } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CloudRain,
  ReceiptText,
  TimerReset,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { fetchAccount360 } from "../lib/account-360-api";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import {
  buildAccountCashflowWeatherHref,
  buildAccountCommandHref,
  buildAccountDecisionCycleHref,
  buildAccountOperatingProfileHref,
  buildAccountStrategistHref,
} from "../lib/account-command";
import { buildCashflowWeatherBoard } from "../lib/cashflow-weather";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { DeckSurface } from "../components/command-deck";
import { DeckSurface } from "../components/command-deck";

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

export function CashflowWeatherMapPage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["cashflow-weather", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["cashflow-weather", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: false,
      }),
    staleTime: 30_000,
  });

  const invoicesQuery = useQuery({
    queryKey: ["cashflow-weather", accountId, "invoices"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_invoices")
        .select("id, invoice_number, invoice_date, due_date, paid_at, total, amount_paid, balance_due, status, payment_method")
        .eq("crm_company_id", accountId!)
        .order("invoice_date", { ascending: false })
        .limit(250);

      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  if (!accountId) {
    return <Navigate to="/qrm/companies" replace />;
  }

  if (accountQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="h-32 animate-pulse border-border bg-muted/40" />
        <Card className="h-80 animate-pulse border-border bg-muted/40" />
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This cashflow weather map surface isn&apos;t available right now.
          </p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;

  const board = useMemo(() => {
    if (!invoicesQuery.data) return null;
    return buildCashflowWeatherBoard({
      accountId,
      invoices: invoicesQuery.data.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        invoiceDate: row.invoice_date,
        dueDate: row.due_date,
        paidAt: row.paid_at,
        total: row.total,
        amountPaid: row.amount_paid,
        balanceDue: row.balance_due,
        status: row.status,
        paymentMethod: row.payment_method,
      })),
      arBlock: account.ar_block,
      budgetCycleMonth: profileQuery.data?.budget_cycle_month ?? account.profile?.budget_cycle_month,
      seasonalPattern: profileQuery.data?.behavioral_signals?.seasonal_pattern ?? null,
    });
  }, [account.ar_block, account.profile?.budget_cycle_month, accountId, invoicesQuery.data, profileQuery.data]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={buildAccountCommandHref(accountId)}>
            <ArrowLeft className="h-4 w-4" />
            Back to account
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountStrategistHref(accountId)}>Customer Strategist</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountDecisionCycleHref(accountId)}>Decision Cycle</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountOperatingProfileHref(accountId)}>Operating Profile</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Cashflow Weather Map`}
        subtitle="Customer float, payment cadence, and seasonal cash timing translated into an account-level weather surface."
      />
      <QrmSubNav />

      {profileQuery.isLoading || invoicesQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading cashflow weather map…</Card>
      ) : profileQuery.isError || invoicesQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : invoicesQuery.error instanceof Error
              ? invoicesQuery.error.message
              : "Cashflow weather map is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Wallet} label="Open Balance" value={formatCurrency(board.summary.openBalance)} />
            <SummaryCard icon={CloudRain} label="Overdue" value={formatCurrency(board.summary.overdueBalance)} />
            <SummaryCard icon={TimerReset} label="Avg Days To Pay" value={board.summary.avgDaysToPay != null ? String(board.summary.avgDaysToPay) : "—"} />
            <SummaryCard icon={ReceiptText} label="Risk Score" value={String(board.summary.riskScore)} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Mirror framing</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cashflow Weather Map is the account-level cash surface. It reads payment rhythm, float pressure, and seasonal timing from live invoice and profile evidence.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountCashflowWeatherHref(accountId)}>Refresh weather</Link>
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <WeatherColumn
              title="Current Weather"
              rows={board.currentWeather}
              emptyText="No current payment pressure is visible."
            />
            <WeatherColumn
              title="Cadence Pattern"
              rows={board.cadencePattern}
              emptyText="No payment cadence history is available yet."
            />
            <WeatherColumn
              title="Seasonal Cash"
              rows={board.seasonalCash}
              emptyText="No seasonal cash timing signal is elevated right now."
            />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function WeatherColumn({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: Array<{
    key: string;
    title: string;
    confidence: "high" | "medium" | "low";
    trace: string[];
    actionLabel: string;
    href: string;
  }>;
  emptyText: string;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{row.title}</p>
                    <span className={`text-[11px] font-medium ${confidenceTone(row.confidence)}`}>
                      {row.confidence} confidence
                    </span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {row.trace.map((line) => (
                      <p key={line} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={row.href}>
                    {row.actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
