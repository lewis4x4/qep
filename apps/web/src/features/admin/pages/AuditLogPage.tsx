import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequireAdmin } from "@/components/RequireAdmin";
import {
  getRecentAuditEvents,
  auditTableLabel,
  summarizeRecord,
  AUDIT_TABLES,
  type AuditEvent,
  type AuditTable,
  type AuditAction,
  type AuditFilter,
} from "../lib/audit-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortActor(id: string | null, email: string | null): string {
  if (email) return email;
  if (!id) return "system";
  return id.slice(0, 8) + "…";
}

function actionVariant(a: AuditAction): "success" | "info" | "destructive" {
  if (a === "insert") return "success";
  if (a === "update") return "info";
  return "destructive";
}

// ── Filter bar ────────────────────────────────────────────────────────────────

type DaysFilter = "7" | "30" | "all";
type ActionFilter = "all" | AuditAction;

const DAY_FILTERS: readonly DaysFilter[] = ["7", "30", "all"];
const ACTION_FILTERS: readonly ActionFilter[] = ["all", "insert", "update", "delete"];

// ── Expanded row ──────────────────────────────────────────────────────────────

function ExpandedRow({ event }: { event: AuditEvent }) {
  const changedEntries = event.changed_fields
    ? Object.entries(event.changed_fields).filter(([k]) => k !== "updated_at")
    : [];

  return (
    <tr>
      <td colSpan={6} className="border-b bg-muted/30 px-4 py-3">
        <div className="space-y-2 text-xs">
          <div>
            <span className="font-medium text-muted-foreground">Record id:</span>{" "}
            <span className="font-mono">{event.record_id}</span>
          </div>
          {event.action === "update" && changedEntries.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">Changed fields:</div>
              <ul className="space-y-1 font-mono">
                {changedEntries.map(([key, { old, new: n }]) => (
                  <li key={key}>
                    <span className="text-muted-foreground">{key}:</span>{" "}
                    <span className="text-destructive line-through">{JSON.stringify(old)}</span>{" "}
                    <span className="text-success-foreground">→ {JSON.stringify(n)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {event.snapshot && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                Full snapshot
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[10px]">
                {JSON.stringify(event.snapshot, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AuditLogPage() {
  return (
    <RequireAdmin>
      <AuditLogPageInner />
    </RequireAdmin>
  );
}

function AuditLogPageInner() {
  const [days, setDays]           = useState<DaysFilter>("7");
  const [action, setAction]       = useState<ActionFilter>("all");
  const [tables, setTables]       = useState<AuditTable[]>([...AUDIT_TABLES]);
  const [events, setEvents]       = useState<AuditEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filter: AuditFilter = useMemo(() => ({
    daysBack: days === "all" ? null : parseInt(days),
    tables,
    action: action === "all" ? null : action,
  }), [days, action, tables]);

  useEffect(() => {
    setLoading(true);
    getRecentAuditEvents(filter).then((data) => {
      setEvents(data);
      setLoading(false);
    });
  }, [filter]);

  function toggleTable(t: AuditTable) {
    setTables((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t);
      return [...prev, t];
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Who edited what, when. Covers price sheets, quotes, deals, brands, equipment models,
          attachments, and programs. New entries appear automatically as edits land.
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Period:</span>
          {DAY_FILTERS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                days === d ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {d === "7" ? "Last 7d" : d === "30" ? "Last 30d" : "All time"}
            </button>
          ))}
          <span className="ml-4 text-muted-foreground">Action:</span>
          {ACTION_FILTERS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className={`rounded-md px-3 py-1 text-sm capitalize transition-colors ${
                action === a ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Tables:</span>
          {AUDIT_TABLES.map((t) => {
            const active = tables.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTable(t)}
                className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize transition-colors ${
                  active
                    ? "bg-primary/90 text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {auditTableLabel(t)}
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No audit events in selected range.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2">Time</th>
                      <th className="px-4 py-2">Actor</th>
                      <th className="px-4 py-2">Table</th>
                      <th className="px-4 py-2">Action</th>
                      <th className="px-4 py-2">Record</th>
                      <th className="px-4 py-2" aria-hidden />
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => {
                      const isExpanded = expandedId === e.id;
                      return (
                        <>
                          <tr
                            key={e.id}
                            className="cursor-pointer border-b transition-opacity hover:bg-muted/20"
                            onClick={() => setExpandedId(isExpanded ? null : e.id)}
                          >
                            <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                              {fmtDate(e.created_at)}
                            </td>
                            <td className="px-4 py-2 text-xs">{shortActor(e.actor_id, e.actor_email)}</td>
                            <td className="px-4 py-2 text-xs font-medium capitalize">
                              {auditTableLabel(e.table)}
                            </td>
                            <td className="px-4 py-2">
                              <Badge variant={actionVariant(e.action)} className="text-[10px] capitalize">
                                {e.action}
                              </Badge>
                            </td>
                            <td className="px-4 py-2 text-xs">{summarizeRecord(e)}</td>
                            <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                              {isExpanded ? "▾" : "▸"}
                            </td>
                          </tr>
                          {isExpanded && <ExpandedRow key={`${e.id}-expanded`} event={e} />}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                Showing {events.length} event(s) — capped at 100 per table
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
