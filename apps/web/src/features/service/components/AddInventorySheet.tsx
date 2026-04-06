import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Plus } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { useActiveBranches, type Branch } from "@/hooks/useBranches";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import Papa from "papaparse";

export function AddInventorySheet() {
  const qc = useQueryClient();
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;
  const branchesQ = useActiveBranches();
  const branches = branchesQ.data ?? [];

  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [qty, setQty] = useState("1");
  const [bin, setBin] = useState("");

  type PayloadObj = {
    workspace_id?: string;
    branch_id: string;
    part_number: string;
    qty_on_hand: number;
    bin_location?: string | null;
  };

  const upsert = useMutation({
    mutationFn: async (payload: PayloadObj | PayloadObj[]) => {
      if (!workspaceId) throw new Error("Workspace unavailable for inventory write.");
      
      const payloadArray = Array.isArray(payload) ? payload : [payload];
      const rows = payloadArray.map(p => ({
          workspace_id: workspaceId,
          branch_id: p.branch_id,
          part_number: p.part_number.trim(),
          qty_on_hand: p.qty_on_hand,
          bin_location: p.bin_location || null,
          updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from("parts_inventory").upsert(
        rows,
        { onConflict: "workspace_id,branch_id,part_number" },
      );
      
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["parts-inventory"] });
      toast({ title: "Inventory updated", description: `Successfully saved ${count} row${count > 1 ? 's' : ''}.` });
      if (count === 1) {
        setPartNumber("");
        setQty("1");
        setBin("");
        // Keep branch selected for easy batch entry
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    }
  });

  const onCsv = useCallback(
    (file: File | null) => {
      if (!file) return;
      
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const rows: PayloadObj[] = [];
          for (const row of results.data as string[][]) {
             if (row.length < 2) continue;
             const [b, pn, q, bl] = row;
             if (!b || !pn) continue;
             const parsedQty = Math.max(0, parseInt(q ?? "0", 10) || 0);
             rows.push({
               branch_id: b.trim(),
               part_number: pn.trim(),
               qty_on_hand: parsedQty,
               bin_location: bl ? bl.trim() : null
             });
          }

          if (rows.length > 0) {
            toast({ title: "Importing CSV...", description: `Bulk updating ${rows.length} rows to the database.` });
            upsert.mutate(rows);
            setOpen(false);
          } else {
             toast({ title: "Invalid CSV", description: "No valid rows found to import.", variant: "destructive" });
          }
        },
        error: (err) => {
           toast({ title: "CSV Parsing Error", description: err.message, variant: "destructive" });
        }
      });
    },
    [upsert],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Inventory
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add or Update Inventory</SheetTitle>
          <SheetDescription>
            Enter stock details for a specific branch. If the part exists, it will be updated.
          </SheetDescription>
        </SheetHeader>
        
        <div className="space-y-6 py-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Branch</Label>
              {branches.length > 0 ? (
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  disabled={branchesQ.isLoading}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Select branch…</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.slug}>
                      {b.display_name} ({b.slug})
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  placeholder="branch slug"
                  className="font-mono text-sm"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Part Number</Label>
              <Input
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                placeholder="e.g. FIL-101"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min={0}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Bin Location</Label>
                <Input
                  value={bin}
                  onChange={(e) => setBin(e.target.value)}
                  placeholder="e.g. A-12"
                />
              </div>
            </div>
            <Button
              className="w-full"
              disabled={!branchId.trim() || !partNumber.trim() || upsert.isPending}
              onClick={() =>
                upsert.mutate({
                  branch_id: branchId.trim(),
                  part_number: partNumber.trim(),
                  qty_on_hand: Math.max(0, parseInt(qty, 10) || 0),
                  bin_location: bin || null,
                })
              }
            >
              {upsert.isPending ? "Saving..." : "Save Row"}
            </Button>
          </div>

          <Separator />
          
          <div className="space-y-4">
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Bulk Import (CSV)</h4>
              <p className="text-xs text-muted-foreground">Format: branch_slug, part_number, qty, bin</p>
            </div>
            <div className="relative border-2 border-dashed border-input rounded-md p-6 hover:bg-muted/50 transition flex flex-col items-center justify-center gap-2 cursor-pointer">
              <Input
                type="file"
                accept=".csv,text/csv"
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                onChange={(e) => onCsv(e.target.files?.[0] ?? null)}
              />
              <Plus className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">Click or drag CSV here</span>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
