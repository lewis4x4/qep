import { useMemo, useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PartCrossRefPanel } from "./PartCrossRefPanel";
import { usePartActivity } from "../hooks/usePartActivity";
import type { Database } from "@/lib/database.types";

type CatalogRow = Database["public"]["Tables"]["parts_catalog"]["Row"];

export type BranchCell = {
  qty: number;
  bin: string | null;
  reorderPoint: number | null;
  velocity: number | null;
  daysToStockout: number | null;
  stockStatus: string | null;
  forecastQty: number | null;
  forecastRisk: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  stockout: "bg-red-500",
  critical: "bg-amber-500",
  reorder: "bg-yellow-500",
  healthy: "bg-green-500",
};

const STATUS_LABEL: Record<string, string> = {
  stockout: "Stockout",
  critical: "Critical",
  reorder: "Reorder",
  healthy: "Healthy",
};

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${Number(n).toFixed(2)}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function StatPill({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`rounded-md border px-2.5 py-2 ${tone ?? "bg-muted/40"}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function buildInsight({
  row,
  branches,
  totalStock,
  margin,
  recentCount,
  recentQty,
}: {
  row: CatalogRow;
  branches: Map<string, BranchCell> | undefined;
  totalStock: number;
  margin: number | null;
  recentCount: number;
  recentQty: number;
}): string[] {
  const notes: string[] = [];

  const branchArr = branches ? [...branches.values()] : [];
  const stockouts = branchArr.filter((b) => b.stockStatus === "stockout").length;
  const critical = branchArr.filter((b) => b.stockStatus === "critical").length;
  const reorder = branchArr.filter((b) => b.stockStatus === "reorder").length;
  const healthy = branchArr.filter((b) => b.stockStatus === "healthy").length;
  const branchesCount = branchArr.length;

  if (branchesCount === 0) {
    notes.push("No inventory on hand at any branch. First sale will trigger a purchase order.");
  } else if (stockouts > 0 || critical > 0) {
    notes.push(
      `Urgent: ${stockouts} stockout${stockouts === 1 ? "" : "s"} and ${critical} critical branch${critical === 1 ? "" : "es"} against ${branchesCount} total. Consider a transfer or rush PO.`,
    );
  } else if (reorder > 0) {
    notes.push(`${reorder} branch${reorder === 1 ? "" : "es"} at reorder threshold; remaining ${healthy} healthy.`);
  } else {
    notes.push(`Stock healthy across all ${branchesCount} branch${branchesCount === 1 ? "" : "es"} (${totalStock} ea on hand).`);
  }

  const fastest = branchArr
    .filter((b) => b.daysToStockout != null)
    .sort((a, b) => (a.daysToStockout ?? Infinity) - (b.daysToStockout ?? Infinity))[0];
  if (fastest && fastest.daysToStockout != null && fastest.daysToStockout <= 14) {
    notes.push(
      `Shortest runway is ~${fastest.daysToStockout}d at current velocity ${fastest.velocity?.toFixed(2) ?? "?"}/day.`,
    );
  }

  const nextMonthForecast = branchArr
    .filter((b) => b.forecastQty != null && b.forecastQty > 0)
    .reduce((acc, b) => acc + (b.forecastQty ?? 0), 0);
  if (nextMonthForecast > 0) {
    const highRisk = branchArr.some((b) => b.forecastRisk === "critical" || b.forecastRisk === "high");
    notes.push(
      `Next-month demand forecast: ~${nextMonthForecast.toFixed(0)} units${highRisk ? " — elevated stockout risk" : ""}.`,
    );
  }

  if (recentCount > 0) {
    notes.push(`Last 90 days: ${recentCount} order line${recentCount === 1 ? "" : "s"}, ${recentQty} ea sold.`);
  } else {
    notes.push("No order line activity in the last 90 days — confirm this part is still active.");
  }

  if (row.list_price != null && row.cost_price != null && margin != null) {
    const marginLabel = margin >= 0.4 ? "strong" : margin >= 0.2 ? "standard" : margin > 0 ? "thin" : "negative";
    notes.push(`Margin ${fmtPct(margin)} (${marginLabel}) on ${fmtMoney(row.list_price)} list / ${fmtMoney(row.cost_price)} cost.`);
  } else if (row.list_price == null) {
    notes.push("List price is blank — this part will not quote correctly.");
  } else if (row.cost_price == null) {
    notes.push("Cost is blank — margin cannot be computed.");
  }

  return notes;
}

interface Props {
  row: CatalogRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Map<string, BranchCell> | undefined;
  totalStock: number;
  canMutate: boolean;
}

export function PartCommandPanel({
  row,
  open,
  onOpenChange,
  branches,
  totalStock,
  canMutate,
}: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    description: string;
    category: string;
    manufacturer: string;
    list_price: string;
    cost_price: string;
  }>({ description: "", category: "", manufacturer: "", list_price: "", cost_price: "" });

  useEffect(() => {
    if (row) {
      setDraft({
        description: row.description ?? "",
        category: row.category ?? "",
        manufacturer: row.manufacturer ?? "",
        list_price: row.list_price != null ? String(row.list_price) : "",
        cost_price: row.cost_price != null ? String(row.cost_price) : "",
      });
      setEditing(false);
    }
  }, [row?.id]);

  const activityQ = usePartActivity(row?.part_number ?? null);

  const { margin, recentCount, recentQty } = useMemo(() => {
    const m =
      row?.list_price != null && row?.cost_price != null && Number(row.list_price) > 0
        ? (Number(row.list_price) - Number(row.cost_price)) / Number(row.list_price)
        : null;
    const acts = activityQ.data ?? [];
    return {
      margin: m,
      recentCount: acts.length,
      recentQty: acts.reduce((a, b) => a + (b.quantity ?? 0), 0),
    };
  }, [row?.list_price, row?.cost_price, activityQ.data]);

  const insights = useMemo(() => {
    if (!row) return [];
    return buildInsight({ row, branches, totalStock, margin, recentCount, recentQty });
  }, [row, branches, totalStock, margin, recentCount, recentQty]);

  const save = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No part selected.");
      const patch: Database["public"]["Tables"]["parts_catalog"]["Update"] = {
        description: draft.description.trim() || null,
        category: draft.category.trim() || null,
        manufacturer: draft.manufacturer.trim() || null,
        list_price: draft.list_price.trim() ? Number(draft.list_price) : null,
        cost_price: draft.cost_price.trim() ? Number(draft.cost_price) : null,
      };
      const { error } = await supabase.from("parts_catalog").update(patch).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts-catalog"] });
      setEditing(false);
    },
  });

  const retire = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No part selected.");
      const { error } = await supabase
        .from("parts_catalog")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts-catalog"] });
      onOpenChange(false);
    },
  });

  if (!row) return null;

  const branchArr = branches ? [...branches.entries()].sort(([a], [b]) => a.localeCompare(b)) : [];
  const acts = activityQ.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto"
      >
        <SheetHeader className="pr-8">
          <div className="flex items-center gap-2 flex-wrap">
            <SheetTitle className="font-mono text-xl">{row.part_number}</SheetTitle>
            {row.is_active === false && <Badge variant="outline">Inactive</Badge>}
            {totalStock > 0 ? (
              <Badge variant="secondary" className="tabular-nums">{totalStock} ea on hand</Badge>
            ) : (
              <Badge variant="destructive">No stock</Badge>
            )}
          </div>
          <SheetDescription className="text-left">
            {row.description ?? "No description on file."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatPill label="List" value={fmtMoney(row.list_price)} />
            <StatPill label="Cost" value={fmtMoney(row.cost_price)} />
            <StatPill
              label="Margin"
              value={fmtPct(margin)}
              tone={
                margin == null
                  ? "bg-muted/40"
                  : margin >= 0.4
                  ? "bg-green-500/10 border-green-500/30"
                  : margin >= 0.2
                  ? "bg-muted/40"
                  : margin > 0
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-red-500/10 border-red-500/30"
              }
            />
            <StatPill label="Branches" value={String(branchArr.length)} />
          </div>

          <Card className="p-3 bg-primary/5 border-primary/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1.5">
              Intel
            </p>
            <ul className="space-y-1 text-sm">
              {insights.map((line, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-primary shrink-0">›</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Stock by branch</h3>
              <span className="text-xs text-muted-foreground">{branchArr.length} location{branchArr.length === 1 ? "" : "s"}</span>
            </div>
            {branchArr.length === 0 ? (
              <Card className="p-3 text-sm text-muted-foreground">
                No inventory records for this part.
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {branchArr.map(([branch, cell]) => (
                  <Card key={branch} className="p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                            STATUS_COLOR[cell.stockStatus ?? ""] ?? "bg-muted-foreground/30"
                          }`}
                        />
                        {branch}
                      </span>
                      <span className="tabular-nums font-semibold text-sm">{cell.qty} ea</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground gap-2">
                      <span>{cell.bin ? `Bin ${cell.bin}` : "Bin —"}</span>
                      {cell.stockStatus && (
                        <span>{STATUS_LABEL[cell.stockStatus]}</span>
                      )}
                    </div>
                    {(cell.reorderPoint != null || cell.velocity != null) && (
                      <div className="text-[11px] text-muted-foreground">
                        {cell.reorderPoint != null && <>ROP {cell.reorderPoint}</>}
                        {cell.velocity != null && cell.velocity > 0 && (
                          <span> · {cell.velocity.toFixed(2)}/day</span>
                        )}
                        {cell.daysToStockout != null && (
                          <span
                            className={
                              cell.daysToStockout <= 3
                                ? " text-red-600 dark:text-red-400 font-medium"
                                : cell.daysToStockout <= 7
                                ? " text-amber-600 dark:text-amber-400"
                                : ""
                            }
                          >
                            {" "}· ~{cell.daysToStockout}d runway
                          </span>
                        )}
                      </div>
                    )}
                    {cell.forecastQty != null && cell.forecastQty > 0 && (
                      <div
                        className={`text-[11px] ${
                          cell.forecastRisk === "critical"
                            ? "text-red-600 dark:text-red-400 font-medium"
                            : cell.forecastRisk === "high"
                            ? "text-amber-600 dark:text-amber-400 font-medium"
                            : "text-blue-600 dark:text-blue-400"
                        }`}
                      >
                        Forecast: {cell.forecastQty.toFixed(0)} next month
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>

          <PartCrossRefPanel partNumber={row.part_number} />

          <div>
            <h3 className="text-sm font-semibold mb-2">Recent activity (90d)</h3>
            {activityQ.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading activity…</p>
            ) : acts.length === 0 ? (
              <Card className="p-3 text-sm text-muted-foreground">
                No order lines for this part in the last 90 days.
              </Card>
            ) : (
              <Card className="divide-y divide-border/40">
                {acts.slice(0, 8).map((a) => (
                  <div key={a.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {a.customer_label ?? "—"}
                      </div>
                      <div className="text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString()} · {a.order_status}
                      </div>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      <div className="font-semibold">{a.quantity} ea</div>
                      {a.line_total != null && (
                        <div className="text-muted-foreground">{fmtMoney(a.line_total)}</div>
                      )}
                    </div>
                  </div>
                ))}
                {acts.length > 8 && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    +{acts.length - 8} more…
                  </div>
                )}
              </Card>
            )}
          </div>

          {canMutate && (
            <>
              <Separator />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">Catalog fields</h3>
                  {!editing ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(false)}
                        disabled={save.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => save.mutate()}
                        disabled={save.isPending}
                      >
                        {save.isPending ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  )}
                </div>
                {editing ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="sm:col-span-2">
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Description</label>
                      <Input
                        value={draft.description}
                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Category</label>
                      <Input
                        value={draft.category}
                        onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Manufacturer</label>
                      <Input
                        value={draft.manufacturer}
                        onChange={(e) => setDraft((d) => ({ ...d, manufacturer: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">List price</label>
                      <Input
                        value={draft.list_price}
                        inputMode="decimal"
                        onChange={(e) => setDraft((d) => ({ ...d, list_price: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost price</label>
                      <Input
                        value={draft.cost_price}
                        inputMode="decimal"
                        onChange={(e) => setDraft((d) => ({ ...d, cost_price: e.target.value }))}
                      />
                    </div>
                    {save.isError && (
                      <p className="sm:col-span-2 text-xs text-destructive">
                        {(save.error as Error)?.message ?? "Save failed."}
                      </p>
                    )}
                  </div>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Category</dt>
                    <dd>{row.category ?? "—"}</dd>
                    <dt className="text-muted-foreground">Manufacturer</dt>
                    <dd>{row.manufacturer ?? "—"}</dd>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{new Date(row.created_at).toLocaleDateString()}</dd>
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd>{new Date(row.updated_at).toLocaleDateString()}</dd>
                  </dl>
                )}
              </div>

              <Separator />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Retire ${row.part_number}? It will be hidden from the catalog.`)) {
                      retire.mutate();
                    }
                  }}
                  disabled={retire.isPending}
                >
                  {retire.isPending ? "Retiring…" : "Retire part"}
                </Button>
              </div>
              {retire.isError && (
                <p className="text-xs text-destructive text-right">
                  {(retire.error as Error)?.message ?? "Retire failed."}
                </p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
