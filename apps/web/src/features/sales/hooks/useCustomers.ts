import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRepCustomers } from "../lib/sales-api";
import { matchesRepCustomerSearch } from "../lib/customer-search";

export function useCustomers() {
  const [search, setSearch] = useState("");

  const customersQuery = useQuery({
    queryKey: ["sales", "customers"],
    queryFn: fetchRepCustomers,
    staleTime: 5 * 60 * 1000,
  });

  const customers = customersQuery.data ?? [];

  const filtered = useMemo(() => {
    return customers.filter((customer) => matchesRepCustomerSearch(customer, search));
  }, [customers, search]);

  return {
    customers: filtered,
    allCustomers: customers,
    search,
    setSearch,
    isLoading: customersQuery.isLoading,
    error: customersQuery.error,
  };
}
