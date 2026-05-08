import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, RefreshCw } from "lucide-react";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { createAskIronSeedState, ASK_IRON_PATH } from "../components/askIronHandoff";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, SignalChip, StatusDot, type StatusTone } from "../components/command-deck";
import { buildAccountCommandHref } from "../lib/account-command";
import {
  aggregateTimeBankByAccount,
  aggregateTimeBankByRep,
  buildTimeBankInterventions,
  summarizeTimeBank,
  type TimeBankAggregateRow,
  type TimeBankIntervention,
  type TimeBankPressureTier,
  type TimeBankRow,
} from "../lib/time-bank";
import { fetchTimeBankRows } from "../lib/time-bank-api";

export function TimeBankPage() {
  const workspaceQuery = useMyWorkspaceId();
  const workspaceId = workspaceQuery.data;

  const timeBankQuery = useQuery<TimeBankRow[]>({
    queryKey: ["qrm", "time-bank", workspaceId ?? "__pending__"],
    enabled: !workspaceQuery.isLoading && !workspaceQuery.isError && Boolean(workspaceId),
    queryFn: () => fetchTimeBankRows({ workspaceId: workspaceId!, defaultBudgetDays: 14 }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const rows = timeBankQuery.data ?? [];
  const summary = useMemo(() => summarizeTimeBank(rows), [rows]);
  const accountRows = useMemo(() => aggregateTimeBankByAccount(rows).slice(0, 8), [rows]);
  const repRows = useMemo(() => aggregateTimeBankByRep(rows).slice(0, 8), [rows]);
  const interventions = useMemo(() => buildTimeBankInterventions(rows).slice(0, 5), [rows]);
  const hottestDeals = useMemo(() => rows.slice().sort(sortTimeBankRows).slice(0, 12), [rows]);

  const isInitialLoading = workspaceQuery.isLoading || (Boolean(workspaceId) && timeBankQuery.isLoading);
  const hasWorkspaceError = workspaceQuery.isError;
  const hasNoWorkspace = !workspaceQuery.isLoading && !hasWorkspaceError && !workspaceId;
  const healthyDeals = Math.max(0, summary.totalDeals - summary.overBudgetDeals - summary.criticalDeals - summary.watchDeals);

  const timeBankIronHeadline = isInitialLoading
    ? "Scanning stage budgets and deal ages for time pressure…"
    : hasWorkspaceError
      ? "Workspace lookup failed — retry workspace context before reading the time ledger."
      : hasNoWorkspace
        ? "No active workspace is selected — connect the operator deck before reading the time ledger."
        : timeBankQuery.isError
        ? "Time Bank offline — the native stage-ledger feeder failed. Retry the RPC before trusting the queue."
        : summary.overBudgetDeals > 0
          ? `${summary.overBudgetDeals} deal${summary.overBudgetDeals === 1 ? "" : "s"} over budget, ${summary.totalOverrunDays}d of total overrun, and ${summary.unassignedDeals} unassigned handoff${summary.unassignedDeals === 1 ? "" : "s"}. Iron is prioritizing interventions before the pipeline slips.`
          : summary.criticalDeals > 0
            ? `${summary.criticalDeals} deal${summary.criticalDeals === 1 ? "" : "s"} at critical stage pressure — move the next commitment before it becomes overrun.`
            : summary.totalDeals > 0
              ? `${summary.totalDeals} open deal${summary.totalDeals === 1 ? "" : "s"} on the ledger, budgets healthy. Protect the pace you have — timing compounds.`
              : "No open deals on the time ledger today. Capacity is unused — press the graph.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Time Bank"
        subtitle="Native stage-time ledger — where execution minutes are spent, saved, or lost across deals, accounts, and reps."
        crumb={{ surface: "TODAY", lens: "TIME-BANK", count: summary.totalDeals }}
        metrics={[
          { label: "Open deals", value: summary.totalDeals },
          { label: "Over budget", value: summary.overBudgetDeals, tone: summary.overBudgetDeals > 0 ? "hot" : undefined },
          { label: "Critical", value: summary.criticalDeals, tone: summary.criticalDeals > 0 ? "warm" : undefined },
          { label: "Unassigned", value: summary.unassignedDeals, tone: summary.unassignedDeals > 0 ? "warm" : undefined },
          { label: "Fallback SLA", value: summary.fallbackBudgetDeals, tone: summary.fallbackBudgetDeals > 0 ? "active" : undefined },
        ]}
        ironBriefing={{
          headline: timeBankIronHeadline,
          actions: [
            { label: "Pipeline →", href: "/qrm/pipeline" },
            { label: "Activities →", href: "/qrm/activities" },
          ],
        }}
        dataSourceBadgePrefix="CRM"
        rightRail={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-live hover:text-qep-live/80"
              disabled={!workspaceId || timeBankQuery.isFetching}
              onClick={() => void timeBankQuery.refetch()}
            >
              <RefreshCw className={`mr-1 h-3 w-3 ${timeBankQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <DataSourceBadge
              state="Native"
              label="Time Ledger"
              title="Computed from open deals, stage age, and stage SLA budgets."
            />
          </>
        }
      />
      <QrmSubNav />

      {isInitialLoading ? (
        <TimeBankSkeleton />
      ) : hasWorkspaceError ? (
        <TimeBankErrorState
          title="Workspace context unavailable"
          diagnostic="useMyWorkspaceId"
          error={workspaceQuery.error}
          onRetry={() => window.location.reload()}
        />
      ) : hasNoWorkspace ? (
        <TimeBankNoWorkspaceState />
      ) : timeBankQuery.isError ? (
        <TimeBankErrorState error={timeBankQuery.error} onRetry={() => void timeBankQuery.refetch()} />
      ) : rows.length === 0 ? (
        <TimeBankEmptyState />
      ) : (
        <>
          <TimeBankInterventionQueue interventions={interventions} totalDeals={summary.totalDeals} />

          <PressureDistributionStrip
            over={summary.overBudgetDeals}
            critical={summary.criticalDeals}
            watch={summary.watchDeals}
            healthy={healthyDeals}
            fallback={summary.fallbackBudgetDeals}
          />

          <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
            <AggregateBoard
              title="Account time balance"
              description="Which customer relationships are absorbing the most stage time right now."
              rows={accountRows}
              linkBuilder={(row) => (row.entityId ? buildAccountCommandHref(row.entityId) : "")}
              actionLabel="Account"
            />
            <AggregateBoard
              title="Rep time balance"
              description="Where rep capacity is tied up across open deals."
              rows={repRows}
              linkBuilder={(row) => (row.entityId ? `/qrm/rep-reality?repId=${row.entityId}` : "")}
              actionLabel="Open mirror"
            />
          </div>

          <DealTimeLedger rows={hottestDeals} />
        </>
      )}
    </div>
  );
}

function sortTimeBankRows(a: TimeBankRow, b: TimeBankRow): number {
  const tierWeight: Record<TimeBankPressureTier, number> = { over: 4, critical: 3, watch: 2, healthy: 1 };
  return (
    tierWeight[b.pressure_tier] - tierWeight[a.pressure_tier] ||
    b.overrun_days - a.overrun_days ||
    b.pct_used - a.pct_used ||
    b.days_in_stage - a.days_in_stage ||
    a.deal_name.localeCompare(b.deal_name)
  );
}

function tierTone(tier: TimeBankPressureTier): StatusTone {
  if (tier === "over") return "hot";
  if (tier === "critical") return "warm";
  if (tier === "watch") return "active";
  return "cool";
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function overrunLabel(row: TimeBankRow): string {
  return row.is_over ? `+${row.overrun_days}d over` : `${row.remaining_days}d left`;
}

function askQuestionForRow(row: TimeBankRow): string {
  const company = row.company_name ?? "No account";
  if (row.is_over) {
    return `What's blocking deal ${row.deal_name} at ${company}? It has been in ${row.stage_name} for ${row.days_in_stage}d, ${row.overrun_days}d over the ${row.budget_days}d budget.`;
  }
  return `How should I move deal ${row.deal_name} at ${company} forward in ${row.stage_name}? It has used ${formatPercent(row.pct_used)} of its ${row.budget_days}d budget.`;
}

function TimeBankSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading Time Bank">
      <DeckSurface tone="live" className="p-4">
        <div className="h-3 w-48 animate-pulse rounded-sm bg-qep-live/20" />
        <div className="mt-4 grid gap-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/50" />
          ))}
        </div>
      </DeckSurface>
      <div className="grid gap-3 xl:grid-cols-2">
        <DeckSurface className="h-44 animate-pulse bg-qep-deck-elevated/50"><span className="sr-only">Loading account time balance</span></DeckSurface>
        <DeckSurface className="h-44 animate-pulse bg-qep-deck-elevated/50"><span className="sr-only">Loading rep time balance</span></DeckSurface>
      </div>
      <DeckSurface className="p-4">
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-10 animate-pulse rounded-sm bg-muted/40" />
          ))}
        </div>
      </DeckSurface>
    </div>
  );
}

