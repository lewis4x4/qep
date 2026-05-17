/**
 * Post–PR 21 orchestrator slimming: inline status / error banners from
 * `QuoteBuilderV2Page.tsx`. Mechanical move.
 */

import { Card } from "@/components/ui/card";

export interface QuoteBuilderStatusBannersProps {
  existingQuoteLoadError?: string | null;
  existingQuoteEditingMessage?: string | null;
  pdfError?: string | null;
  saveSuccess?: boolean;
  saveErrorMessage?: string | null;
  submitApprovalErrorMessage?: string | null;
}

export function QuoteBuilderStatusBanners({
  existingQuoteLoadError = null,
  existingQuoteEditingMessage = null,
  pdfError = null,
  saveSuccess = false,
  saveErrorMessage = null,
  submitApprovalErrorMessage = null,
}: QuoteBuilderStatusBannersProps) {
  return (
    <>
      {existingQuoteLoadError ? (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-300">{existingQuoteLoadError}</p>
        </Card>
      ) : null}

      {existingQuoteEditingMessage ? (
        <Card className="border-blue-500/20 bg-blue-500/5 p-4">
          <p className="text-sm text-blue-300">{existingQuoteEditingMessage}</p>
        </Card>
      ) : null}

      {pdfError ? (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{pdfError}</p>
        </Card>
      ) : null}

      {saveSuccess ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-sm text-emerald-400">Quote saved successfully.</p>
        </Card>
      ) : null}

      {submitApprovalErrorMessage ? (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{submitApprovalErrorMessage}</p>
        </Card>
      ) : null}

      {saveErrorMessage ? (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{saveErrorMessage}</p>
        </Card>
      ) : null}
    </>
  );
}
