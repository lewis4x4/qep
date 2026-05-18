/**
 * Translates raw API / Postgres exceptions into human-readable, actionable
 * copy for Quote Builder banners and toasts.
 *
 * Backend exceptions like `ARCHIVED_REFERENCE_NOT_ALLOWED` should never
 * leak as-is into the UI — they're operator-hostile. This helper maps
 * known error signatures (custom exception names, Postgres SQLSTATE
 * codes, network-error text) to title/description/recoveryHint copy.
 *
 * Unknown errors fall back to the raw message with a generic title, so
 * we still surface useful info without revealing the exception code.
 */

/**
 * Recovery action kinds the banner can render as a one-tap button.
 * The page-level component decides what each kind does (typically
 * jumping the wizard to a specific step).
 */
export type QuoteErrorRecoveryAction = "goto_customer_step";

export interface QuoteErrorCopy {
  /** Short, human title for the banner header or toast title. */
  title: string;
  /** Plain-language explanation of what went wrong. */
  description: string;
  /** Optional next-step guidance — what the rep can do to recover. */
  recoveryHint?: string;
  /**
   * Optional one-tap action. When set AND a handler is wired in the
   * banner, the recovery hint renders as a clickable button instead
   * of plain italic text.
   */
  recoveryAction?: {
    kind: QuoteErrorRecoveryAction;
    label: string;
  };
}

const DEFAULT_COPY: QuoteErrorCopy = {
  title: "Something went wrong",
  description: "Try again. If the problem persists, contact support.",
};

/** Translate an unknown error from a quote-related API call into UI copy. */
export function translateQuoteError(error: unknown): QuoteErrorCopy {
  const raw = extractMessage(error);
  if (!raw) return DEFAULT_COPY;

  const matched = matchKnownError(raw);
  if (matched) return matched;

  // Fall back to the raw message but with a generic title so the user
  // still sees something useful without the bare exception code feeling
  // like a crash dump.
  return { title: DEFAULT_COPY.title, description: raw };
}

/** Format a translated error as a single string (e.g., for toast description). */
export function translateQuoteErrorAsString(error: unknown): string {
  const copy = translateQuoteError(error);
  return copy.recoveryHint
    ? `${copy.description} ${copy.recoveryHint}`
    : copy.description;
}

function extractMessage(error: unknown): string | null {
  if (typeof error === "string") return error.trim() || null;
  if (error instanceof Error) return error.message.trim() || null;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m.trim() || null;
  }
  return null;
}

function matchKnownError(raw: string): QuoteErrorCopy | null {
  const lc = raw.toLowerCase();

  // Archived FK trigger (migration 038_crm_record_archive_rpcs.sql).
  // Fires on insert/update of FK columns pointing to archived contacts,
  // companies, or deals.
  if (lc.includes("archived_reference_not_allowed")) {
    return {
      title: "Linked record is archived",
      description:
        "This quote references a customer, contact, or deal that has been archived. Re-link the quote to an active record to continue.",
      recoveryHint:
        "Search the dealer directory in the Customer step and pick an active record.",
      recoveryAction: {
        kind: "goto_customer_step",
        label: "Re-link customer",
      },
    };
  }

  // Unknown reference type (companion exception in the same trigger)
  if (lc.includes("unknown_reference_type")) {
    return {
      title: "Reference type not recognized",
      description:
        "A linked record has an unexpected type. This usually means a record was migrated incorrectly. Contact support.",
    };
  }

  // Postgres SQLSTATE 23505 — unique violation
  if (lc.includes("23505") || lc.includes("duplicate key value")) {
    return {
      title: "Duplicate record",
      description:
        "A record with this identifier already exists. Reload the page and verify the quote hasn't been saved twice.",
    };
  }

  // Postgres SQLSTATE 23503 — foreign key violation
  if (
    lc.includes("23503") ||
    (lc.includes("foreign key") && !lc.includes("archived_reference"))
  ) {
    return {
      title: "Linked record not found",
      description:
        "A related record (customer, deal, or equipment) couldn't be linked. Confirm the source still exists and try again.",
    };
  }

  // Postgres SQLSTATE 23502 — NOT NULL violation
  if (lc.includes("23502") || lc.includes("null value in column")) {
    return {
      title: "Missing required field",
      description:
        "One or more required fields are empty. Check each wizard step and fill them in before saving.",
    };
  }

  // Postgres SQLSTATE 42501 — insufficient privilege (RLS or grants)
  if (
    lc.includes("42501") ||
    lc.includes("permission denied") ||
    lc.includes("new row violates row-level security")
  ) {
    return {
      title: "Permission denied",
      description:
        "You don't have access to this record. Confirm you're in the correct workspace, or ask an admin to check your role.",
    };
  }

  // PostgREST / Supabase 5xx / connection refused
  if (
    lc.includes("pgrst") ||
    lc.includes("503") ||
    lc.includes("connection refused") ||
    lc.includes("upstream connect error")
  ) {
    return {
      title: "Service temporarily unavailable",
      description:
        "The backend is briefly unreachable. Your work hasn't been lost — retry in a few seconds.",
    };
  }

  // Network failures
  if (
    lc.includes("failed to fetch") ||
    lc.includes("networkerror") ||
    lc.includes("offline") ||
    lc.includes("err_internet_disconnected")
  ) {
    return {
      title: "Connection lost",
      description:
        "Check your network connection and try again. Your unsaved work stays in the wizard.",
    };
  }

  // Auth — JWT expired / 401
  if (
    lc.includes("jwt expired") ||
    lc.includes("invalid jwt") ||
    lc.includes("401") ||
    lc.includes("unauthorized")
  ) {
    return {
      title: "Session expired",
      description:
        "Your sign-in expired. Refresh the page and sign in again to continue.",
    };
  }

  return null;
}
