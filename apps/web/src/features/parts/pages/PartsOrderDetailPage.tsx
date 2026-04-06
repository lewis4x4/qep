import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PartsSubNav } from "../components/PartsSubNav";
import { OrderStatusBadge } from "../components/OrderStatusBadge";
import { validNextStatuses } from "../lib/order-status-machine";
import {
  invokeSubmitInternalOrder,
  invokeAdvanceStatus,
  invokePickOrderLine,
} from "../lib/parts-api";

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

export function PartsOrderDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [shipTracking, setShipTracking] = useState("");
  const [shipEta, setShipEta] = useState("");
  const [shipNotifyError, setShipNotifyError] = useState<string | null>(null);
  const [pickBranch, setPickBranch] = useState("");

  const orderQ = useQuery({
    queryKey: ["parts-order-detail", id],
    enabled: id.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_orders")
        .select(
          `
          *,
          portal_customers!parts_orders_portal_customer_id_fkey ( first_name, last_name, email ),
          crm_companies!parts_orders_crm_company_id_fkey ( id, name )
        `,
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const linesQ = useQuery({
    queryKey: ["parts-order-lines", id],
    enabled: id.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_order_lines")
        .select("*")
        .eq("parts_order_id", id)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const advanceStatus = useMutation({
    mutationFn: async (payload: {
      status: string;
      tracking_number?: string | null;
      estimated_delivery?: string | null;
    }) => {
      return invokeAdvanceStatus(id, payload.status, {
        tracking_number: payload.tracking_number,
        estimated_delivery: payload.estimated_delivery,
      });
    },
    onSuccess: async (_data, variables) => {
      await qc.invalidateQueries({ queryKey: ["parts-order-detail", id] });
      await qc.invalidateQueries({ queryKey: ["parts-orders-all"] });
      if (variables.status !== "shipped") {
        setShipNotifyError(null);
        return;
      }
      setShipNotifyError(null);
      const { error: fnErr } = await supabase.functions.invoke("parts-order-customer-notify", {
        body: { parts_order_id: id, event: "parts_shipped" },
      });
      if (fnErr) {
        setShipNotifyError(fnErr.message ?? "Shipment notification request failed.");
      }
    },
  });

  const submitMut = useMutation({
    mutationFn: async () => invokeSubmitInternalOrder(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["parts-order-detail", id] });
      await qc.invalidateQueries({ queryKey: ["parts-orders-all"] });
    },
  });

  const pickMut = useMutation({
    mutationFn: async (lineId: string) => {
      if (!pickBranch.trim()) throw new Error("Enter a branch to pick from");
      return invokePickOrderLine(id, lineId, pickBranch.trim());
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["parts-order-detail", id] });
      await qc.invalidateQueries({ queryKey: ["parts-order-lines", id] });
    },
  });

  const row = orderQ.data as Record<string, unknown> | null | undefined;
  const portal = one(row?.portal_customers as object | object[] | null) as {
    first_name?: string;
    last_name?: string;
    email?: string;
  } | null;
  const crm = one(row?.crm_companies as object | object[] | null) as {
    id?: string;
    name?: string;
  } | null;

  const status = typeof row?.status === "string" ? row.status : "";
  const nextOpts = validNextStatuses(status);
  const fulfillmentRunId =
    typeof row?.fulfillment_run_id === "string" ? row.fulfillment_run_id : null;
  const orderSource = typeof row?.order_source === "string" ? row.order_source : "portal";
  const isInternalDraft =
    status === "draft" && orderSource !== "portal" && row?.crm_company_id;
  const canPick = ["confirmed", "processing"].includes(status);

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/parts/orders"
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2"
        >
          ← All orders
        </Link>
      </div>

      {orderQ.isLoading && (
        <div className="flex justify-center py-16" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading order</span>
          <div
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        </div>
      )}

      {orderQ.isError && (
        <Card className="p-4 text-sm text-destructive">
          {(orderQ.error as Error)?.message ?? "Failed to load order."}
        </Card>
      )}

      {row && (
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Parts order</h1>
            <p className="text-xs font-mono text-muted-foreground mt-1">{String(row.id)}</p>
          </div>

          {shipNotifyError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              Shipment email: {shipNotifyError}
            </div>
          )}

          <Card className="p-4 space-y-2 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <OrderStatusBadge status={status} />
              <Badge variant="outline">{orderSource}</Badge>
            </div>
            <p>
              <span className="text-muted-foreground">Customer: </span>
              {portal
                ? `${portal.first_name ?? ""} ${portal.last_name ?? ""} (${portal.email})`
                : crm?.name ?? "—"}
            </p>
            {fulfillmentRunId && (
              <p>
                <span className="text-muted-foreground">Fulfillment run: </span>
                <Link
                  className="text-primary underline-offset-2 hover:underline font-mono text-xs"
                  to={`/parts/fulfillment/${fulfillmentRunId}`}
                >
                  {fulfillmentRunId}
                </Link>
              </p>
            )}
          </Card>

          {isInternalDraft && (
            <Card className="p-4">
              <p className="text-sm mb-2">This draft is ready to hand off to the shop.</p>
              <Button
                type="button"
                size="sm"
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending}
              >
                Submit to fulfillment
              </Button>
              {submitMut.error && (
                <p className="text-sm text-destructive mt-2">{(submitMut.error as Error).message}</p>
              )}
            </Card>
          )}

          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-medium">Advance status</h2>
            {nextOpts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Terminal state.</p>
            ) : (
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  className="h-9 text-sm rounded border border-input bg-background px-2 min-w-[180px]"
                  value={pendingStatus ?? status}
                  onChange={(e) => setPendingStatus(e.target.value)}
                >
                  <option value={status}>{status} (current)</option>
                  {nextOpts.map((s) => (
                    <option key={s} value={s}>
                      → {s}
                    </option>
                  ))}
                </select>
                {(pendingStatus ?? status) === "shipped" && (pendingStatus ?? status) !== status && (
                  <div className="flex flex-wrap gap-2 w-full">
                    <InputLike
                      placeholder="Tracking #"
                      value={shipTracking}
                      onChange={setShipTracking}
                    />
                    <InputLike placeholder="ETA (YYYY-MM-DD)" value={shipEta} onChange={setShipEta} />
                  </div>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    advanceStatus.isPending ||
                    !(pendingStatus && pendingStatus !== status)
                  }
                  onClick={() => {
                    const next = pendingStatus ?? status;
                    if (!next || next === status) return;
                    advanceStatus.mutate({
                      status: next,
                      tracking_number: next === "shipped" ? shipTracking.trim() || null : undefined,
                      estimated_delivery: next === "shipped" ? shipEta.trim() || null : undefined,
                    });
                    setPendingStatus(null);
                  }}
                >
                  Apply
                </Button>
              </div>
            )}
            {advanceStatus.isError && (
              <p className="text-sm text-destructive">
                {(advanceStatus.error as Error)?.message ?? "Status update failed."}
              </p>
            )}
          </Card>

          <Card className="overflow-x-auto">
            <div className="flex items-center justify-between p-4 pb-2">
              <h2 className="text-sm font-medium">Line items</h2>
              {canPick && (
                <div className="flex items-center gap-2">
                  <Input
                    className="w-[120px] text-xs h-8"
                    placeholder="Branch"
                    value={pickBranch}
                    onChange={(e) => setPickBranch(e.target.value)}
                  />
                </div>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part #</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Line</TableHead>
                  {canPick && <TableHead className="w-[90px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {linesQ.isError ? (
                  <TableRow>
                    <TableCell
                      colSpan={canPick ? 5 : 4}
                      className="text-sm text-destructive p-4"
                    >
                      {(linesQ.error as Error)?.message ?? "Could not load line items."}
                    </TableCell>
                  </TableRow>
                ) : linesQ.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={canPick ? 5 : 4}
                      className="text-xs text-muted-foreground p-4"
                    >
                      Loading line items…
                    </TableCell>
                  </TableRow>
                ) : (linesQ.data ?? []).length > 0 ? (
                  linesQ.data!.map((ln) => (
                    <TableRow key={ln.id}>
                      <TableCell className="font-mono text-sm">{ln.part_number}</TableCell>
                      <TableCell>{ln.quantity}</TableCell>
                      <TableCell className="text-right">
                        {ln.unit_price != null ? Number(ln.unit_price).toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {ln.line_total != null ? Number(ln.line_total).toFixed(2) : "—"}
                      </TableCell>
                      {canPick && (
                        <TableCell>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="text-xs"
                            disabled={pickMut.isPending || !pickBranch.trim()}
                            onClick={() => pickMut.mutate(ln.id)}
                          >
                            Pick
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={canPick ? 5 : 4} className="text-xs text-muted-foreground p-4 font-mono break-all">
                      {row.line_items != null
                        ? JSON.stringify(row.line_items)
                        : "No lines"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {pickMut.isError && (
              <p className="px-4 pb-3 text-sm text-destructive">
                {(pickMut.error as Error)?.message ?? "Pick failed."}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function InputLike({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      className="h-9 text-xs rounded border border-input bg-background px-2 w-[160px]"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