function TimeBankNoWorkspaceState() {
  return (
    <DeckSurface className="p-6 text-center">
      <p className="text-sm font-medium text-foreground">No active workspace selected.</p>
      <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">
        Sign in to a workspace to view its native time ledger and route stage-pressure interventions.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/workspaces">Workspace settings →</Link>
        </Button>
      </div>
    </DeckSurface>
  );
}

function TimeBankEmptyState() {
  return (
    <DeckSurface className="p-6 text-center">
      <p className="text-sm font-medium text-foreground">No open deals on the Time Bank.</p>
      <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">
        Capacity is unused — press the graph to start new motion across sales, rental, equipment, and parts opportunities.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/qrm/deals">Open deals →</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to="/qrm/activities">Activities →</Link>
        </Button>
      </div>
    </DeckSurface>
  );
}

function TimeBankErrorState({
  error,
  onRetry,
  title = "Time Bank ledger unavailable",
  diagnostic = "qrm_time_bank",
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
  diagnostic?: string;
}) {
  return (
    <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <AlertTriangle className="h-4 w-4 shrink-0 text-qep-hot" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-qep-hot">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error from the time-ledger feeder."}
          </p>
          <SignalChip label="Diagnostic" value={diagnostic} tone="hot" className="mt-2" />
        </div>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </DeckSurface>
  );
}

