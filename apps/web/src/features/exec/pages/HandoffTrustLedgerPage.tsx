import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, ArrowUpRight, Filter } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import {
  HANDOFF_ROLE_LABELS,
  HANDOFF_ROLE_TITLES,
  buildSeamSummaries,
  filterHandoffEvents,
  formatScore,
  parseHandoffEvidence,
  scoreTone,
  summarizeHandoffs,
  type HandoffEventRow,
  type IronRole,
} from "../lib/handoff-trust";

const WINDOWS = [
  { label: "7D", value: 7 },
  { label: "30D", value: 30 },
  { label: "90D", value: 90 },
] as const;

export function HandoffTrustLedgerPage() {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const [fromRole, setFromRole] = useState<IronRole | "all">("all");
  const [toRole, setToRole] = useState<IronRole | "all">("all");
  const [reason, setReason] = useState<string | "all">("all");
  const [lowScoreOnly, setLowScoreOnly] = useState(false);

  const { data: events = [], isLoading, isError, error } = useQuery({
    queryKey: ["exec", "handoff-events"],
    queryFn: async (): Promise<HandoffEventRow[]> => {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            gte: (column: string, value: string) => {
              order: (column: string, options: { ascending: boolean }) => Promise<{ data: HandoffEventRow[] | null; error: { message?: string } | null }>;
            };
          };
        };
      })
        .from("handoff_events")
        .select("id, subject_id, subject_label, handoff_reason, handoff_at, from_iron_role, to_iron_role, composite_score, info_completeness, recipient_readiness, outcome_alignment, outcome, evidence")
        .gte("handoff_at", since)
        .order("handoff_at", { ascending: false });
      if (error) throw new Error(error.message ?? "Failed to load handoff events.");
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const availableReasons = useMemo(
    () =>
      [...new Set(events.map((event) => event.handoff_reason).filter((value): value is string => Boolean(value)))]
        .sort((a, b) => a.localeCompare(b)),
    [events],
  );

  const filteredEvents = useMemo(
    () =>
      filterHandoffEvents(events, {
        windowDays,
        fromRole,
        toRole,
        reason,
        lowScoreOnly,
      }),
    [events, fromRole, lowScoreOnly, reason, toRole, windowDays],
  );

  const seamSummaries = useMemo(() => buildSeamSummaries(filteredEvents), [filteredEvents]);
  const overview = useMemo(() => summarizeHandoffs(filteredEvents, seamSummaries), [filteredEvents, seamSummaries]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-24 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-qep-orange font-semibold">Manager seam review</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Handoff Trust Ledger</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Review how well work crosses role seams, which handoffs degrade outcomes, and which deals need intervention now.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/executive">Back to executive overview</Link>
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Filter className="h-4 w-4 text-qep-orange" />
          Filters
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {WINDOWS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={windowDays === option.value ? "default" : "outline"}
              onClick={() => setWindowDays(option.value)}
            >
              {option.label}
            </Button>
          ))}

          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={fromRole}
            onChange={(event) => setFromRole(event.target.value as IronRole | "all")}
          >
            <option value="all">All senders</option>
            {Object.entries(HANDOFF_ROLE_TITLES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={toRole}
            onChange={(event) => setToRole(event.target.value as IronRole | "all")}
          >
            <option value="all">All receivers</option>
            {Object.entries(HANDOFF_ROLE_TITLES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="all">All reasons</option>
            {availableReasons.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          <label className="ml-1 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={lowScoreOnly}
              onChange={(event) => setLowScoreOnly(event.target.checked)}
            />
            Low-score only
          </label>
        </div>
      </Card>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading handoff trust data…</Card>
      ) : isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {error instanceof Error ? error.message : "Failed to load handoff trust data."}
        </Card>
      ) : filteredEvents.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No handoff data matches the current filters yet.
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard
              label="Total handoffs"
              value={String(overview.totalHandoffs)}
              detail="Role seams in the selected window"
            />
            <SummaryCard
              label="Worst seam"
              value={overview.worstSeam ? `${HANDOFF_ROLE_LABELS[overview.worstSeam.from_iron_role]} → ${HANDOFF_ROLE_LABELS[overview.worstSeam.to_iron_role]}` : "—"}
              detail={overview.worstSeam?.avg_composite != null ? `${formatScore(overview.worstSeam.avg_composite)} trust score` : "No scored seam yet"}
            />
            <SummaryCard
              label="Best seam"
              value={overview.bestSeam ? `${HANDOFF_ROLE_LABELS[overview.bestSeam.from_iron_role]} → ${HANDOFF_ROLE_LABELS[overview.bestSeam.to_iron_role]}` : "—"}
              detail={overview.bestSeam?.avg_composite != null ? `${formatScore(overview.bestSeam.avg_composite)} trust score` : "No scored seam yet"}
            />
            <SummaryCard
              label="Degraded"
              value={`${Math.round(overview.degradedPct * 100)}%`}
              detail="Outcomes marked degraded after handoff"
            />
          </div>

          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-qep-orange" />
              <h2 className="text-sm font-semibold text-foreground">Role seam heatmap</h2>
              <Badge variant="outline" className="text-[10px]">
                worst first
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {seamSummaries.map((seam) => (
                <Card key={seam.key} className="border border-border/60 bg-muted/10 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">
                      {HANDOFF_ROLE_LABELS[seam.from_iron_role]} → {HANDOFF_ROLE_LABELS[seam.to_iron_role]}
                    </div>
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${scoreTone(seam.avg_composite)}`}>
                      {formatScore(seam.avg_composite)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <MetricMini label="Info" value={formatScore(seam.avg_info_completeness)} tone={scoreTone(seam.avg_info_completeness)} />
                    <MetricMini label="Ready" value={formatScore(seam.avg_recipient_readiness)} tone={scoreTone(seam.avg_recipient_readiness)} />
                    <MetricMini label="Result" value={formatScore(seam.avg_outcome_alignment)} tone={scoreTone(seam.avg_outcome_alignment)} />
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {seam.handoff_count} handoffs · {Math.round(seam.improved_pct * 100)}% improved · {Math.round(seam.degraded_pct * 100)}% degraded
                  </p>
                </Card>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-qep-orange" />
              <h2 className="text-sm font-semibold text-foreground">Recent handoffs</h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Seam</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Delay</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((event) => {
                  const evidence = parseHandoffEvidence(event.evidence);
                  return (
                    <TableRow key={event.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(event.handoff_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-foreground">
                        {HANDOFF_ROLE_LABELS[event.from_iron_role]} → {HANDOFF_ROLE_LABELS[event.to_iron_role]}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {(event.handoff_reason ?? "unknown").replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-xs text-foreground">
                        {event.subject_label ?? "Untitled deal"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <span className={`rounded px-2 py-1 text-xs font-semibold ${scoreTone(event.composite_score)}`}>
                            {formatScore(event.composite_score)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatScore(event.info_completeness)}/{formatScore(event.recipient_readiness)}/{formatScore(event.outcome_alignment)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {typeof evidence.hours_to_first_action === "number"
                          ? `${evidence.hours_to_first_action.toFixed(1)}h`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {event.outcome ?? "unknown"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/qrm/deals/${event.subject_id}`}>
                            Open deal <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function MetricMini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/60 p-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone.split(" ")[1]}`}>{value}</div>
    </div>
  );
}
