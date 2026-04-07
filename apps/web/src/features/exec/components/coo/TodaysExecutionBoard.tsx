/**
 * Today's Execution Board — at-risk traffic tickets, blocked equipment,
 * and unresolved rental returns in one scrollable rail. The COO opens
 * the page and sees exactly what is in trouble right now.
 */
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Truck, Wrench, RotateCcw } from "lucide-react";
import { StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";

interface TrafficRow {
  id: string;
  stock_number: string;
  ticket_type: string;
  status: string;
  blocker_reason: string | null;
  promised_delivery_at: string | null;
  to_location: string;
}

export function TodaysExecutionBoard() {
  const { data: atRisk = [] } = useQuery({
    queryKey: ["coo", "at-risk-traffic"],
    queryFn: async (): Promise<TrafficRow[]> => {
      const supa = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            neq: (col: string, val: string) => {
              order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: TrafficRow[] | null; error: unknown }> };
            };
          };
        };
      };
      const res = await supa.from("traffic_tickets")
        .select("id, stock_number, ticket_type, status, blocker_reason, promised_delivery_at, to_location")
        .neq("status", "completed")
        .order("promised_delivery_at", { ascending: true })
        .limit(15);
      if (res.error) return [];
      return res.data ?? [];
    },
    staleTime: 60_000,
  });

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <Truck className="h-3.5 w-3.5 text-orange-400" />
        <p className="text-[11px] uppercase tracking-wider font-semibold text-foreground">Today's execution board</p>
        <span className="ml-auto text-[10px] text-muted-foreground">{atRisk.length} open</span>
      </div>
      {atRisk.length === 0 ? (
        <p className="text-xs text-emerald-400">All open moves on schedule. Nothing in trouble.</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {atRisk.map((row) => {
            const promised = row.promised_delivery_at ? new Date(row.promised_delivery_at) : null;
            const overdue = promised && promised.getTime() < Date.now();
            return (
              <div key={row.id} className="rounded border border-border/60 bg-muted/10 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">
                      {row.stock_number} <span className="font-normal text-muted-foreground">→ {row.to_location}</span>
                    </p>
                    {row.blocker_reason && (
                      <p className="mt-0.5 text-[10px] text-red-400">⚠ {row.blocker_reason}</p>
                    )}
                  </div>
                  <StatusChipStack chips={[
                    { label: row.ticket_type, tone: "neutral" },
                    { label: overdue ? "overdue" : row.status.replace(/_/g, " "), tone: overdue ? "red" : "orange" },
                  ]} />
                </div>
                {promised && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Promised: {promised.toLocaleString()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function InventoryReadinessRail() {
  interface ReadinessRow {
    total_units: number;
    ready_units: number;
    in_prep_units: number;
    blocked_units: number;
    intake_stalled: number;
    ready_rate_pct: number;
  }
  const { data } = useQuery({
    queryKey: ["coo", "readiness"],
    queryFn: async (): Promise<ReadinessRow | null> => {
      const supa = supabase as unknown as {
        from: (t: string) => { select: (c: string) => { limit: (n: number) => Promise<{ data: ReadinessRow[] | null; error: unknown }> } };
      };
      // P0-1 fix (mig 193): use security_invoker wrapper view that filters
      // by workspace + role. Direct MV access is revoked from authenticated.
      const res = await supa.from("exec_inventory_readiness_v").select("*").limit(1);
      if (res.error) return null;
      return res.data?.[0] ?? null;
    },
    staleTime: 5 * 60_000,
  });

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <Wrench className="h-3.5 w-3.5 text-blue-400" />
        <p className="text-[11px] uppercase tracking-wider font-semibold text-foreground">Inventory readiness</p>
      </div>
      {!data ? (
        <p className="text-xs text-muted-foreground">Materialized view empty. Once equipment readiness columns are populated and the snapshot runner refreshes, this rail comes alive.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 text-center">
          <ReadinessTile label="Ready" value={data.ready_units} tone="emerald" />
          <ReadinessTile label="In prep" value={data.in_prep_units} tone="amber" />
          <ReadinessTile label="Blocked" value={data.blocked_units} tone="red" />
          <ReadinessTile label="Intake stalled" value={data.intake_stalled} tone="purple" />
        </div>
      )}
    </Card>
  );
}

function ReadinessTile({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "red" | "purple" }) {
  const toneClass: Record<string, string> = {
    emerald: "text-emerald-400 border-emerald-500/30",
    amber: "text-amber-400 border-amber-500/30",
    red: "text-red-400 border-red-500/30",
    purple: "text-purple-400 border-purple-500/30",
  };
  return (
    <div className={`rounded-md border ${toneClass[tone]} bg-muted/10 p-2`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

export function RecoveryQueuePanel() {
  interface ReturnRow {
    id: string;
    status: string;
    aging_bucket: string | null;
    refund_status: string | null;
    damage_description: string | null;
  }
  const { data: rows = [] } = useQuery({
    queryKey: ["coo", "rental-returns"],
    queryFn: async (): Promise<ReturnRow[]> => {
      const supa = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            neq: (col: string, val: string) => {
              order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: ReturnRow[] | null; error: unknown }> };
            };
          };
        };
      };
      const res = await supa.from("rental_returns")
        .select("id, status, aging_bucket, refund_status, damage_description")
        .neq("status", "completed")
        .order("created_at", { ascending: true })
        .limit(15);
      if (res.error) return [];
      return res.data ?? [];
    },
    staleTime: 60_000,
  });

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <RotateCcw className="h-3.5 w-3.5 text-violet-400" />
        <p className="text-[11px] uppercase tracking-wider font-semibold text-foreground">Recovery queue</p>
        <span className="ml-auto text-[10px] text-muted-foreground">{rows.length} open</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-emerald-400">No rental returns in flight.</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {rows.map((row) => (
            <div key={row.id} className="rounded border border-border/60 bg-muted/10 p-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{row.status.replace(/_/g, " ")}</span>
                <StatusChipStack chips={[
                  ...(row.aging_bucket ? [{ label: row.aging_bucket, tone: "orange" as const }] : []),
                  ...(row.refund_status ? [{ label: `refund:${row.refund_status}`, tone: "blue" as const }] : []),
                ]} />
              </div>
              {row.damage_description && (
                <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">{row.damage_description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