function TimeBankInterventionQueue({ interventions, totalDeals }: { interventions: TimeBankIntervention[]; totalDeals: number }) {
  return (
    <DeckSurface tone="live" className="p-3 sm:p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Iron intervention queue</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Highest-leverage stage-time corrections, scored by overrun, ownership, budget pressure, and missing customer context.
          </p>
        </div>
        <SignalChip label="Top" value={interventions.length} tone="live" />
      </header>

      {interventions.length === 0 ? (
        <div className="mt-3 rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30 p-3 text-sm text-muted-foreground">
          Pipeline humming — {totalDeals} open deal{totalDeals === 1 ? "" : "s"}, no stage breaches, no orphan deals.
        </div>
      ) : (
        <ol className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
          {interventions.map((intervention) => (
            <InterventionCard key={intervention.id} intervention={intervention} />
          ))}
        </ol>
      )}
    </DeckSurface>
  );
}

function InterventionCard({ intervention }: { intervention: TimeBankIntervention }) {
  const tone = tierTone(intervention.tier);
  const actions = uniqueActions([intervention.primaryAction, ...intervention.secondaryActions]);

  return (
    <li className="flex flex-col gap-3 px-3 py-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot tone={tone} pulse={intervention.tier === "over"} />
          <SignalChip label="Priority" value={intervention.priorityScore} tone={tone} />
          {intervention.chips.map((chip) => (
            <SignalChip key={`${intervention.id}-${chip.label}`} label={chip.label} value={chip.value} tone={chip.tone} />
          ))}
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-foreground">{intervention.headline}</p>
        <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
          {intervention.companyName} · {intervention.assignedRepName} · {intervention.stageName}
        </p>
        <ul className="mt-2 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
          {intervention.trace.slice(0, 4).map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-1 lg:max-w-[360px] lg:justify-end">
        {actions.map((action) => (
          <RailLink key={`${intervention.id}-${action.label}-${action.href}`} href={action.href} label={action.label} tone={action.href.includes("/room") ? "warm" : "active"} />
        ))}
        <AskIronLink question={intervention.askIronQuestion} sourceId={intervention.dealId} />
      </div>
    </li>
  );
}

function PressureDistributionStrip({
  over,
  critical,
  watch,
  healthy,
  fallback,
}: {
  over: number;
  critical: number;
  watch: number;
  healthy: number;
  fallback: number;
}) {
  const cells = [
    { label: "Over", value: over, tone: "hot" as StatusTone },
    { label: "Critical", value: critical, tone: "warm" as StatusTone },
    { label: "Watch", value: watch, tone: "active" as StatusTone },
    { label: "Healthy", value: healthy, tone: "ok" as StatusTone },
    { label: "Fallback SLA", value: fallback, tone: "cool" as StatusTone },
  ];

  return (
    <DeckSurface className="grid gap-2 p-3 sm:grid-cols-5">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-sm border border-qep-deck-rule/50 bg-qep-deck-elevated/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{cell.label}</span>
            <StatusDot tone={cell.tone} pulse={cell.label === "Over" && cell.value > 0} />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-foreground">{cell.value}</p>
        </div>
      ))}
    </DeckSurface>
  );
}

