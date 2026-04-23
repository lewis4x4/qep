import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PartCommandPanel, type BranchCell } from "../components/PartCommandPanel";
import { usePartsCatalog } from "../hooks/usePartsCatalog";
import { useAuth } from "@/hooks/useAuth";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import type { Database } from "@/lib/database.types";

type CatalogRow = Database["public"]["Tables"]["parts_catalog"]["Row"];

const ELEVATED_ROLES = ["admin", "manager", "owner"];

const STATUS_DOT: Record<string, string> = {
  stockout: "bg-red-500",
  critical: "bg-amber-500",
  reorder: "bg-yellow-500",
  healthy: "bg-green-500",
};

function coalesceRow(rows: CatalogRow[]): CatalogRow {
  return rows.reduce((acc, r) => ({
    ...acc,
    description: acc.description ?? r.description,
    category: acc.category ?? r.category,
    manufacturer: acc.manufacturer ?? r.manufacturer,
    list_price: acc.list_price ?? r.list_price,
    cost_price: acc.cost_price ?? r.cost_price,
    updated_at: acc.updated_at > r.updated_at ? acc.updated_at : r.updated_at,
  }));
}

export function PartsCatalogPage() {
  const { profile } = useAuth();
  const canMutate = ELEVATED_ROLES.includes(profile?.role ?? "");
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  const qc = useQueryClient();
  const catQ = usePartsCatalog();

  const invTotals = useQuery({
    queryKey: ["parts-inventory-totals-by-part"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_inventory")
        .select("part_number, qty_on_hand, branch_id, bin_location")
        .is("deleted_at", null);
      if (error) throw error;

      const reorderMap = new Map<string, { reorder_point: number; consumption_velocity: number }>();
      try {
        const { data: rpData } = await supabase
          .from("parts_reorder_profiles")
          .select("branch_id, part_number, reorder_point, consumption_velocity");
        if (rpData) {
          for (const rp of rpData) {
            const rpKey = `${(rp.part_number as string).toLowerCase()}:${rp.branch_id}`;
            reorderMap.set(rpKey, {
              reorder_point: Number(rp.reorder_point) || 0,
              consumption_velocity: Number(rp.consumption_velocity) || 0,
            });
          }
        }
      } catch { /* pre-migration-136 — ignore */ }

      const forecastMap = new Map<string, { predicted_qty: number; stockout_risk: string }>();
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
        const fc = forecastMap.get(rpKey);
        bm.set(r.branch_id, {
          qty,
          bin,
          reorderPoint,
          velocity,
          daysToStockout,
          stockStatus,
          forecastQty: fc?.predicted_qty ?? null,
          forecastRisk: fc?.stockout_risk ?? null,
        });
      }
      return { totals, byBranch };
    },
    staleTime: 30_000,
  });

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const tableRef = useRef<HTMLTableSectionElement | null>(null);
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

  // Collapse multi-branch catalog duplicates (migration 257 uniques on
  // (workspace, co, div, branch, part#), so a single part_number can appear
  // multiple times). Group by part_number and keep the richest row.
  const deduped = useMemo(() => {
    const rows = (catQ.data ?? []) as CatalogRow[];
    const byPn = new Map<string, CatalogRow[]>();
    for (const r of rows) {
      const key = r.part_number.toLowerCase();
      if (!byPn.has(key)) byPn.set(key, []);
      byPn.get(key)!.push(r);
    }
    const result: Array<{ canonical: CatalogRow; variantCount: number }> = [];
    for (const group of byPn.values()) {
      result.push({ canonical: coalesceRow(group), variantCount: group.length });
    }
    result.sort((a, b) => a.canonical.part_number.localeCompare(b.canonical.part_number));
    return result;
  }, [catQ.data]);

  const filtered = useMemo(() => {
    let rows = deduped;
    const term = q.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        ({ canonical: r }) =>
          r.part_number.toLowerCase().includes(term) ||
          (r.description ?? "").toLowerCase().includes(term) ||
          (r.manufacturer ?? "").toLowerCase().includes(term),
      );
    }
    if (category.trim()) {
      const c = category.trim().toLowerCase();
      rows = rows.filter(({ canonical: r }) => (r.category ?? "").toLowerCase().includes(c));
    }
    return rows;
  }, [deduped, q, category]);

  // Keep focus index within bounds as the filter changes
  useEffect(() => {
    if (focusIndex >= filtered.length) {
      setFocusIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, focusIndex]);

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

  const openPart = useCallback((row: CatalogRow) => {
    setSelectedId(row.id);
    setPanelOpen(true);
  }, []);

  const selectedRow = useMemo(
    () => filtered.find((r) => r.canonical.id === selectedId)?.canonical ?? null,
    [filtered, selectedId],
  );

  const selectedBranches = selectedRow
    ? stockByBranch.get(selectedRow.part_number.toLowerCase())
    : undefined;
  const selectedTotal = selectedRow
    ? stockTotals.get(selectedRow.part_number.toLowerCase()) ?? 0
    : 0;

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (e.key === "/" && !inField && !panelOpen) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (panelOpen) return; // let Sheet handle its own keys
      if (inField) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocusIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const row = filtered[focusIndex]?.canonical;
        if (row) {
          e.preventDefault();
          openPart(row);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, focusIndex, openPart, panelOpen]);

  // Scroll focused row into view
  useEffect(() => {
    if (!tableRef.current) return;
    const el = tableRef.current.querySelector<HTMLElement>(`[data-row-index="${focusIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Parts catalog</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Click any part to open the Command Panel — stock heatmap, demand forecast, substitutes, and inline edit.
          </p>
        </div>
        <div className="text-[11px] text-muted-foreground space-x-2 pt-1">
          <kbd className="border rounded px-1.5 py-0.5 font-mono">/</kbd>
          <span>search</span>
          <kbd className="border rounded px-1.5 py-0.5 font-mono">↑↓</kbd>
          <span>navigate</span>
          <kbd className="border rounded px-1.5 py-0.5 font-mono">Enter</kbd>
          <span>open</span>
        </div>
      </div>

      <CatalogSearchBar
        query={q}
        onQueryChange={setQ}
        category={category}
        onCategoryChange={setCategory}
        canCreate={canMutate}
        creating={creating}
        onToggleCreate={() => setCreating((c) => !c)}
        searchRef={searchRef}
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
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">
          No parts match the current filters.
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
                <TableHead className="text-right">Branches</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody ref={tableRef}>
              {filtered.map(({ canonical: row, variantCount }, idx) => {
                const pk = row.part_number.toLowerCase();
                const total = stockTotals.get(pk);
                const branches = stockByBranch.get(pk);
                const branchCount = branches?.size ?? 0;
                const worstStatus = branches
                  ? [...branches.values()]
                      .map((b) => b.stockStatus)
                      .reduce<string | null>((worst, s) => {
                        const rank = (x: string | null) =>
                          x === "stockout" ? 4 : x === "critical" ? 3 : x === "reorder" ? 2 : x === "healthy" ? 1 : 0;
                        return rank(s) > rank(worst) ? s : worst;
                      }, null)
                  : null;
                const isFocused = idx === focusIndex;
                return (
                  <TableRow
                    key={row.id}
                    data-row-index={idx}
                    tabIndex={0}
                    onClick={() => openPart(row)}
                    onFocus={() => setFocusIndex(idx)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openPart(row);
                      }
                    }}
                    aria-label={`Open ${row.part_number}`}
                    className={`cursor-pointer transition-colors outline-none hover:bg-accent/40 focus-visible:bg-accent/60 ${
                      isFocused ? "bg-accent/30 ring-1 ring-primary/40 ring-inset" : ""
                    }`}
                  >
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center gap-1.5">
                        {worstStatus && (
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                              STATUS_DOT[worstStatus] ?? "bg-muted-foreground/30"
                            }`}
                            aria-label={`Stock ${worstStatus}`}
                          />
                        )}
                        {row.part_number}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm max-w-[240px] truncate">
                      {row.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.category ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{row.manufacturer ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {row.list_price != null ? `$${Number(row.list_price).toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {total != null ? total : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {branchCount > 0 ? branchCount : variantCount > 1 ? `${variantCount}×` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <PartCommandPanel
        row={selectedRow}
        open={panelOpen}
        onOpenChange={setPanelOpen}
        branches={selectedBranches}
        totalStock={selectedTotal}
        canMutate={canMutate}
      />
    </div>
  );
}
