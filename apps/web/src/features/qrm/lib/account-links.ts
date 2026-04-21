/**
 * Account URL helpers (Track 7A exit condition).
 *
 * Roadmap §9 Sub-Phase 7A exit condition requires the Account Command
 * Center to be the default drill-down target system-wide. Use
 * `accountCommandUrl(companyId)` for every operational drill-down — signal
 * cards, move cards, Ask-Iron chips, Graph Explorer clicks, equipment →
 * owner links, and any other "click on an account to drill in" flow.
 *
 * Reserve `legacyAccountDetailUrl` for explicit escape hatches labeled
 * "Legacy detail" / "Open old record" — places where the operator is
 * intentionally asking for the flat detail view.
 *
 * Pure functions — no React, no router dependencies — so they can be unit
 * tested and imported from anywhere (library files, router helpers,
 * action links, email drafts, etc.) without pulling in UI.
 */

export interface AccountLinkOptions {
  /** Optional ?returnTo=... query so the Command Center can surface a back-link. */
  returnTo?: string;
}

function encodeQuery(options: AccountLinkOptions | undefined): string {
  if (!options?.returnTo) return "";
  return `?returnTo=${encodeURIComponent(options.returnTo)}`;
}

/**
 * Canonical drill-down URL. Use this anywhere the user is "opening" an
 * account from an operational context.
 */
export function accountCommandUrl(companyId: string, options?: AccountLinkOptions): string {
  return `/qrm/accounts/${companyId}/command${encodeQuery(options)}`;
}

/**
 * Flat legacy detail URL. Use ONLY for explicit "Legacy detail" escape
 * hatches — not from operational drill-downs. Kept here so the two
 * call-site categories are visible side-by-side at the boundary.
 */
export function legacyAccountDetailUrl(companyId: string): string {
  return `/qrm/companies/${companyId}`;
}

/** Fleet radar sub-page for an account. Intentional sub-navigation, not a drill-down. */
export function accountFleetRadarUrl(companyId: string): string {
  return `/qrm/companies/${companyId}/fleet-radar`;
}