function DealTimeLedger({ rows }: { rows: TimeBankRow[] }) {
  return (
    <DeckSurface className="p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Deal time ledger</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Stage SLA where available. Stages without an explicit SLA use the 14-day operating fallback budget.
          </p>
        </div>
      </div>

      <ol className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30 lg:hidden">
        {rows.map((row) => (
          <TimeBankLedgerCard key={row.deal_id} row={row} />
        ))}
      </ol>

      <div className="mt-3 hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tier</TableHead>
              <TableHead>Deal</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Rep</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Age</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Pressure</TableHead>
              <TableHead className="min-w-[150px] text-right">Used</TableHead>
              <TableHead className="min-w-[260px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.deal_id}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <StatusDot tone={tierTone(row.pressure_tier)} pulse={row.is_over} />
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{row.pressure_tier}</span>
                  </span>
                </TableCell>
                <TableCell className="max-w-[220px] truncate font-medium text-foreground">{row.deal_name}</TableCell>
                <TableCell className="max-w-[180px] truncate text-muted-foreground">{row.company_name ?? "No account"}</TableCell>
                <TableCell className="max-w-[150px] truncate text-muted-foreground">{row.assigned_rep_name ?? "Unassigned"}</TableCell>
                <TableCell className="max-w-[160px] truncate text-muted-foreground">{row.stage_name}</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{row.days_in_stage}d</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {row.budget_days}d{row.has_explicit_budget ? "" : "*"}
                </TableCell>
                <TableCell className={`text-right font-mono tabular-nums ${row.is_over ? "text-qep-hot" : "text-muted-foreground"}`}>
                  {overrunLabel(row)}
                </TableCell>
                <TableCell className="text-right">
                  <TimeUsedMeter row={row} align="right" />
                </TableCell>
                <TableCell>
                  <LedgerActionRail row={row} justify="end" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DeckSurface>
  );
}

function TimeBankLedgerCard({ row }: { row: TimeBankRow }) {
  return (
    <li className="px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot tone={tierTone(row.pressure_tier)} pulse={row.is_over} />
        <SignalChip label={row.pressure_tier} value={formatPercent(row.pct_used)} tone={tierTone(row.pressure_tier)} />
        {row.budget_source === "fallback" && <SignalChip label="Budget" value="Fallback" tone="warm" />}
        {!row.assigned_rep_id && <SignalChip label="Owner" value="Unassigned" tone="hot" />}
        {!row.company_id && <SignalChip label="Account" value="Missing" tone="hot" />}
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">{row.deal_name}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {row.company_name ?? "No account"} · {row.assigned_rep_name ?? "Unassigned"} · {row.stage_name}
      </p>
      <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
        Age {row.days_in_stage}d · Budget {row.budget_days}d{row.has_explicit_budget ? "" : "*"} · {overrunLabel(row)}
      </p>
      <div className="mt-2">
        <TimeUsedMeter row={row} />
      </div>
      <LedgerActionRail row={row} className="mt-3" />
    </li>
  );
}

