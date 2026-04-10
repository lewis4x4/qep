import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Building2, Clock3, Timer, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  aggregateTimeBankByAccount,
  aggregateTimeBankByRep,
  summarizeTimeBank,
  type TimeBankAggregateRow,
  type TimeBankRow,
} from "../lib/time-bank";
import { supabase } from "@/lib/supabase";

export function TimeBankPage() {
  const workspaceQuery = useMyWorkspaceId();
  const workspaceId = workspaceQuery.data ?? "default";

  const timeBankQuery = useQuery({
    queryKey: ["qrm", "time-bank", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<TimeBankRow[]> => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: TimeBankRow[] | null; error: { message?: string } | null }>;
      }).rpc("qrm_time_bank", {
        p_workspace_id: workspaceId,
        p_default_budget_days: 14,
      });
      if (error) throw new Error(error.message ?? "Failed to load Time Bank.");
      return data ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const summary = useMemo(() => summarizeTimeBank(timeBankQuery.data ?? []), [timeBankQuery.data]);
  const accountRows = useMemo(() => aggregateTimeBankByAccount(timeBankQuery.data ?? []).slice(0, 8), [timeBankQuery.data]);
  const repRows = useMemo(() => aggregateTimeBankByRep(timeBankQuery.data ?? []).slice(0, 8), [timeBankQuery.data]);
  const hottestDeals = useMemo(() => (timeBankQuery.data ?? []).slice(0, 12), [timeBankQuery.data]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Time Bank"
        subtitle="Visible time balance across deals, accounts, and reps so the team can see where execution time is being spent or lost."
      />
      <QrmSubNav />

      {timeBankQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading time balance…</Card>
      ) : timeBankQuery.isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {timeBankQuery.error instanceof Error ? timeBankQuery.error.message : "Time Bank unavailable."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Clock3} label="Open deals" value={String(summary.totalDeals)} detail="Deals participating in the time ledger" />
            <SummaryCard icon={Timer} label="Over budget" value={String(summary.overBudgetDeals)} detail="Deals beyond their current stage budget" tone="warn" />
            <SummaryCard icon={Building2} label="Accounts under pressure" value={String(summary.pressuredAccounts)} detail="Companies carrying at least one over-budget deal" />
            <SummaryCard icon={UserRound} label="Reps under pressure" value={String(summary.pressuredReps)} detail="Reps with over-budget or fully-consumed stage time" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <AggregateCard
              title="Account time balance"
              description="Which customer relationships are absorbing the most stage time right now."
              rows={accountRows}
              linkBuilder={(row) => `/qrm/companies/${row.id}`}
              actionLabel="Open company"
            />
            <AggregateCard
              title="Rep time balance"
              description="Where rep capacity is tied up across open deals."
              rows={repRows}
            />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Deal time ledger</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Uses stage SLA when available. Stages without an explicit SLA use the 14-day operating fallback budget.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Rep</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Age</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hottestDeals.map((row) => (
                    <TableRow key={row.deal_id}>
                      <TableCell className="font-medium text-foreground">{row.deal_name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.company_name ?? "No account"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.assigned_rep_name ?? "Unassigned"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.stage_name}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{row.days_in_stage}d</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.budget_days}d{row.has_explicit_budget ? "" : "*"}
                      </TableCell>
                      <TableCell className={`text-right ${row.is_over ? "text-red-400" : "text-muted-foreground"}`}>
                        {row.remaining_days}d
                      </TableCell>
                      <TableCell className={`text-right font-medium ${row.pct_used >= 1 ? "text-red-400" : row.pct_used >= 0.75 ? "text-amber-400" : "text-foreground"}`}>
                        {Math.round(row.pct_used * 100)}%
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/qrm/deals/${row.deal_id}`}>
                            Open <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

function AggregateCard({
  title,
  description,
  rows,
  linkBuilder,
  actionLabel = "Open",
}: {
  title: string;
  description: string;
  rows: TimeBankAggregateRow[];
  linkBuilder?: (row: TimeBankAggregateRow) => string;
  actionLabel?: string;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active items yet.</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{row.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.dealCount} deals · {row.overCount} over budget · avg used {Math.round(row.avgPctUsed * 100)}%
                  </p>
                  {row.worstDealName && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Hottest deal: {row.worstDealName} ({Math.round(row.worstPctUsed * 100)}%)
                    </p>
                  )}
                </div>
                {linkBuilder ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link to={linkBuilder(row)}>
                      {actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
