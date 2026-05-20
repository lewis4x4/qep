import { useQuery } from "@tanstack/react-query";
import {
  fetchCustomerEquipment,
  fetchCustomerDeals,
  fetchCustomerActivities,
  fetchCustomerQuotes,
  fetchRepCustomers,
  fetchCustomerByCompanyId,
} from "../lib/sales-api";

export function customerDetailQueryKey(companyId: string) {
  return ["sales", "customer-detail", companyId] as const;
}

export function useCustomerDetail(companyId: string) {
  const detailKey = customerDetailQueryKey(companyId);
  // Primary lookup: the rep's book of business. Fast (cached list query),
  // hits when the rep has previously engaged with this customer.
  const bookCustomerQuery = useQuery({
    queryKey: ["sales", "customers"],
    queryFn: fetchRepCustomers,
    staleTime: 5 * 60 * 1000,
    select: (data) => data.find((c) => c.customer_id === companyId) ?? null,
  });

  // Fallback lookup: pull the company straight from crm_companies when the
  // book lookup misses. This is what makes dealer-directory search results
  // openable for customers the rep has never touched.
  const directCustomerQuery = useQuery({
    queryKey: [...detailKey, "customer"],
    queryFn: () => fetchCustomerByCompanyId(companyId),
    enabled:
      !!companyId &&
      bookCustomerQuery.isSuccess &&
      bookCustomerQuery.data === null,
    staleTime: 5 * 60 * 1000,
  });

  const customer = bookCustomerQuery.data ?? directCustomerQuery.data ?? null;

  const equipmentQuery = useQuery({
    queryKey: [...detailKey, "equipment"],
    queryFn: () => fetchCustomerEquipment(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const dealsQuery = useQuery({
    queryKey: [...detailKey, "deals"],
    queryFn: () => fetchCustomerDeals(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const activitiesQuery = useQuery({
    queryKey: [...detailKey, "activities"],
    queryFn: () => fetchCustomerActivities(companyId),
    enabled: !!companyId,
    staleTime: 2 * 60 * 1000,
  });

  const quotesQuery = useQuery({
    queryKey: [...detailKey, "quotes"],
    queryFn: () => fetchCustomerQuotes(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  // Customer is "loading" while the book query is in flight, OR while the
  // fallback direct fetch is in flight after a book miss.
  const customerLoading =
    bookCustomerQuery.isLoading ||
    (bookCustomerQuery.isSuccess &&
      bookCustomerQuery.data === null &&
      directCustomerQuery.isLoading);

  return {
    customer,
    equipment: equipmentQuery.data ?? [],
    deals: dealsQuery.data ?? [],
    activities: activitiesQuery.data ?? [],
    quotes: quotesQuery.data ?? [],
    isLoading:
      customerLoading ||
      equipmentQuery.isLoading ||
      dealsQuery.isLoading ||
      activitiesQuery.isLoading,
    error:
      bookCustomerQuery.error ||
      directCustomerQuery.error ||
      equipmentQuery.error ||
      dealsQuery.error ||
      activitiesQuery.error,
  };
}
