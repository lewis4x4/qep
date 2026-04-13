import { useQuery } from "@tanstack/react-query";
import {
  fetchCustomerEquipment,
  fetchCustomerDeals,
  fetchCustomerActivities,
  fetchCustomerQuotes,
} from "../lib/sales-api";
import { fetchRepCustomers } from "../lib/sales-api";

export function useCustomerDetail(companyId: string) {
  const customerQuery = useQuery({
    queryKey: ["sales", "customers"],
    queryFn: fetchRepCustomers,
    staleTime: 5 * 60 * 1000,
    select: (data) => data.find((c) => c.customer_id === companyId) ?? null,
  });

  const equipmentQuery = useQuery({
    queryKey: ["sales", "customer-equipment", companyId],
    queryFn: () => fetchCustomerEquipment(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const dealsQuery = useQuery({
    queryKey: ["sales", "customer-deals", companyId],
    queryFn: () => fetchCustomerDeals(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const activitiesQuery = useQuery({
    queryKey: ["sales", "customer-activities", companyId],
    queryFn: () => fetchCustomerActivities(companyId),
    enabled: !!companyId,
    staleTime: 2 * 60 * 1000,
  });

  const quotesQuery = useQuery({
    queryKey: ["sales", "customer-quotes", companyId],
    queryFn: () => fetchCustomerQuotes(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    customer: customerQuery.data ?? null,
    equipment: equipmentQuery.data ?? [],
    deals: dealsQuery.data ?? [],
    activities: activitiesQuery.data ?? [],
    quotes: quotesQuery.data ?? [],
    isLoading:
      customerQuery.isLoading ||
      equipmentQuery.isLoading ||
      dealsQuery.isLoading ||
      activitiesQuery.isLoading,
    error:
      customerQuery.error ||
      equipmentQuery.error ||
      dealsQuery.error ||
      activitiesQuery.error,
  };
}
