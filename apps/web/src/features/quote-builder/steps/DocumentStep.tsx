/**
 * PR 19 — Quote wizard Step 10 (document preview).
 */

import { ArrowLeft, ArrowRight, FileDown, Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SummaryRow } from "../components/SummaryRow";
import { money } from "../lib/money";
import { shortDateTime } from "../lib/quote-date-input";
import { useWizard } from "../wizard/useWizard";

export interface DocumentStepProps {
  quoteTitle: string;
  customerTotal: number;
  financeMethodLabel: string;
  documentPersistenceLabel: string;
  documentFallbackGeneratedAt: string | null;
  documentArtifact: { id: string; storageBucket: string; storageKey: string; generatedAt: string } | null;
  customerFacingDocumentBlocker: string | null;
  pdfGenerating: boolean;
  quoteMediaSnapshotLoading: boolean;
  documentActionError: string | null;
  documentReady: boolean;
  onGenerateDocument: () => void;
}

export function DocumentStep({
  quoteTitle,
  customerTotal,
  financeMethodLabel,
  documentPersistenceLabel,
  documentFallbackGeneratedAt,
  documentArtifact,
  customerFacingDocumentBlocker,
  pdfGenerating,
  quoteMediaSnapshotLoading,
  documentActionError,
  documentReady,
  onGenerateDocument,
}: DocumentStepProps) {
  const { draft, setStep } = useWizard();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 10: Document preview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate a customer-facing PDF, store the artifact when the renderer succeeds, and keep a printable fallback available for browser/runtime failures.
        </p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Document vs review & send.</span>{" "}
          Approval context and final numbers are confirmed in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 9 — Review + approval"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("review")}
          >
            Review
          </Button>
          . Email, text, and logging live in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 11 — Send & log"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("send")}
          >
            Send
          </Button>
          .
        </p>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5 p-4">
        <p className="text-sm font-semibold text-blue-100">Stored document artifact</p>
        <p className="mt-1 text-xs text-blue-100/90">
          Successful PDF renders are uploaded to the private documents bucket and registered on the quote package for downstream send, audit, and signature workflows.
        </p>
      </Card>

      {customerFacingDocumentBlocker && (
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-300">Document blocked</p>
          <p className="mt-1 text-xs text-amber-200">{customerFacingDocumentBlocker}</p>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quote document preview</p>
            <p className="mt-2 text-base font-semibold text-foreground">{quoteTitle}</p>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <SummaryRow label="Customer" value={draft.customerName || draft.customerCompany || "Customer"} />
              <SummaryRow label="Customer total" value={money(customerTotal)} emphasize />
              <SummaryRow label="Equipment lines" value={String(draft.equipment.length)} />
              <SummaryRow label="Financing" value={financeMethodLabel} />
              <SummaryRow label="Artifact status" value={documentPersistenceLabel} />
            </div>
            <div className="mt-4 rounded-lg border border-border/70 bg-background/50 p-3 text-xs text-muted-foreground">
              {documentFallbackGeneratedAt
                ? documentArtifact
                  ? `PDF artifact generated ${shortDateTime(documentFallbackGeneratedAt)} and stored for customer delivery.`
                  : `Preview generated ${shortDateTime(documentFallbackGeneratedAt)} using the printable fallback; no stored PDF artifact is available from this render.`
                : "Click Generate Preview PDF to open/download the current proposal preview."}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
            <Button onClick={onGenerateDocument} disabled={Boolean(customerFacingDocumentBlocker) || pdfGenerating || quoteMediaSnapshotLoading}>
              {pdfGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
              {quoteMediaSnapshotLoading ? "Loading media..." : "Generate Preview PDF"}
            </Button>
            <Button variant="outline" onClick={onGenerateDocument} disabled={Boolean(customerFacingDocumentBlocker) || pdfGenerating || quoteMediaSnapshotLoading}>
              <Printer className="mr-1 h-4 w-4" /> Print Preview
            </Button>
          </div>
        </div>
        {documentActionError && <p className="mt-3 text-xs text-rose-400">{documentActionError}</p>}
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep("review")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <Button onClick={() => setStep("send")} disabled={!documentReady || quoteMediaSnapshotLoading}>Send & log <ArrowRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}
