/**
 * WAVE phase 5 — Hook that adapts the shared DealCompositeBundle into a
 * sales-rep-shaped view model. Keeps the desktop QrmDealDetailPage and
 * its admin chrome untouched; this is a strict-minimum projection of
 * the fields the rep needs in the field.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchDealComposite,
  type DealCompositeBundle,
} from "@/features/qrm/lib/deal-composite-api";

export interface SalesDealCustomer {
  id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface SalesDealActivity {
  id: string;
  type: string;
  body: string | null;
  occurredAt: string | null;
}

export interface SalesDealView {
  dealId: string;
  name: string;
  stageId: string;
  amount: number | null;
  closingProbability: number | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  marginPct: number | null;
  customer: SalesDealCustomer;
  lastActivity: SalesDealActivity | null;
  activities: SalesDealActivity[];
}

export function adaptDealCompositeToSalesView(
  bundle: DealCompositeBundle,
): SalesDealView {
  const { deal, contact, company, activities } = bundle;

  const companyName = company?.name ?? null;
  const contactName = contact
    ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim()
    : "";
  const customerName = companyName || contactName || "Customer";

  const phone =
    contact?.cell ?? contact?.directPhone ?? contact?.phone ?? null;

  const email = contact?.email ?? null;

  const mappedActivities: SalesDealActivity[] = activities.map((a) => ({
    id: a.id,
    type: String(a.activityType),
    body: a.body ?? null,
    occurredAt: a.occurredAt ?? null,
  }));

  const lastActivity = mappedActivities[0] ?? null;

  return {
    dealId: deal.id,
    name: deal.name,
    stageId: deal.stageId,
    amount: deal.amount,
    closingProbability: null,
    nextFollowUpAt: deal.nextFollowUpAt,
    lastActivityAt: deal.lastActivityAt,
    marginPct: deal.marginPct,
    customer: {
      id: company?.id ?? null,
      name: customerName || "Customer",
      phone,
      email,
    },
    lastActivity,
    activities: mappedActivities,
  };
}

export function useSalesDealDetail(
  dealId: string | undefined,
): UseQueryResult<SalesDealView | null> {
  return useQuery({
    queryKey: ["sales", "deal-detail", dealId],
    enabled: Boolean(dealId),
    queryFn: async () => {
      if (!dealId) return null;
      const bundle = await fetchDealComposite(dealId);
      return bundle ? adaptDealCompositeToSalesView(bundle) : null;
    },
    staleTime: 30_000,
  });
}
