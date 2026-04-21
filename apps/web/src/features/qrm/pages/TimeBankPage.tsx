import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, StatusDot } from "../components/command-deck";
import { buildAccountCommandHref } from "../lib/account-command";
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

  // Cascading Iron briefing — route to the sharpest time-pressure lever.
  const timeBankIronHeadline = timeBankQuery.isLoading
    ? "Scanning stage budgets and deal ages for time pressure…"
    : timeBankQuery.isError
      ? "Time Bank offline — the stage ledger feeder failed. Check the console."
      : summary.overBudgetDeals > 0
        ? `${summary.overBudgetDeals} deal${summary.overBudgetDeals === 1 ? "" : "s"} over budget across ${summary.pressuredAccounts} account${summary.pressuredAccounts === 1 ? "" : "s"} — unblock the hottest stage before the rest of the pipeline slips. ${summary.pressuredReps} rep${summary.pressuredReps === 1 ? "" : "s"} carrying the load.`
        : summary.pressuredAccounts > 0
          ? `${summary.pressuredAccounts} account${summary.pressuredAccounts === 1 ? "" : "s"} carrying deals at their stage ceiling — close the next step or disposition before they breach.`
          : summary.totalDeals > 0
            ? `${summary.totalDeals} open deal${summary.totalDeals === 1 ? "" : "s"} on the ledger, budgets healthy. Protect the pace you have — timing compounds.`
            : "No open deals on the time ledger today. Capacity is unused — press the graph.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Time Bank"
        subtitle="Stage time ledger — where execution minutes are spent, saved, or lost across deals, accounts, and reps."
        crumb={{ surface: "TODAY", lens: "TIME-BANK", count: summary.totalDeals }}
        metrics={[
          { label: "Open deals", value: summary.totalDeals },
          { label: "Over budget", value: summary.overBudgetDeals, tone: summary.overBudgetDeals > 0 ? "hot" : undefined },
          { label: "Accounts", value: summary.pressuredAccounts, tone: summary.pressuredAccounts > 0 ? "warm" : undefined },
          { label: "Reps", value: summary.pressuredReps, tone: summary.pressuredReps > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: timeBankIronHeadline,
          actions: [{ label: "Pipeline →", href: "/qrm/pipeline" }],
        }}
      />
      <QrmSubNav />

      {timeBankQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading time balance…</DeckSurface>
      ) : timeBankQuery.isError ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {timeBankQuery.error instanceof Error ? timeBankQuery.error.message : "Time Bank unavailable."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
            <AggregateBoard
              title="Account time balance"
              description="Which customer relationships are absorbing the most stage time right now."
              rows={accountRows}
              linkBuilder={(row) => buildAccountCommandHref(row.id)}
              actionLabel="Open account"
            />
            <AggregateBoard
              title="Rep time balance"
              description="Where rep capacity is tied up across open deals."
              rows={repRows}
            />
          </div>

          <DeckSurface className="p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Deal time ledger</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Stage SLA where available. Stages without an explicit SLA use the 14-day operating fallback budget.
                </p>
              </div>
            </div>
            <div className="mt-3">
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
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{row.days_in_stage}d</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.budget_days}d{row.has_explicit_budget ? "" : "*"}
                      </TableCell>
                      <TableCell className={`text-right font-mono tabular-nums ${row.is_over ? "text-qep-hot" : "text-muted-foreground"}`}>
                        {row.remaining_days}d
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium tabular-nums ${row.pct_used >= 1 ? "text-qep-hot" : row.pct_used >= 0.75 ? "text-qep-warm" : "text-foreground"}`}>
                        {Math.round(row.pct_used * 100)}%
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[11px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
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
          </DeckSurface>
        </>
      )}
    </div>
  );
}

function AggregateBoard({
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
    <DeckSurface className="p-4">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-3 space-y-1.5">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active items yet.</p>
        ) : (
          rows.map((row) => {
            const tone = row.overCount > 0 ? "hot" : row.avgPctUsed >= 0.75 ? "warm" : row.avgPctUsed > 0 ? "active" : "cool";
            return (
              <div key={row.id} className="flex items-start justify-between gap-3 rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 px-3 py-2">
                <div className="flex min-w-0 items-start gap-2">
                  <StatusDot tone={tone} pulse={tone === "hot"} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">{row.label}</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                      {row.dealCount} deals · {row.overCount} over · avg {Math.round(row.avgPctUsed * 100)}%
                    </p>
                    {row.worstDealName && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Hottest: {row.worstDealName} ({Math.round(row.worstPctUsed * 100)}%)
                      </p>
                    )}
                  </div>
                </div>
                {linkBuilder ? (
                  <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                    <Link to={linkBuilder(row)}>
                      {actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </DeckSurface>
  );
}
