import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";

export function financeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

interface AsyncSectionProps<T> {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  data: T[] | undefined;
  /** Copy shown when the query succeeds but returns no rows. */
  emptyLabel?: string;
  loadingLabel?: string;
  children: (rows: T[]) => ReactNode;
}

/**
 * Uniform loading / error / empty / data wrapper for every finance-enforcement
 * panel. Keeps the four states explicit and consistent per QEP frontend
 * conventions (loading, error, and empty states in every operator workflow).
 */
export function AsyncSection<T>({
  isLoading,
  isError,
  error,
  data,
  emptyLabel = "Nothing to show yet.",
  loadingLabel = "Loading…",
  children,
}: AsyncSectionProps<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>{loadingLabel}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm text-destructive"
        role="alert"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{financeErrorMessage(error)}</span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Inbox className="h-4 w-4" aria-hidden />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return <>{children(data)}</>;
}
