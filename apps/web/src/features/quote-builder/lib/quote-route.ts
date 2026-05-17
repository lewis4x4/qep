/**
 * WAVE polish (Slice 5) — canonical quote-builder link helpers.
 *
 * The WAVE Mobile-First Sales Rep wave landed Quote Builder inside
 * SalesShell at /sales/quotes/new and /sales/quotes/:quoteId, but
 * ~17 callsites across the QRM admin pages still hand-built
 * /quote-v2?...&package_id=... links. RedirectPreserveSearch in
 * App.tsx catches those, but every redirect adds latency + dead-link
 * risk. Centralizing the URL build here means future route renames
 * are a single-file change.
 *
 * Mental model: there are exactly two destinations:
 *   1. The Quote Builder itself (with optional CRM / package / quote
 *      context). Use `buildQuoteBuilderHref({ ... })`.
 *   2. The Quote List inside SalesShell. Use `buildQuoteListHref()`.
 *
 * Legacy `RedirectPreserveSearch from="/quote-v2"` stays in App.tsx as
 * belt-and-suspenders for any deep link that pre-dates this helper.
 */

export interface QuoteBuilderLinkParams {
  /**
   * Editing an existing quote → routes to /sales/quotes/:quoteId.
   * Falls back to /sales/quotes/new when omitted.
   */
  quoteId?: string;
  /** CRM deal id — emitted as `?crm_deal_id=`. */
  dealId?: string;
  /** CRM contact id — emitted as `?crm_contact_id=`. */
  contactId?: string;
  /** CRM company id — emitted as `?crm_company_id=`. */
  companyId?: string;
  /**
   * Quote package id — emitted as `?package_id=`. Use this when the
   * quote was created without a CRM deal and you want the orchestrator
   * to load it as an existing package by id rather than reading the
   * quoteId path param.
   */
  packageId?: string;
  /** Flag that the prospect → customer conversion already happened. */
  prospectConverted?: boolean;
}

function buildQuoteQuery(params: QuoteBuilderLinkParams): string {
  const sp = new URLSearchParams();
  if (params.dealId) sp.set("crm_deal_id", params.dealId);
  if (params.contactId) sp.set("crm_contact_id", params.contactId);
  if (params.companyId) sp.set("crm_company_id", params.companyId);
  if (params.packageId) sp.set("package_id", params.packageId);
  if (params.prospectConverted) sp.set("prospect_converted", "1");
  return sp.toString();
}

export function buildQuoteBuilderHref(
  params: QuoteBuilderLinkParams = {},
): string {
  const qs = buildQuoteQuery(params);
  if (params.quoteId) {
    return qs ? `/sales/quotes/${params.quoteId}?${qs}` : `/sales/quotes/${params.quoteId}`;
  }
  return qs ? `/sales/quotes/new?${qs}` : "/sales/quotes/new";
}

export function buildQuoteListHref(): string {
  return "/sales/quotes";
}
