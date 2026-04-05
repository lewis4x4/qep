import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sparkles } from "lucide-react";

type OrderStatus =
  | "draft"
  | "submitted"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

type PortalPartsOrderRow = {
  id: string;
  status: string;
  fulfillment_run_id: string | null;
  line_items: unknown;
  ai_suggested_pm_kit: boolean | null;
  ai_suggestion_reason: string | null;
  tracking_number: string | null;
  estimated_delivery: string | null;
  shipping_address: unknown;
  created_at: string;
  updated_at: string;
  portal_customers:
    | {
        first_name: string;
        last_name: string;
        email: string;
      }
    | null;
  customer_fleet: {
    make: string;
    model: string;
    serial_number: string | null;
  } | null;
};

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

function validNextStatuses(current: string): OrderStatus[] {
  switch (current) {
    case "draft":
      return ["submitted", "confirmed", "cancelled"];
    case "submitted":
      return ["confirmed", "cancelled"];
    case "confirmed":
      return ["processing", "cancelled"];
    case "processing":
      return ["shipped", "cancelled"];
    case "shipped":
      return ["delivered"];
    case "delivered":
    case "cancelled":
      return [];
    default:
      return ["cancelled"];
  }
}

function statusBadgeVariant(
  s: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (s === "delivered") return "default";
  if (s === "cancelled") return "destructive";
  if (s === "shipped" || s === "processing") return "secondary";
  return "outline";
}

