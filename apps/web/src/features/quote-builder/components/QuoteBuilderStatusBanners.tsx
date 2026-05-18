/**
 * Post–PR 21 orchestrator slimming: inline status / error banners from
 * `QuoteBuilderV2Page.tsx`. Mechanical move.
 *
 * Error banners accept either a simple string (legacy) or a structured
 * `QuoteErrorCopy` so we can surface title + description + recovery hint
 * without leaking raw exception codes like `ARCHIVED_REFERENCE_NOT_ALLOWED`.
 * When the structured form carries a `recoveryAction`, the banner renders
 * a one-tap recovery button that calls back into the parent (typically
 * to jump the wizard to a specific step).
 */

import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import type {
  QuoteErrorCopy,
  QuoteErrorRecoveryAction,
} from "../lib/quote-error-messages";

export type StatusBannerError = QuoteErrorCopy | string | null | undefined;

export interface QuoteBuilderStatusBannersProps {
  existingQuoteLoadError?: StatusBannerError;
  existingQuoteEditingMessage?: string | null;
  pdfError?: StatusBannerError;
  saveSuccess?: boolean;
  saveErrorMessage?: StatusBannerError;
  submitApprovalErrorMessage?: StatusBannerError;
  /** Called when the rep taps a recovery-action button on a banner. */
  onRecoveryAction?: (kind: QuoteErrorRecoveryAction) => void;
}

export function QuoteBuilderStatusBanners({
  existingQuoteLoadError = null,
  existingQuoteEditingMessage = null,
  pdfError = null,
  saveSuccess = false,
  saveErrorMessage = null,
  submitApprovalErrorMessage = null,
  onRecoveryAction,
}: QuoteBuilderStatusBannersProps) {
  return (
    <>
      {existingQuoteLoadError ? (
        <ErrorBanner
          error={existingQuoteLoadError}
          tone="muted"
          onRecoveryAction={onRecoveryAction}
        />
      ) : null}

      {existingQuoteEditingMessage ? (
        <Card className="border-blue-500/20 bg-blue-500/5 p-4">
          <p className="text-sm text-blue-300">{existingQuoteEditingMessage}</p>
        </Card>
      ) : null}

      {pdfError ? (
        <ErrorBanner error={pdfError} onRecoveryAction={onRecoveryAction} />
      ) : null}

      {saveSuccess ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-sm text-emerald-400">Quote saved successfully.</p>
        </Card>
      ) : null}

      {submitApprovalErrorMessage ? (
        <ErrorBanner
          error={submitApprovalErrorMessage}
          onRecoveryAction={onRecoveryAction}
        />
      ) : null}

      {saveErrorMessage ? (
        <ErrorBanner
          error={saveErrorMessage}
          onRecoveryAction={onRecoveryAction}
        />
      ) : null}
    </>
  );
}

/**
 * Renders a structured error banner. Accepts either a plain string
 * (legacy) or a `QuoteErrorCopy` with title + description + optional
 * recovery hint + optional recovery action.
 */
function ErrorBanner({
  error,
  tone = "default",
  onRecoveryAction,
}: {
  error: QuoteErrorCopy | string;
  tone?: "default" | "muted";
  onRecoveryAction?: (kind: QuoteErrorRecoveryAction) => void;
}) {
  const titleColor = tone === "muted" ? "text-red-300" : "text-red-400";
  const descColor = tone === "muted" ? "text-red-300/85" : "text-red-400/85";

  if (typeof error === "string") {
    return (
      <Card role="alert" className="border-red-500/30 bg-red-500/5 p-4">
        <p className={`text-sm ${titleColor}`}>{error}</p>
      </Card>
    );
  }

  const handlerWired = typeof onRecoveryAction === "function";
  const showPrimary = handlerWired && Boolean(error.recoveryAction);
  const showFallback = handlerWired && Boolean(error.recoveryFallback);

  return (
    <Card role="alert" className="border-red-500/30 bg-red-500/5 p-4">
      <p className={`text-sm font-semibold ${titleColor}`}>{error.title}</p>
      <p className={`mt-1 text-sm ${descColor}`}>{error.description}</p>
      {error.recoveryHint ? (
        <p className="mt-2 text-xs italic text-red-300/70">
          {error.recoveryHint}
        </p>
      ) : null}
      {showPrimary || showFallback ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showPrimary && error.recoveryAction ? (
            <button
              type="button"
              onClick={() => onRecoveryAction?.(error.recoveryAction!.kind)}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20 hover:border-red-400/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
            >
              {error.recoveryAction.label}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
          {showFallback && error.recoveryFallback ? (
            <button
              type="button"
              onClick={() => onRecoveryAction?.(error.recoveryFallback!.kind)}
              className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1.5 text-xs font-medium text-red-300/80 hover:text-red-200 hover:border-red-400/30 hover:bg-red-500/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
            >
              {error.recoveryFallback.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
