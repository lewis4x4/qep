import type { RepCustomer } from "./types";

function startsWithLegacyCode(value: string | null | undefined, query: string): boolean {
  if (!value) return false;
  return value.toLowerCase().startsWith(query);
}

function digitsOnly(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D+/g, "");
}

export function matchesRepCustomerSearch(customer: RepCustomer, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const queryDigits = digitsOnly(query);
  const phoneDigits = digitsOnly(customer.primary_contact_phone);
  const phoneMatches = queryDigits.length >= 3 && phoneDigits.includes(queryDigits);

  return (
    customer.company_name?.toLowerCase().includes(query) ||
    customer.primary_contact_name?.toLowerCase().includes(query) ||
    phoneMatches ||
    customer.city?.toLowerCase().includes(query) ||
    customer.state?.toLowerCase().includes(query) ||
    startsWithLegacyCode(customer.search_1, query) ||
    startsWithLegacyCode(customer.search_2, query)
  );
}
