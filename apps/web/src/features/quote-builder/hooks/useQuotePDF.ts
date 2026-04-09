/**
 * Quote PDF download hook.
 *
 * Dynamically imports @react-pdf/renderer (tree-shaken when not used),
 * generates a PDF blob from the QuotePDFDocument component, and triggers
 * a browser download.
 */

import { useState, useCallback } from "react";
import type { QuotePDFData } from "../components/QuotePDFDocument";

export function useQuotePDF() {
  const [generating, setGenerating] = useState(false);

  const generateAndDownload = useCallback(async (data: QuotePDFData) => {
    setGenerating(true);
    try {
      // Dynamic imports for tree-shaking — these are heavy libs
      const [{ pdf }, { QuotePDFDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("../components/QuotePDFDocument"),
      ]);

      const blob = await pdf(QuotePDFDocument({ data })).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = data.dealName.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-");
      a.download = `QEP-Quote-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[useQuotePDF] PDF generation failed:", err);
    } finally {
      setGenerating(false);
    }
  }, []);

  return { generateAndDownload, generating };
}
