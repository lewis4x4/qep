import { searchPortalOrdersForJob, type PortalOrderSearchRow } from "./api";

/** @deprecated alias — use PortalOrderSearchRow */
export type PortalOrderForFulfillmentLink = PortalOrderSearchRow;

/**
 * Find portal parts orders in the job workspace for linking to a fulfillment run.
 * Uses service-job-router + DB RPC (no client-side 200-row scan).
 */
export async function searchPortalPartsOrdersForFulfillmentLink(
  jobId: string,
  searchQuery: string,
): Promise<PortalOrderForFulfillmentLink[]> {
  const q = searchQuery.trim();
  if (q.length < 2) return [];
  return searchPortalOrdersForJob(jobId, q);
}