function TimeUsedMeter({ row, align = "left" }: { row: TimeBankRow; align?: "left" | "right" }) {
  const percent = Math.round(row.pct_used * 100);
  const width = Math.min(100, Math.max(3, percent));
  const fill = row.is_over ? "bg-qep-hot" : row.pressure_tier === "critical" ? "bg-qep-warm" : row.pressure_tier === "watch" ? "bg-qep-orange" : "bg-success";

  return (
    <div className={align === "right" ? "ml-auto w-32" : "w-full"}>
      <div className={`mb-1 font-mono text-[11px] font-medium tabular-nums ${row.is_over ? "text-qep-hot" : row.pressure_tier === "critical" ? "text-qep-warm" : "text-foreground"}`}>
        {percent}% used
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function LedgerActionRail({ row, className = "", justify = "start" }: { row: TimeBankRow; className?: string; justify?: "start" | "end" }) {
  const urgent = row.is_over || row.pressure_tier === "critical";
  return (
    <div className={`flex flex-wrap gap-1 ${justify === "end" ? "justify-end" : ""} ${className}`}>
      {urgent && <RailLink href={`/qrm/deals/${row.deal_id}/room`} label="Room" tone="warm" />}
      <RailLink href={`/qrm/deals/${row.deal_id}`} label="Detail" tone="active" />
      {row.company_id && <RailLink href={buildAccountCommandHref(row.company_id)} label="Account" tone="active" />}
      <RailLink href="/qrm/command/blockers" label="Blockers" tone="cool" />
      <RailLink href="/qrm/command/quotes" label="Quotes" tone="cool" />
      <AskIronLink question={askQuestionForRow(row)} sourceId={row.deal_id} />
    </div>
  );
}

function RailLink({ href, label, tone = "active" }: { href: string; label: string; tone?: "active" | "warm" | "cool" }) {
  const toneClass = tone === "warm" ? "text-qep-orange hover:text-qep-orange/80" : tone === "cool" ? "text-muted-foreground hover:text-foreground" : "text-qep-live hover:text-qep-live/80";
  return (
    <Button asChild size="sm" variant="ghost" className={`h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] ${toneClass}`}>
      <Link to={href}>
        {label} <ArrowUpRight className="ml-1 h-3 w-3" />
      </Link>
    </Button>
  );
}

function AskIronLink({ question, sourceId }: { question: string; sourceId: string }) {
  return (
    <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-live hover:text-qep-live/80">
      <Link to={ASK_IRON_PATH} state={createAskIronSeedState(question, "today", sourceId)}>
        Ask Iron <ArrowUpRight className="ml-1 h-3 w-3" />
      </Link>
    </Button>
  );
}

function uniqueActions(actions: Array<{ label: string; href: string }>) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.href)) return false;
    seen.add(action.href);
    return true;
  });
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
            const tone: StatusTone = row.overCount > 0 || row.isMissingEntity ? "hot" : row.criticalCount > 0 || row.avgPctUsed >= 0.75 ? "warm" : row.watchCount > 0 || row.avgPctUsed > 0 ? "active" : "cool";
            const href = linkBuilder?.(row);
            return (
              <div key={row.id} className="flex items-start justify-between gap-3 rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 px-3 py-2">
                <div className="flex min-w-0 items-start gap-2">
                  <StatusDot tone={tone} pulse={tone === "hot"} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">{row.label}</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                      {row.dealCount} deals · {row.overCount} over · {row.criticalCount} critical · avg {formatPercent(row.avgPctUsed)}
                    </p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                      {row.totalOverrunDays}d overrun · {row.fallbackBudgetCount} fallback SLA
                    </p>
                    {row.worstDealName && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Hottest: {row.worstDealName} ({formatPercent(row.worstPctUsed)})
                      </p>
                    )}
                  </div>
                </div>
                {href && !row.isMissingEntity ? (
                  <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                    <Link to={href}>
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
