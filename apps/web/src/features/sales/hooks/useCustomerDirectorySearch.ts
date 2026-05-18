import { useQuery } from "@tanstack/react-query";
import {
  searchCustomers,
  type CustomerSearchResult,
} from "@/features/quote-builder/lib/customer-search-api";

/**
 * Search the dealer-wide customer directory (crm_companies + crm_contacts),
 * not just the rep's book of business. Fires only when the trimmed query
 * has at least 2 characters — matches the MIN_QUERY_CHARS guard in
 * searchCustomers.
 */
export function useCustomerDirectorySearch(query: string) {
  const trimmed = query.trim();
  return useQuery<CustomerSearchResult[]>({
    queryKey: ["sales", "customer-directory", trimmed.toLowerCase()],
    queryFn: () => searchCustomers(trimmed, 8),
    enabled: trimmed.length >= 2,
    staleTime: 60 * 1000,
  });
}
