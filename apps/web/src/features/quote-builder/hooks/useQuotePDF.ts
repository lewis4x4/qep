/**
 * Quote PDF download hook.
 *
 * Dynamically imports @react-pdf/renderer (tree-shaken when not used),
 * generates a PDF blob from the QuotePDFDocument component, and triggers
 * a browser download.
 */

import { createElement, useState, useCallback, useRef } from "react";
import type { QuotePDFData } from "../components/QuotePDFDocument";
import { openPrintableQuoteSheet } from "../lib/quote-print-html";

export interface QuotePdfGenerationResult {
  blob: Blob | null;
  filename: string;
  mode: "pdf" | "printable_fallback";
}

function quotePdfFilename(data: QuotePDFData): string {
  const quoteNumber = data.quoteNumber?.trim();
  const safeDealName = (data.dealName || "Quote").replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-") || "Quote";
  const baseName = quoteNumber || `QEP-Quote-${safeDealName}`;
  return `${baseName}-proposal.pdf`;
}

export function useQuotePDF() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationDepthRef = useRef(0);

  const generateAndDownload = useCallback(async (data: QuotePDFData): Promise<QuotePdfGenerationResult> => {
    generationDepthRef.current += 1;
    setGenerating(true);
    setError(null);
    const filename = quotePdfFilename(data);
    try {
      // Dynamic imports for tree-shaking — these are heavy libs
      const [{ pdf }, { QuotePDFDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("../components/QuotePDFDocument"),
      ]);
      const documentNode = createElement(QuotePDFDocument, { data }) as unknown as Parameters<typeof pdf>[0];
      const blob = await pdf(documentNode).toBlob();
      if (!blob || blob.size === 0) {
        throw new Error("Renderer returned an empty PDF blob");
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { blob, filename, mode: "pdf" };
    } catch (err) {
      console.error("[useQuotePDF] PDF generation failed:", {
        error: err instanceof Error ? err.message : String(err),
        quoteNumber: data.quoteNumber ?? null,
        dealName: data.dealName,
        customerName: data.customerName,
        equipmentCount: data.equipment.length,
        lineItemCount: data.lineItems.length,
        selectedPaymentKind: data.compliance.selectedPaymentKind,
      });
      try {
        await openPrintableQuoteSheet(data);
        setError(null);
        return { blob: null, filename, mode: "printable_fallback" };
      } catch (fallbackErr) {
        console.error("[useQuotePDF] printable fallback failed:", fallbackErr);
        setError("Failed to generate the quote PDF. Try again.");
        throw fallbackErr instanceof Error ? fallbackErr : err;
      }
    } finally {
      generationDepthRef.current = Math.max(0, generationDepthRef.current - 1);
      if (generationDepthRef.current === 0) setGenerating(false);
    }
  }, []);

  return { generateAndDownload, generating, error };
}
