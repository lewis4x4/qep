import type { RepCustomer } from "./types";

function startsWithLegacyCode(value: string | null | undefined, query: string): boolean {
  if (!value) return false;
  return value.toLowerCase().startsWith(query);
}

export function matchesRepCustomerSearch(customer: RepCustomer, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  return (
    customer.company_name?.toLowerCase().includes(query) ||
    customer.primary_contact_name?.toLowerCase().includes(query) ||
    customer.city?.toLowerCase().includes(query) ||
    customer.state?.toLowerCase().includes(query) ||
    startsWithLegacyCode(customer.search_1, query) ||
    startsWithLegacyCode(customer.search_2, query)
  );
}
