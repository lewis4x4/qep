import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { PartCommandPanel, type BranchCell } from "../components/PartCommandPanel";
import type { CatalogRow } from "../hooks/usePartsCatalog";
import { useAuth } from "@/hooks/useAuth";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import type { Database } from "@/lib/database.types";

const ELEVATED_ROLES = ["admin", "manager", "owner"];
const PAGE_SIZE = 100;

const STATUS_DOT: Record<string, string> = {
  stockout: "bg-red-500",
  critical: "bg-amber-500",
  reorder: "bg-yellow-500",
  healthy: "bg-green-500",
};

/**
 * N7.1 (RF-011): server-paginated catalog row from list_parts_catalog_page.
 * The dedup across multi-branch duplicates, the inventory/reorder/forecast
 * joins, and the worst-stock-status ranking all happen in the RPC — the
 * old page pulled four whole tables to the browser and was silently
 * truncated at PostgREST max_rows=1000 (the catalog is past 4k rows).
 */
interface CatalogPageRow {
  id: string;
  part_number: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  list_price: number | null;
  cost_price: number | null;
  updated_at: string;
  variant_count: number;
  total_qty: number;
  branch_count: number;
  worst_status: string | null;
  total_count: number;
}

interface BranchDetailRow {
  branch_id: string;
  qty: number | null;
  bin: string | null;
  reorder_point: number | null;
  velocity: number | null;
  days_to_stockout: number | null;
  stock_status: string | null;
  forecast_qty: number | null;
  forecast_risk: string | null;
}

function toCatalogRow(row: CatalogPageRow): CatalogRow {
  return {
    id: row.id,
    part_number: row.part_number,
    description: row.description,
    category: row.category,
    manufacturer: row.manufacturer,
    list_price: row.list_price,
    cost_price: row.cost_price,
    updated_at: row.updated_at,
  } as CatalogRow;
}

export function PartsCatalogPage() {
  const { profile } = useAuth();
  const canMutate = ELEVATED_ROLES.includes(profile?.role ?? "");
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [debouncedCategory, setDebouncedCategory] = useState("");
  const [page, setPage] = useState(0);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setDebouncedCategory(category.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, category]);

  const catalogPage = useQuery({
    queryKey: ["parts-catalog-page", debouncedQ, debouncedCategory, page],
    queryFn: async (): Promise<CatalogPageRow[]> => {
      const { data, error } = await supabase.rpc("list_parts_catalog_page", {
        p_search: debouncedQ || null,
        p_category: debouncedCategory || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []) as CatalogPageRow[];
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const rows = useMemo(() => catalogPage.data ?? [], [catalogPage.data]);
  const totalCount = rows[0]?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Keep focus index within bounds as the page changes
  useEffect(() => {
    if (focusIndex >= rows.length) {
      setFocusIndex(Math.max(0, rows.length - 1));
    }
  }, [rows.length, focusIndex]);

  const upsert = useMutation({
    mutationFn: async (payload: Database["public"]["Tables"]["parts_catalog"]["Insert"]) => {
      if (!workspaceId) throw new Error("Workspace unavailable for catalog write.");
      const { error } = await supabase.from("parts_catalog").upsert(payload, {
        onConflict: "workspace_id,part_number",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts-catalog-page"] });
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

  const openPart = useCallback((rowId: string) => {
    setSelectedId(rowId);
    setPanelOpen(true);
  }, []);

  const selectedPageRow = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedRow = useMemo(
    () => (selectedPageRow ? toCatalogRow(selectedPageRow) : null),
    [selectedPageRow],
  );

  // Per-branch detail loads on demand when the command panel opens —
  // the old page pre-joined every branch of every part in the browser.
  const branchDetail = useQuery({
    queryKey: ["parts-catalog-branches", selectedPageRow?.part_number ?? null],
    enabled: panelOpen && Boolean(selectedPageRow),
    queryFn: async (): Promise<BranchDetailRow[]> => {
      const { data, error } = await supabase.rpc("get_part_branch_detail", {
        p_part_number: selectedPageRow!.part_number,
      });
      if (error) throw error;
      return (data ?? []) as BranchDetailRow[];
    },
    staleTime: 30_000,
  });

  const selectedBranches = useMemo(() => {
    if (!branchDetail.data) return undefined;
    const map = new Map<string, BranchCell>();
    for (const row of branchDetail.data) {
      map.set(row.branch_id, {
        qty: Number(row.qty ?? 0),
        bin: row.bin,
        reorderPoint: row.reorder_point != null ? Number(row.reorder_point) : null,
        velocity: row.velocity != null ? Number(row.velocity) : null,
        daysToStockout: row.days_to_stockout != null ? Number(row.days_to_stockout) : null,
        stockStatus: row.stock_status,
        forecastQty: row.forecast_qty != null ? Number(row.forecast_qty) : null,
        forecastRisk: row.forecast_risk,
      });
    }
    return map;
  }, [branchDetail.data]);

  const selectedTotal = selectedPageRow ? Number(selectedPageRow.total_qty ?? 0) : 0;

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
        setFocusIndex((i) => Math.min(rows.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const row = rows[focusIndex];
        if (row) {
          e.preventDefault();
          openPart(row.id);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rows, focusIndex, openPart, panelOpen]);

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

      {catalogPage.isLoading ? (
        <div className="flex justify-center py-16" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading catalog</span>
          <div
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        </div>
      ) : catalogPage.isError ? (
        <Card className="p-4 text-sm text-destructive">
          {(catalogPage.error as Error)?.message ?? "Failed to load catalog."}
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">
          No parts match the current filters.
        </Card>
      ) : (
        <>
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
                {rows.map((row, idx) => {
                  const worstStatus = row.worst_status;
                  const isFocused = idx === focusIndex;
                  return (
                    <TableRow
                      key={row.id}
                      data-row-index={idx}
                      tabIndex={0}
                      onClick={() => openPart(row.id)}
                      onFocus={() => setFocusIndex(idx)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openPart(row.id);
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
                        {isFocused && (
                          <div className="mt-0.5">
                            <PartCrossRefPanel partNumber={row.part_number} compact />
                          </div>
                        )}
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
                        {row.branch_count > 0 ? Number(row.total_qty) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                        {row.branch_count > 0
                          ? row.branch_count
                          : row.variant_count > 1
                            ? `${row.variant_count}×`
                            : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {totalCount.toLocaleString()} parts · page {page + 1} of {pageCount}
              {catalogPage.isFetching ? " · refreshing…" : ""}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
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
