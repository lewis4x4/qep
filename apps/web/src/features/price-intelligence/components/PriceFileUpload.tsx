import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { uploadPriceFile, type PriceFileImportResponse } from "../lib/price-intelligence-api";

interface PriceFileUploadProps {
  onUploadSuccess?: (result: PriceFileImportResponse) => void;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

export function PriceFileUpload({ onUploadSuccess }: PriceFileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadPriceFile,
    onSuccess: (data) => {
      setSelectedFile(null);
      if (onUploadSuccess) onUploadSuccess(data);
    },
  });

  function handleFilePick(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Only CSV files are supported in this upload. Excel/PDF support coming soon.");
      return;
    }
    setSelectedFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFilePick(file);
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Upload className="h-4 w-4 text-qep-orange" aria-hidden />
        <h3 className="text-sm font-bold text-foreground">Upload Price File</h3>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Upload a manufacturer CSV. Catalog prices update, history is captured, and affected quotes are flagged for requote.
      </p>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          dragging ? "border-qep-orange bg-qep-orange/5" : "border-border hover:border-foreground/30"
        }`}
      >
        <FileSpreadsheet className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
        {selectedFile ? (
          <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
        ) : (
          <>
            <p className="text-sm text-foreground">Drop a CSV here or click to browse</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Columns expected: make, model, year, stock_number, list_price, dealer_cost, msrp, category, condition
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFilePick(file);
          }}
        />
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          onClick={() => selectedFile && uploadMutation.mutate(selectedFile)}
          disabled={!selectedFile || uploadMutation.isPending}
        >
          {uploadMutation.isPending ? "Importing…" : "Import & flag impacts"}
        </Button>
      </div>

      {/* Results */}
      {uploadMutation.isSuccess && uploadMutation.data && (
        <div className="mt-3 space-y-2">
          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
              <p className="text-sm font-semibold text-emerald-400">Import complete</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>Rows parsed: <strong className="text-foreground">{uploadMutation.data.results.rows_parsed}</strong></div>
              <div>Rows imported: <strong className="text-foreground">{uploadMutation.data.results.rows_imported}</strong></div>
              <div>Prices changed: <strong className="text-foreground">{uploadMutation.data.results.prices_changed}</strong></div>
              <div>Quotes flagged: <strong className="text-foreground">{uploadMutation.data.results.quotes_flagged}</strong></div>
            </div>
          </div>

          {uploadMutation.data.impact_report && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-xs font-semibold text-amber-400">Impact stratification</p>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                <div>
                  <p className="text-[9px] uppercase tracking-wider">Quotes</p>
                  <p className="text-sm font-bold text-foreground">{uploadMutation.data.impact_report.total_quotes_affected}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider">Deals</p>
                  <p className="text-sm font-bold text-foreground">{uploadMutation.data.impact_report.total_deals_affected}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider">$ Exposure</p>
                  <p className="text-sm font-bold text-amber-400">{formatCurrency(uploadMutation.data.impact_report.total_dollar_exposure)}</p>
                </div>
              </div>
            </div>
          )}

          {uploadMutation.data.results.errors.length > 0 && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" aria-hidden />
                <p className="text-xs font-semibold text-red-400">Parse errors ({uploadMutation.data.results.errors.length})</p>
              </div>
              <ul className="mt-1 space-y-0.5">
                {uploadMutation.data.results.errors.slice(0, 5).map((err, i) => (
                  <li key={i} className="text-[10px] text-red-300">{err}</li>
                ))}
                {uploadMutation.data.results.errors.length > 5 && (
                  <li className="text-[10px] italic text-muted-foreground">…and {uploadMutation.data.results.errors.length - 5} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {uploadMutation.isError && (
        <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 p-3">
          <p className="text-xs text-red-400">
            {(uploadMutation.error as Error)?.message ?? "Import failed"}
          </p>
        </div>
      )}
    </Card>
  );
}
