/**
 * Catalog Import Page — Track 2.1a.
 *
 * Admin page for bulk-importing equipment catalog entries via CSV.
 * Supports drag-drop CSV upload, preview, and batch insert into catalog_entries.
 */

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";

interface CatalogRow {
  make: string;
  model: string;
  year: string;
  category: string;
  list_price: string;
  stock_number: string;
  condition: string;
  serial_number?: string;
  branch?: string;
}

interface ParsedEntry {
  make: string;
  model: string;
  year: number | null;
  category: string;
  list_price: number | null;
  stock_number: string;
  condition: string;
  serial_number: string | null;
  branch: string | null;
  valid: boolean;
  error?: string;
}

function parseRow(row: CatalogRow, idx: number): ParsedEntry {
  const make = (row.make ?? "").trim();
  const model = (row.model ?? "").trim();
  const year = parseInt(row.year, 10);
  const price = parseFloat((row.list_price ?? "").replace(/[$,]/g, ""));
  const valid = make.length > 0 && model.length > 0;

  return {
    make,
    model,
    year: Number.isFinite(year) ? year : null,
    category: (row.category ?? "").trim(),
    list_price: Number.isFinite(price) ? price : null,
    stock_number: (row.stock_number ?? "").trim(),
    condition: (row.condition ?? "good").trim(),
    serial_number: row.serial_number?.trim() || null,
    branch: row.branch?.trim() || null,
    valid,
    error: valid ? undefined : `Row ${idx + 1}: missing make or model`,
  };
}

export function CatalogImportPage() {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<ParsedEntry[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    setParseError(null);
    setFileName(file.name);
    Papa.parse<CatalogRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors.length > 0) {
          setParseError(`CSV parse error: ${result.errors[0].message}`);
          return;
        }
        const entries = result.data.map((row, i) => parseRow(row, i));
        setParsed(entries);
      },
      error: (err) => setParseError(err.message),
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
      handleFile(file);
    } else {
      setParseError("Please drop a .csv file");
    }
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const validEntries = parsed?.filter((e) => e.valid) ?? [];
  const invalidEntries = parsed?.filter((e) => !e.valid) ?? [];

  const importMutation = useMutation({
    mutationFn: async () => {
      const rows = validEntries.map((e) => ({
        make: e.make,
        model: e.model,
        year: e.year,
        category: e.category || null,
        list_price: e.list_price,
        stock_number: e.stock_number || null,
        condition: e.condition || "good",
        serial_number: e.serial_number,
        branch: e.branch,
        is_available: true,
        source: "csv_import",
        imported_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from("catalog_entries").insert(rows);
      if (error) throw new Error(error.message);
      return rows.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Catalog Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bulk-import equipment catalog entries from a CSV file. Required columns: make, model. Optional: year, category, list_price, stock_number, condition, serial_number, branch.
        </p>
      </div>

      {/* Upload area */}
      {!parsed && (
        <Card
          className="border-dashed border-2 border-border p-12 text-center cursor-pointer hover:border-qep-orange/40 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept=".csv"
            onChange={handleInputChange}
            className="hidden"
            id="catalog-csv-input"
          />
          <label htmlFor="catalog-csv-input" className="cursor-pointer">
            <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">Drop a CSV file here or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">Supports .csv files with header row</p>
          </label>
        </Card>
      )}

      {parseError && (
        <Card className="border-rose-500/30 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            <p className="text-sm text-rose-400">{parseError}</p>
          </div>
        </Card>
      )}

      {/* Preview */}
      {parsed && !importMutation.isSuccess && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileUp className="h-5 w-5 text-qep-orange" />
              <div>
                <p className="text-sm font-medium text-foreground">{fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {validEntries.length} valid entries{invalidEntries.length > 0 ? `, ${invalidEntries.length} errors` : ""}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setParsed(null); setFileName(null); }}>
                Clear
              </Button>
              <Button
                size="sm"
                onClick={() => importMutation.mutate()}
                disabled={validEntries.length === 0 || importMutation.isPending}
              >
                {importMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                {importMutation.isPending ? "Importing..." : `Import ${validEntries.length} entries`}
              </Button>
            </div>
          </div>

          {invalidEntries.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-medium text-amber-400 mb-1">{invalidEntries.length} rows skipped:</p>
              {invalidEntries.slice(0, 5).map((e, i) => (
                <p key={i} className="text-xs text-amber-400/70">{e.error}</p>
              ))}
              {invalidEntries.length > 5 && <p className="text-xs text-amber-400/50">...and {invalidEntries.length - 5} more</p>}
            </Card>
          )}

          {/* Preview table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="py-2 px-3 text-left font-medium text-muted-foreground">Make</th>
                    <th className="py-2 px-3 text-left font-medium text-muted-foreground">Model</th>
                    <th className="py-2 px-3 text-left font-medium text-muted-foreground">Year</th>
                    <th className="py-2 px-3 text-left font-medium text-muted-foreground">Category</th>
                    <th className="py-2 px-3 text-right font-medium text-muted-foreground">Price</th>
                    <th className="py-2 px-3 text-left font-medium text-muted-foreground">Stock #</th>
                    <th className="py-2 px-3 text-center font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {validEntries.slice(0, 20).map((e, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 px-3 font-medium">{e.make}</td>
                      <td className="py-2 px-3">{e.model}</td>
                      <td className="py-2 px-3">{e.year ?? "—"}</td>
                      <td className="py-2 px-3">{e.category || "—"}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{e.list_price ? `$${e.list_price.toLocaleString()}` : "—"}</td>
                      <td className="py-2 px-3">{e.stock_number || "—"}</td>
                      <td className="py-2 px-3 text-center">
                        <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">Valid</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validEntries.length > 20 && (
                <p className="text-xs text-muted-foreground p-3">Showing 20 of {validEntries.length} entries</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Success */}
      {importMutation.isSuccess && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-emerald-400">
            {importMutation.data} catalog entries imported successfully
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { setParsed(null); setFileName(null); importMutation.reset(); }}>
            Import another file
          </Button>
        </Card>
      )}

      {importMutation.isError && (
        <Card className="border-rose-500/30 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            <p className="text-sm text-rose-400">
              Import failed: {importMutation.error instanceof Error ? importMutation.error.message : "Unknown error"}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

export default CatalogImportPage;
