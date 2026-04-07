import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { CatalogSearchBar } from "../components/CatalogSearchBar";
import { PartCrossRefPanel } from "../components/PartCrossRefPanel";
import { usePartsCatalog } from "../hooks/usePartsCatalog";
import { useAuth } from "@/hooks/useAuth";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import type { Database } from "@/lib/database.types";

type CatalogRow = Database["public"]["Tables"]["parts_catalog"]["Row"];

const ELEVATED_ROLES = ["admin", "manager", "owner"];

export function PartsCatalogPage() {
  const { profile } = useAuth();
  const canMutate = ELEVATED_ROLES.includes(profile?.role ?? "");
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  const qc = useQueryClient();
  const catQ = usePartsCatalog();
  type BranchCell = {
    qty: number;
    bin: string | null;
    reorderPoint: number | null;
    velocity: number | null;
    daysToStockout: number | null;
    stockStatus: string | null;
    forecastQty: number | null;
    forecastRisk: string | null;
  };

  const invTotals = useQuery({
    queryKey: ["parts-inventory-totals-by-part"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_inventory")
        .select("part_number, qty_on_hand, branch_id, bin_location")
        .is("deleted_at", null);
      if (error) throw error;

      // Try to load reorder profiles (graceful if migration 136 not applied)
      let reorderMap = new Map<string, { reorder_point: number; consumption_velocity: number; stock_status: string }>();
      try {
        const { data: rpData } = await supabase
          .from("parts_reorder_profiles")
          .select("branch_id, part_number, reorder_point, consumption_velocity");
        if (rpData) {
          for (const rp of rpData) {
            const rpKey = `${(rp.part_number as string).toLowerCase()}:${rp.branch_id}`;
            const vel = Number(rp.consumption_velocity) || 0;
            reorderMap.set(rpKey, {
              reorder_point: Number(rp.reorder_point) || 0,
              consumption_velocity: vel,
              stock_status: "healthy",
            });
          }
        }
      } catch { /* pre-migration-136 — ignore */ }

      // Try to load demand forecasts for next month (graceful if migration 137 not applied)
      let forecastMap = new Map<string, { predicted_qty: number; stockout_risk: string }>();
      try {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);
        const monthStr = nextMonth.toISOString().slice(0, 10);
        const { data: fcData } = await supabase
          .from("parts_demand_forecasts")
          .select("part_number, branch_id, predicted_qty, stockout_risk")
          .eq("forecast_month", monthStr);
        if (fcData) {
          for (const fc of fcData) {
            const fcKey = `${(fc.part_number as string).toLowerCase()}:${fc.branch_id}`;
            forecastMap.set(fcKey, {
              predicted_qty: Number(fc.predicted_qty) || 0,
              stockout_risk: fc.stockout_risk as string,
            });
          }
        }
      } catch { /* pre-migration-137 — ignore */ }

      const totals = new Map<string, number>();
      const byBranch = new Map<string, Map<string, BranchCell>>();
      for (const r of data ?? []) {
        const k = r.part_number.toLowerCase();
        totals.set(k, (totals.get(k) ?? 0) + r.qty_on_hand);
        if (!byBranch.has(k)) byBranch.set(k, new Map());
        const bm = byBranch.get(k)!;
        const prev = bm.get(r.branch_id);
        const qty = (prev?.qty ?? 0) + r.qty_on_hand;
        const bin =
          [r.bin_location?.trim(), prev?.bin?.trim()].find((b) => b && b.length > 0) ?? null;

        const rpKey = `${k}:${r.branch_id}`;
        const rp = reorderMap.get(rpKey);
        const reorderPoint = rp?.reorder_point ?? null;
        const velocity = rp?.consumption_velocity ?? null;
        const daysToStockout = velocity && velocity > 0 ? Math.round(qty / velocity * 10) / 10 : null;
        let stockStatus: string | null = null;
        if (reorderPoint != null) {
          if (qty <= 0) stockStatus = "stockout";
          else if (qty <= Math.ceil(reorderPoint * 0.5)) stockStatus = "critical";
          else if (qty <= reorderPoint) stockStatus = "reorder";
          else stockStatus = "healthy";
        }
        const fcKey = `${k}:${r.branch_id}`;
        const fc = forecastMap.get(fcKey);
        const forecastQty = fc?.predicted_qty ?? null;
        const forecastRisk = fc?.stockout_risk ?? null;
        bm.set(r.branch_id, { qty, bin, reorderPoint, velocity, daysToStockout, stockStatus, forecastQty, forecastRisk });
      }
      return { totals, byBranch };
    },
    staleTime: 30_000,
  });
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedPart, setExpandedPart] = useState<string | null>(null);
  const [newPart, setNewPart] = useState({
    part_number: "",
    description: "",
    category: "",
    manufacturer: "",
    list_price: "",
    cost_price: "",
  });

  const stockTotals = invTotals.data?.totals ?? new Map<string, number>();
  const stockByBranch =
    invTotals.data?.byBranch ?? new Map<string, Map<string, BranchCell>>();

  const filtered = useMemo(() => {
    let rows = (catQ.data ?? []) as CatalogRow[];
    const term = q.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (r) =>
          r.part_number.toLowerCase().includes(term) ||
          (r.description ?? "").toLowerCase().includes(term) ||
          (r.manufacturer ?? "").toLowerCase().includes(term),
      );
    }
    if (category.trim()) {
      const c = category.trim().toLowerCase();
      rows = rows.filter((r) => (r.category ?? "").toLowerCase().includes(c));
    }
    return rows;
  }, [catQ.data, q, category]);

  const upsert = useMutation({
    mutationFn: async (payload: Database["public"]["Tables"]["parts_catalog"]["Insert"]) => {
      if (!workspaceId) throw new Error("Workspace unavailable for catalog write.");
      const { error } = await supabase.from("parts_catalog").upsert(payload, {
        onConflict: "workspace_id,part_number",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts-catalog"] });
      setNewPart({
        part_number: "",
        description: "",
        category: "",
        manufacturer: "",
        list_price: "",
        cost_price: "",
      });
      setCreating(false);
    },
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("parts_catalog")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parts-catalog"] }),
  });

  const onCreate = () => {
    const pn = newPart.part_number.trim();
    if (!pn) return;
    upsert.mutate({
      workspace_id: workspaceId ?? "",
      part_number: pn,
      description: newPart.description.trim() || null,
      category: newPart.category.trim() || null,
      manufacturer: newPart.manufacturer.trim() || null,
      list_price: newPart.list_price ? Number(newPart.list_price) : null,
      cost_price: newPart.cost_price ? Number(newPart.cost_price) : null,
      is_active: true,
    });
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Parts catalog</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Master list with list/cost price; branch stock rolls up from inventory.
        </p>
      </div>

      <CatalogSearchBar
        query={q}
        onQueryChange={setQ}
        category={category}
        onCategoryChange={setCategory}
        canCreate={canMutate}
        creating={creating}
        onToggleCreate={() => setCreating((c) => !c)}
      />

      {creating && (
        <Card className="p-4 space-y-3">
          <p className="text-sm font-medium">New catalog row</p>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            <Input
              placeholder="Part number *"
              value={newPart.part_number}
              onChange={(e) => setNewPart((p) => ({ ...p, part_number: e.target.value }))}
            />
            <Input
              placeholder="Description"
              value={newPart.description}
              onChange={(e) => setNewPart((p) => ({ ...p, description: e.target.value }))}
            />
            <Input
              placeholder="Category"
              value={newPart.category}
              onChange={(e) => setNewPart((p) => ({ ...p, category: e.target.value }))}
            />
            <Input
              placeholder="Manufacturer"
              value={newPart.manufacturer}
              onChange={(e) => setNewPart((p) => ({ ...p, manufacturer: e.target.value }))}
            />
            <Input
              placeholder="List price"
              value={newPart.list_price}
              onChange={(e) => setNewPart((p) => ({ ...p, list_price: e.target.value }))}
            />
            <Input
              placeholder="Cost price"
              value={newPart.cost_price}
              onChange={(e) => setNewPart((p) => ({ ...p, cost_price: e.target.value }))}
            />
          </div>
          <Button type="button" size="sm" onClick={onCreate} disabled={upsert.isPending}>
            Save to catalog
          </Button>
          {upsert.isError && (
            <p className="text-sm text-destructive">
              {(upsert.error as Error)?.message ?? "Catalog save failed."}
            </p>
          )}
        </Card>
      )}

      {invTotals.isError && (
        <Card className="p-3 text-sm text-destructive border-destructive/40">
          {(invTotals.error as Error)?.message ?? "Could not load stock totals."}
        </Card>
      )}

      {softDelete.isError && (
        <Card className="p-3 text-sm text-destructive border-destructive/40">
          {(softDelete.error as Error)?.message ?? "Could not retire catalog row."}
        </Card>
      )}

      {catQ.isLoading ? (
        <div className="flex justify-center py-16" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading catalog</span>
          <div
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        </div>
      ) : catQ.isError ? (
        <Card className="p-4 text-sm text-destructive">
          {(catQ.error as Error)?.message ?? "Failed to load catalog."}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Mfr</TableHead>
                <TableHead className="text-right">List</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                {canMutate && <TableHead className="w-[100px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const pk = row.part_number.toLowerCase();
                const total = stockTotals.get(pk);
                const branches = stockByBranch.get(pk);
                const isExpanded = expandedPart === row.id;
                return (
                  <Fragment key={row.id}>
                    <TableRow>
                      <TableCell className="font-mono text-sm">{row.part_number}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {row.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.category ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{row.manufacturer ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm">
                        {row.list_price != null ? Number(row.list_price).toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {total != null ? (
                          <button
                            type="button"
                            className="underline-offset-2 hover:underline text-primary"
                            onClick={() => setExpandedPart(isExpanded ? null : row.id)}
                          >
                            {total}
                          </button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      {canMutate && (
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => softDelete.mutate(row.id)}
                          >
                            Retire
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    {isExpanded && branches && branches.size > 0 && (
                      <TableRow>
                        <TableCell colSpan={canMutate ? 7 : 6} className="bg-muted/30 py-2 px-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                            {[...branches.entries()]
                              .sort(([a], [b]) => a.localeCompare(b))
                              .map(([branch, cell]) => {
                                const dotColor =
                                  cell.stockStatus === "stockout" ? "bg-red-500" :
                                  cell.stockStatus === "critical" ? "bg-amber-500" :
                                  cell.stockStatus === "reorder" ? "bg-yellow-500" :
                                  cell.stockStatus === "healthy" ? "bg-green-500" :
                                  "bg-muted-foreground/30";
                                return (
                                  <div
                                    key={branch}
                                    className="flex flex-wrap justify-between gap-x-2 gap-y-0.5"
                                  >
                                    <span className="flex items-center gap-1 font-mono text-muted-foreground">
                                      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                                      {branch}
                                    </span>
                                    <span className="tabular-nums font-medium">{cell.qty} ea</span>
                                    <span className="w-full text-[10px] text-muted-foreground sm:w-auto sm:text-xs">
                                      {cell.bin ? `Bin ${cell.bin}` : "Bin —"}
                                    </span>
                                    {(cell.reorderPoint != null || cell.forecastQty != null) && (
                                      <span className="w-full text-[10px] text-muted-foreground">
                                        {cell.reorderPoint != null && (
                                          <>ROP {cell.reorderPoint}</>
                                        )}
                                        {cell.daysToStockout != null && (
                                          <span className={
                                            cell.daysToStockout <= 3 ? " text-red-600 dark:text-red-400 font-medium" :
                                            cell.daysToStockout <= 7 ? " text-amber-600 dark:text-amber-400" : ""
                                          }>
                                            {" "}· ~{cell.daysToStockout}d
                                          </span>
                                        )}
                                        {cell.velocity != null && cell.velocity > 0 && (
                                          <span> · {cell.velocity.toFixed(2)}/day</span>
                                        )}
                                        {cell.forecastQty != null && cell.forecastQty > 0 && (
                                          <span className={
                                            cell.forecastRisk === "critical" ? " text-red-600 dark:text-red-400 font-medium" :
                                            cell.forecastRisk === "high" ? " text-amber-600 dark:text-amber-400 font-medium" :
                                            " text-blue-600 dark:text-blue-400"
                                          }>
                                            {" "}· Forecast: {cell.forecastQty.toFixed(0)} next mo
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                          <div className="mt-2">
                            <PartCrossRefPanel partNumber={row.part_number} />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
