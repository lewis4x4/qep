/**
 * Quote PDF download hook.
 *
 * Dynamically imports @react-pdf/renderer (tree-shaken when not used),
 * generates a PDF blob from the QuotePDFDocument component, and triggers
 * a browser download.
 */

import { createElement, useState, useCallback } from "react";
import type { QuotePDFData } from "../components/QuotePDFDocument";

export function useQuotePDF() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateAndDownload = useCallback(async (data: QuotePDFData) => {
    setGenerating(true);
    setError(null);
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
      const safeName = (data.dealName || "Quote").replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-") || "Quote";
      a.download = `QEP-Quote-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[useQuotePDF] PDF generation failed:", {
        error: err instanceof Error ? err.message : String(err),
        dealName: data.dealName,
        customerName: data.customerName,
        equipmentCount: data.equipment.length,
      });
      setError("Failed to generate the quote PDF. Try again.");
    } finally {
      setGenerating(false);
    }
  }, []);

  return { generateAndDownload, generating, error };
}
