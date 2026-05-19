import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Flame, Bug, Sparkles, AlertOctagon, Lightbulb, Clock, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import {
  updateFlareStatus,
  type FlareBoardStatus,
  type FlarePriority,
} from "@/lib/flare/flareClient";

const db = supabase as SupabaseClient<Database>;

type FlareRow = Database["public"]["Tables"]["flare_reports"]["Row"];

interface BoardRollups {
  reportedThisWeek: number;
  shippedThisWeek: number;
  avgFixHours: number | null;
}

interface ColumnDef {
  key: FlareBoardStatus;
  /**
   * Statuses that should *render* in this column. We collapse 'investigating'
   * into the Fixing lane per the build spec; needs_info + duplicate are
   * surfaced only from the drawer.
   */
  bucketed: FlareBoardStatus[];
  label: string;
  tone: "blue" | "purple" | "orange" | "green" | "neutral";
}

const COLUMNS: ColumnDef[] = [
  { key: "new",          bucketed: ["new"],                              label: "New",          tone: "blue" },
  { key: "acknowledged", bucketed: ["acknowledged"],                     label: "Acknowledged", tone: "purple" },
  { key: "fixing",       bucketed: ["fixing", "investigating"],          label: "Fixing",       tone: "orange" },
  { key: "shipped",      bucketed: ["shipped"],                          label: "Shipped",      tone: "green" },
  { key: "verified",     bucketed: ["verified"],                         label: "Verified",     tone: "green" },
  { key: "wont_fix",     bucketed: ["wont_fix"],                         label: "Won't fix",    tone: "neutral" },
];

const SEVERITY_META: Record<string, { emoji: string; tone: "red" | "orange" | "yellow" | "blue" | "neutral" }> = {
  blocker:  { emoji: "🚨", tone: "red" },
  bug:      { emoji: "🐛", tone: "orange" },
  annoyance:{ emoji: "⚠️", tone: "yellow" },
  idea:     { emoji: "✨", tone: "blue" },
};

const STATUS_DROPDOWN: { value: FlareBoardStatus; label: string }[] = [
  { value: "new",           label: "New" },
  { value: "acknowledged",  label: "Acknowledged" },
  { value: "investigating", label: "Investigating" },
  { value: "fixing",        label: "Fixing" },
  { value: "shipped",       label: "Shipped" },
  { value: "verified",      label: "Verified" },
  { value: "wont_fix",      label: "Won't fix" },
  { value: "duplicate",     label: "Duplicate" },
  { value: "needs_info",    label: "Needs info" },
];

const PRIORITY_OPTIONS: { value: FlarePriority; label: string; tone: "neutral" | "blue" | "yellow" | "red" }[] = [
  { value: "low",    label: "Low",    tone: "neutral" },
  { value: "medium", label: "Medium", tone: "blue" },
  { value: "high",   label: "High",   tone: "yellow" },
  { value: "urgent", label: "Urgent", tone: "red" },
];

function ageLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

interface BoardData {
  reports: FlareRow[];
  rollups: BoardRollups;
}

const EMPTY_ROLLUPS: BoardRollups = {
  reportedThisWeek: 0,
  shippedThisWeek: 0,
  avgFixHours: null,
};

async function loadBoardData(): Promise<BoardData> {
  const [reportsRes, rollupsRes] = await Promise.all([
    db.from("flare_reports").select("*").order("status_updated_at", { ascending: false, nullsFirst: false }).limit(500),
    // Single round-trip aggregate from the public.flare_board_rollups RPC.
    // Replaces fetching up to 2000 history rows client-side every refetch.
    (db as unknown as {
      rpc: (fn: "flare_board_rollups") => Promise<{
        data: Array<{ reported_this_week: number; shipped_this_week: number; avg_fix_hours: number | null }> | null;
        error: { message?: string } | null;
      }>;
    }).rpc("flare_board_rollups"),
  ]);
  if (reportsRes.error) throw new Error(reportsRes.error.message || "load_reports_failed");

  const rollupRow = rollupsRes.data?.[0] ?? null;
  const rollups: BoardRollups = rollupRow
    ? {
      reportedThisWeek: Number(rollupRow.reported_this_week) || 0,
      shippedThisWeek: Number(rollupRow.shipped_this_week) || 0,
      avgFixHours: rollupRow.avg_fix_hours == null ? null : Number(rollupRow.avg_fix_hours),
    }
    : EMPTY_ROLLUPS;

  return {
    reports: (reportsRes.data ?? []) as FlareRow[],
    rollups,
  };
}

