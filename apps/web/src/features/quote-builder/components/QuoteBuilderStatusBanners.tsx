/**
 * Post–PR 21 orchestrator slimming: inline status / error banners from
 * `QuoteBuilderV2Page.tsx`. Mechanical move.
 *
 * Error banners accept either a simple string (legacy) or a structured
 * `QuoteErrorCopy` so we can surface title + description + recovery hint
 * without leaking raw exception codes like `ARCHIVED_REFERENCE_NOT_ALLOWED`.
 */

import { Card } from "@/components/ui/card";
import type { QuoteErrorCopy } from "../lib/quote-error-messages";

export type StatusBannerError = QuoteErrorCopy | string | null | undefined;

export interface QuoteBuilderStatusBannersProps {
  existingQuoteLoadError?: StatusBannerError;
  existingQuoteEditingMessage?: string | null;
  pdfError?: StatusBannerError;
  saveSuccess?: boolean;
  saveErrorMessage?: StatusBannerError;
  submitApprovalErrorMessage?: StatusBannerError;
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
        <ErrorBanner error={existingQuoteLoadError} tone="muted" />
      ) : null}

      {existingQuoteEditingMessage ? (
        <Card className="border-blue-500/20 bg-blue-500/5 p-4">
          <p className="text-sm text-blue-300">{existingQuoteEditingMessage}</p>
        </Card>
      ) : null}

      {pdfError ? <ErrorBanner error={pdfError} /> : null}

      {saveSuccess ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-sm text-emerald-400">Quote saved successfully.</p>
        </Card>
      ) : null}

      {submitApprovalErrorMessage ? (
        <ErrorBanner error={submitApprovalErrorMessage} />
      ) : null}

      {saveErrorMessage ? <ErrorBanner error={saveErrorMessage} /> : null}
    </>
  );
}

/**
 * Renders a structured error banner. Accepts either a plain string
 * (legacy) or a `QuoteErrorCopy` with title + description + optional
 * recovery hint.
 */
function ErrorBanner({
  error,
  tone = "default",
}: {
  error: QuoteErrorCopy | string;
  tone?: "default" | "muted";
}) {
  const titleColor = tone === "muted" ? "text-red-300" : "text-red-400";
  const descColor =
    tone === "muted" ? "text-red-300/85" : "text-red-400/85";

  if (typeof error === "string") {
    return (
      <Card
        role="alert"
        className="border-red-500/30 bg-red-500/5 p-4"
      >
        <p className={`text-sm ${titleColor}`}>{error}</p>
      </Card>
    );
  }

  return (
    <Card role="alert" className="border-red-500/30 bg-red-500/5 p-4">
      <p className={`text-sm font-semibold ${titleColor}`}>{error.title}</p>
      <p className={`mt-1 text-sm ${descColor}`}>{error.description}</p>
      {error.recoveryHint ? (
        <p className="mt-2 text-xs italic text-red-300/70">
          {error.recoveryHint}
        </p>
      ) : null}
    </Card>
  );
}
