import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ServiceSubNav } from "../components/ServiceSubNav";

export function PartsInventoryPage() {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [qty, setQty] = useState("1");
  const [bin, setBin] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["parts-inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_inventory")
        .select("*")
        .is("deleted_at", null)
        .order("branch_id")
        .order("part_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const upsert = useMutation({
    mutationFn: async (payload: {
      workspace_id?: string;
      branch_id: string;
      part_number: string;
      qty_on_hand: number;
      bin_location?: string | null;
    }) => {
      const { error } = await supabase.from("parts_inventory").upsert(
        {
          workspace_id: "default",
          branch_id: payload.branch_id,
          part_number: payload.part_number.trim(),
          qty_on_hand: payload.qty_on_hand,
          bin_location: payload.bin_location || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,branch_id,part_number" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parts-inventory"] }),
  });

  const onCsv = useCallback(
    (file: File | null) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          const [b, pn, q, bl] = line.split(",").map((s) => s.trim());
          if (!b || !pn) continue;
          const n = Math.max(0, parseInt(q ?? "0", 10) || 0);
          upsert.mutate({
            branch_id: b,
            part_number: pn,
            qty_on_hand: n,
            bin_location: bl || null,
          });
        }
      };
      reader.readAsText(file);
    },
    [upsert],
  );

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <ServiceSubNav />
      <div>
        <h1 className="text-2xl font-semibold">Parts inventory</h1>
        <p className="text-sm text-muted-foreground">
          Branch on-hand quantities for the parts planner stock-first path.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-medium">Add or update row</h2>
        <div className="flex flex-wrap gap-2 items-end text-sm">
          <div>
            <label className="text-xs text-muted-foreground">Branch</label>
            <input
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="block w-36 rounded border px-2 py-1 font-mono"
              placeholder="main"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Part #</label>
            <input
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
              className="block w-40 rounded border px-2 py-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Qty</label>
            <input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="block w-20 rounded border px-2 py-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Bin</label>
            <input
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              className="block w-28 rounded border px-2 py-1"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!branchId.trim() || !partNumber.trim() || upsert.isPending}
            onClick={() =>
              upsert.mutate({
                branch_id: branchId.trim(),
                part_number: partNumber.trim(),
                qty_on_hand: Math.max(0, parseInt(qty, 10) || 0),
                bin_location: bin || null,
              })}
          >
            Save
          </Button>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">CSV import (branch,part,qty,bin)</label>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block text-xs mt-1"
            onChange={(e) => onCsv(e.target.files?.[0] ?? null)}
          />
        </div>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded border text-xs">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="p-2">Branch</th>
                <th className="p-2">Part</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Bin</th>
                <th className="p-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="p-2 font-mono">{r.branch_id}</td>
                  <td className="p-2">{r.part_number}</td>
                  <td className="p-2">
                    <input
                      type="number"
                      min={0}
                      className="w-16 rounded border px-1 py-0.5 bg-background"
                      defaultValue={r.qty_on_hand}
                      onBlur={(e) => {
                        const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                        upsert.mutate({
                          branch_id: r.branch_id,
                          part_number: r.part_number,
                          qty_on_hand: v,
                          bin_location: r.bin_location,
                        });
                      }}
                    />
                  </td>
                  <td className="p-2">{r.bin_location ?? "—"}</td>
                  <td className="p-2 text-muted-foreground">
                    {r.updated_at?.slice(0, 16) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
