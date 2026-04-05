import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { Plus, Trash2 } from "lucide-react";

type LineDraft = { part_number: string; quantity: number };

export function PortalPartsPage() {
  const qc = useQueryClient();
  const [lines, setLines] = useState<LineDraft[]>([{ part_number: "", quantity: 1 }]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "parts-orders"],
    queryFn: portalApi.getPartsOrders,
    staleTime: 20_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.createPartsOrder(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal", "parts-orders"] });
      setLines([{ part_number: "", quantity: 1 }]);
    },
  });

  const orders = data?.orders ?? [];

  const addLine = () => setLines((prev) => [...prev, { part_number: "", quantity: 1 }]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const submit = () => {
    const line_items = lines
      .map((l) => ({
        part_number: l.part_number.trim(),
        quantity: Math.max(1, Math.floor(Number(l.quantity)) || 1),
      }))
      .filter((l) => l.part_number.length > 0);
    if (line_items.length === 0) return;
    createMutation.mutate({ line_items });
  };

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Parts orders</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Request parts for your fleet. Orders start as draft until the dealership confirms.
      </p>

      <Card className="p-4 mb-6 space-y-3">
        <p className="text-sm font-medium text-foreground">New order</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground">Part #</label>
              <input
                value={line.part_number}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, part_number: e.target.value } : row)),
                  )
                }
                className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                placeholder="SKU / part number"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-muted-foreground">Qty</label>
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((row, j) =>
                      j === i ? { ...row, quantity: Number(e.target.value) || 1 } : row,
                    ),
                  )
                }
                className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
              />
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="Remove line">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4 mr-1" /> Add line
          </Button>
          <Button size="sm" onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Submitting…" : "Submit draft order"}
          </Button>
        </div>
        {createMutation.isError && (
          <p className="text-sm text-destructive">
            {createMutation.error instanceof Error ? createMutation.error.message : "Could not create order"}
          </p>
        )}
      </Card>

      {isLoading && (
        <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Card key={i} className="h-20 animate-pulse" />)}</div>
      )}
      {isError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-400">Failed to load orders. Sign in with your portal account.</p>
        </Card>
      )}

      <div className="space-y-2">
        {orders.map((o: Record<string, unknown>) => (
          <Card key={o.id as string} className="p-4">
            <div className="flex justify-between gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground capitalize">{String(o.status ?? "")}</span>
              <span className="text-xs text-muted-foreground">
                {o.created_at ? new Date(String(o.created_at)).toLocaleString() : ""}
              </span>
            </div>
            <pre className="mt-2 text-[10px] bg-muted/40 rounded p-2 overflow-x-auto max-h-24">
              {JSON.stringify(o.line_items, null, 2)}
            </pre>
          </Card>
        ))}
        {!isLoading && orders.length === 0 && (
          <Card className="border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No parts orders yet.</p>
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