export function PortalPartsOrdersPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "open" | "terminal">("open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<Record<string, string>>({});
  const [shipTracking, setShipTracking] = useState<Record<string, string>>({});
  const [shipEta, setShipEta] = useState<Record<string, string>>({});

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["portal-parts-orders-internal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_orders")
        .select(
          `
          id,
          status,
          fulfillment_run_id,
          line_items,
          ai_suggested_pm_kit,
          ai_suggestion_reason,
          tracking_number,
          estimated_delivery,
          shipping_address,
          created_at,
          updated_at,
          portal_customers ( first_name, last_name, email ),
          customer_fleet ( make, model, serial_number )
        `,
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const raw = (data ?? []) as Record<string, unknown>[];
      return raw.map((r) => ({
        ...r,
        portal_customers: one(r.portal_customers as PortalPartsOrderRow["portal_customers"] | unknown[]),
        customer_fleet: one(r.customer_fleet as PortalPartsOrderRow["customer_fleet"] | unknown[]),
      })) as PortalPartsOrderRow[];
    },
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "open") {
      return rows.filter((r) => !["delivered", "cancelled"].includes(r.status));
    }
    return rows.filter((r) => ["delivered", "cancelled"].includes(r.status));
  }, [rows, filter]);

  const updateOrder = useMutation({
    mutationFn: async (payload: {
      id: string;
      status: string;
      tracking_number?: string | null;
      estimated_delivery?: string | null;
    }) => {
      const patch: Record<string, unknown> = { status: payload.status };
      if (payload.tracking_number !== undefined) {
        patch.tracking_number = payload.tracking_number;
      }
      if (payload.estimated_delivery !== undefined) {
        patch.estimated_delivery = payload.estimated_delivery;
      }
      const { error } = await supabase.from("parts_orders").update(patch).eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["portal-parts-orders-internal"] });
      if (variables.status === "shipped") {
        const { error } = await supabase.functions.invoke("parts-order-customer-notify", {
          body: { parts_order_id: variables.id, event: "parts_shipped" },
        });
        if (error) console.warn("parts-order-customer-notify:", error.message);
      }
    },
  });

  const applyStatus = (row: PortalPartsOrderRow) => {
    const next = pendingStatus[row.id] ?? row.status;
    if (!next || next === row.status) return;
    const opts: Parameters<typeof updateOrder.mutate>[0] = {
      id: row.id,
      status: next,
    };
    if (next === "shipped") {
      const tr = shipTracking[row.id]?.trim();
      const eta = shipEta[row.id]?.trim();
      opts.tracking_number = tr || null;
      opts.estimated_delivery = eta || null;
    }
    updateOrder.mutate(opts);
    setPendingStatus((p) => {
      const n = { ...p };
      delete n[row.id];
      return n;
    });
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portal parts orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customer portal drafts and shipments — confirm, pick, ship, track.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            to="/service"
            className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Command center
          </Link>
          <Link
            to="/service/parts"
            className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Parts queue
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["open", "Open"],
            ["all", "All"],
            ["terminal", "Done / cancelled"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            variant={filter === key ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {isError && (
        <Card className="p-6 text-sm text-destructive">Could not load portal parts orders.</Card>
      )}

      {!isLoading && !isError && (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[220px]">Advance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const cust = row.portal_customers;
                const name = cust
                  ? `${cust.first_name} ${cust.last_name}`.trim()
                  : "—";
                const fleet = row.customer_fleet;
                const machine = fleet ? `${fleet.make} ${fleet.model}` : "—";
                const nextOpts = validNextStatuses(row.status);
                const pending = pendingStatus[row.id] ?? row.status;

                return (
                  <Fragment key={row.id}>
                    <TableRow>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>
                          {row.ai_suggested_pm_kit && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                              <Sparkles className="w-3 h-3" /> AI kit
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{name}</div>
                        <div className="text-xs text-muted-foreground">{cust?.email}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{machine}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {nextOpts.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {row.tracking_number ? `Tracking: ${row.tracking_number}` : "—"}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-1 items-center">
                              <select
                                className="h-8 text-xs rounded border border-input bg-background px-2 w-[160px]"
                                value={pending}
                                onChange={(e) =>
                                  setPendingStatus((p) => ({ ...p, [row.id]: e.target.value }))
                                }
                              >
                                <option value={row.status}>{row.status} (no change)</option>
                                {nextOpts.map((s) => (
                                  <option key={s} value={s}>
                                    → {s}
                                  </option>
                                ))}
                              </select>
                              <Button
                                size="sm"
                                className="h-8"
                                disabled={
                                  updateOrder.isPending || !pending || pending === row.status
                                }
                                onClick={() => applyStatus(row)}
                              >
                                Apply
                              </Button>
                            </div>
                            {pending === "shipped" && pending !== row.status && (
                              <div className="flex flex-wrap gap-2">
                                <input
                                  className="h-8 text-xs rounded border border-input bg-background px-2 w-[140px]"
                                  placeholder="Tracking #"
                                  value={shipTracking[row.id] ?? ""}
                                  onChange={(e) =>
                                    setShipTracking((m) => ({ ...m, [row.id]: e.target.value }))
                                  }
                                />
                                <input
                                  type="date"
                                  className="h-8 text-xs rounded border border-input bg-background px-2"
                                  value={shipEta[row.id] ?? ""}
                                  onChange={(e) =>
                                    setShipEta((m) => ({ ...m, [row.id]: e.target.value }))
                                  }
                                />
                              </div>
                            )}
                          </div>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-7 text-xs px-2"
                          onClick={() =>
                            setExpanded((e) => (e === row.id ? null : row.id))
                          }
                        >
                          {expanded === row.id ? "Hide detail" : "View lines"}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30 align-top">
                          {row.ai_suggestion_reason && (
                            <p className="text-xs text-amber-800 dark:text-amber-200/90 mb-2 border-l-2 border-amber-500 pl-2">
                              {row.ai_suggestion_reason}
                            </p>
                          )}
                          {row.fulfillment_run_id && (
                            <p className="text-[11px] text-muted-foreground mb-2 font-mono">
                              Fulfillment run: {row.fulfillment_run_id}
                            </p>
                          )}
                          <pre className="text-[11px] overflow-x-auto p-2 rounded bg-muted/50 max-h-48">
                            {JSON.stringify(row.line_items, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">
                    No orders in this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
