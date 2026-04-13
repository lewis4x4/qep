import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRepCustomers } from "../lib/sales-api";

export function useCustomers() {
  const [search, setSearch] = useState("");

  const customersQuery = useQuery({
    queryKey: ["sales", "customers"],
    queryFn: fetchRepCustomers,
    staleTime: 5 * 60 * 1000,
  });

  const customers = customersQuery.data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.company_name?.toLowerCase().includes(q) ||
        c.primary_contact_name?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q),
    );
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