function fmtFixTime(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function FlareBoardPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<FlareRow | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["flare-board"],
    queryFn: loadBoardData,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const rollups = data?.rollups ?? EMPTY_ROLLUPS;

  const grouped = useMemo(() => {
    const map = new Map<FlareBoardStatus, FlareRow[]>();
    for (const col of COLUMNS) map.set(col.key, []);
    const bucketIndex = new Map<string, FlareBoardStatus>();
    for (const col of COLUMNS) for (const b of col.bucketed) bucketIndex.set(b, col.key);
    for (const r of data?.reports ?? []) {
      const bucket = bucketIndex.get(r.status as FlareBoardStatus);
      if (!bucket) continue;
      map.get(bucket)!.push(r);
    }
    return map;
  }, [data]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-3 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Quality Center</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Bug, idea, and annoyance triage board. Every report fires email to engineering + the right owner.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/flare">← List view</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="flare-board-rollups">
        <Card className="flex items-center gap-3 p-3">
          <Bug className="h-5 w-5 text-orange-500" aria-hidden />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reported this week</p>
            <p className="text-lg font-bold text-foreground">{rollups.reportedThisWeek}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Shipped this week</p>
            <p className="text-lg font-bold text-foreground">{rollups.shippedThisWeek}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-3">
          <Clock className="h-5 w-5 text-blue-500" aria-hidden />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg fix time</p>
            <p className="text-lg font-bold text-foreground">{fmtFixTime(rollups.avgFixHours)}</p>
          </div>
        </Card>
      </div>

      {isLoading && (
        <Card className="p-6 text-center text-xs text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" aria-hidden />
          Loading flare board…
        </Card>
      )}

      {isError && (
        <Card className="border-destructive p-6 text-center text-xs text-destructive">
          <AlertOctagon className="mx-auto mb-2 h-5 w-5" aria-hidden />
          {error instanceof Error ? error.message : "Failed to load flares."}
        </Card>
      )}

      {!isLoading && !isError && (data?.reports.length ?? 0) === 0 && (
        <Card className="border-dashed p-8 text-center" data-testid="flare-board-empty">
          <Lightbulb className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm text-foreground">No flares yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Press <kbd className="rounded bg-muted px-1 text-[10px]">⌘+⇧+B</kbd> anywhere to file the first one.
          </p>
        </Card>
      )}

      {!isLoading && !isError && (data?.reports.length ?? 0) > 0 && (
        <div
          className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          data-testid="flare-board-columns"
        >
          {COLUMNS.map((col) => {
            const items = grouped.get(col.key) ?? [];
            return (
              <div key={col.key} className="flex min-h-[100px] flex-col gap-2" data-testid={`flare-column-${col.key}`}>
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">{col.label}</span>
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2" data-testid={`flare-column-cards-${col.key}`}>
                  {items.length === 0 && (
                    <div className="rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-[10px] text-muted-foreground">
                      No flares
                    </div>
                  )}
                  {items.map((r) => (
                    <BoardCard key={r.id} report={r} onOpen={() => setSelected(r)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FlareBoardDrawer
        report={selected}
        onClose={() => setSelected(null)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["flare-board"] });
          queryClient.invalidateQueries({ queryKey: ["flare-admin-queue"] });
        }}
      />
    </div>
  );
}

interface BoardCardProps {
  report: FlareRow;
  onOpen: () => void;
}

function BoardCard({ report, onOpen }: BoardCardProps) {
  const sev = SEVERITY_META[report.severity] ?? { emoji: "•", tone: "neutral" as const };
  const ownerSummary = truncate(report.owner_summary, 80);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-md border border-border bg-card p-2.5 text-left transition hover:border-qep-orange hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange"
      data-testid="flare-board-card"
    >
      <div className="flex items-center gap-1.5">
        <StatusChipStack chips={[{ label: `${sev.emoji} ${report.severity}`, tone: sev.tone }]} />
        {report.priority && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {report.priority}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{ageLabel(report.created_at)}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-medium text-foreground">{report.user_description}</p>
      {ownerSummary && (
        <p className="mt-1 rounded bg-blue-500/5 px-1.5 py-1 text-[10px] italic text-blue-300/90">
          {ownerSummary}
        </p>
      )}
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate">{report.reporter_email ?? "unknown"}</span>
        <code className="ml-2 max-w-[60%] truncate font-mono text-[9px]">{report.route ?? "—"}</code>
      </div>
      {report.eta_date && (
        <div className="mt-1 text-[10px] text-amber-400">ETA {report.eta_date}</div>
      )}
    </button>
  );
}

interface DrawerProps {
  report: FlareRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function FlareBoardDrawer({ report, onClose, onSaved }: DrawerProps) {
  const [draftStatus, setDraftStatus] = useState<FlareBoardStatus | null>(null);
  const [draftSummary, setDraftSummary] = useState<string>("");
  const [draftEta, setDraftEta] = useState<string>("");
  const [draftPriority, setDraftPriority] = useState<FlarePriority | "">("");
  const [draftNote, setDraftNote] = useState<string>("");

  // Reset draft when the selection changes.
  useMemo(() => {
    if (report) {
      setDraftStatus(report.status as FlareBoardStatus);
      setDraftSummary(report.owner_summary ?? "");
      setDraftEta(report.eta_date ?? "");
      setDraftPriority((report.priority as FlarePriority | null) ?? "");
      setDraftNote("");
    }
    return null;
  }, [report?.id]);

  const screenshotQuery = useQuery({
    enabled: !!report?.id && !!report?.screenshot_path,
    queryKey: ["flare-board-screenshot", report?.id],
    queryFn: async () => {
      if (!report?.screenshot_path) return null;
      const { data } = await supabase.storage.from("flare-artifacts").createSignedUrl(report.screenshot_path, 3600);
      return data?.signedUrl ?? null;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!report || !draftStatus) throw new Error("nothing to save");
      await updateFlareStatus({
        flare_id: report.id,
        status: draftStatus,
        eta_date: draftEta || null,
        owner_summary: draftSummary || null,
        priority: draftPriority || null,
        note: draftNote || null,
      });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  if (!report) return null;

  return (
    <Sheet open={!!report} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />
            Flare detail
          </SheetTitle>
          <SheetDescription>
            Reported {new Date(report.created_at).toLocaleString()} by {report.reporter_email ?? "unknown"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <Card className="p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{report.user_description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>Route: <code className="font-mono">{report.route ?? "—"}</code></span>
              <span>Severity: <strong className="text-foreground">{report.severity}</strong></span>
            </div>
          </Card>

          {screenshotQuery.data && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={screenshotQuery.data}
              alt="Flare screenshot"
              className="w-full rounded-md border border-border"
              style={{ maxHeight: "40vh", objectFit: "contain" }}
            />
          )}

          <Card className="space-y-3 p-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="flare-status">Status</label>
              <select
                id="flare-status"
                value={draftStatus ?? ""}
                onChange={(e) => setDraftStatus(e.target.value as FlareBoardStatus)}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                {STATUS_DROPDOWN.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Priority</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    type="button"
                    key={p.value}
                    onClick={() => setDraftPriority(draftPriority === p.value ? "" : p.value)}
                    className={
                      "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition " +
                      (draftPriority === p.value
                        ? "border-qep-orange bg-qep-orange/15 text-qep-orange"
                        : "border-border bg-card text-muted-foreground hover:text-foreground")
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="flare-eta">ETA</label>
              <input
                id="flare-eta"
                type="date"
                value={draftEta}
                onChange={(e) => setDraftEta(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="flare-owner-summary">
                Owner summary (plain-English)
              </label>
              <textarea
                id="flare-owner-summary"
                value={draftSummary}
                onChange={(e) => setDraftSummary(e.target.value)}
                rows={3}
                placeholder="e.g. We found the cause — fix is in QA and ships tomorrow morning."
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground" htmlFor="flare-note">
                Internal note (optional, appears in history)
              </label>
              <textarea
                id="flare-note"
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                rows={2}
                placeholder="Short note for the audit trail"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={saveMutation.isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !draftStatus}
              >
                {saveMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowRight className="mr-1 h-3 w-3" />}
                Save changes
              </Button>
            </div>
            {saveMutation.isError && (
              <p className="text-xs text-destructive">
                {saveMutation.error instanceof Error ? saveMutation.error.message : "Save failed"}
              </p>
            )}
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}
