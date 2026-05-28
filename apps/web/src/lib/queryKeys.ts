/**
 * Shared React Query keys.
 *
 * Centralised so multiple views of the same data share one cache entry — they
 * dedupe their background polling and a mutation in any one view invalidates
 * all of them. The OEM rep-price-impacts queue is rendered by the Sales Today
 * feed, the Sales price-impacts page, and the Price File Intelligence page;
 * they must agree.
 */
export const REP_PRICE_IMPACTS_QUERY_KEY = ["sales", "price-impacts"] as const;
