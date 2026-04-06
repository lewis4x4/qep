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
  const invTotals = useQuery({
    queryKey: ["parts-inventory-totals-by-part"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_inventory")
        .select("part_number, qty_on_hand, branch_id")
        .is("deleted_at", null);
      if (error) throw error;
      const totals = new Map<string, number>();
      const byBranch = new Map<string, Map<string, number>>();
      for (const r of data ?? []) {
        const k = r.part_number.toLowerCase();
        totals.set(k, (totals.get(k) ?? 0) + r.qty_on_hand);
        if (!byBranch.has(k)) byBranch.set(k, new Map());
        const bm = byBranch.get(k)!;
        bm.set(r.branch_id, (bm.get(r.branch_id) ?? 0) + r.qty_on_hand);
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
  const stockByBranch = invTotals.data?.byBranch ?? new Map<string, Map<string, number>>();

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

      {workspaceQ.isError && (
        <Card className="p-3 text-sm text-destructive border-destructive/40">
          {(workspaceQ.error as Error)?.message ?? "Could not resolve your workspace."}
        </Card>
      )}

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
                              .map(([branch, qty]) => (
                                <div key={branch} className="flex justify-between gap-2">
                                  <span className="font-mono text-muted-foreground">{branch}</span>
                                  <span className="tabular-nums font-medium">{qty}</span>
                                </div>
                              ))}
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
