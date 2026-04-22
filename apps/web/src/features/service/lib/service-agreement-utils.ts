export type ServiceAgreementStatus = "draft" | "active" | "expired" | "cancelled";

export function deriveServiceAgreementStatus(
  status: ServiceAgreementStatus,
  expiresOn: string | null,
  now = new Date(),
): ServiceAgreementStatus {
  if (status === "cancelled" || status === "draft") return status;
  if (!expiresOn) return status;
  const expiry = new Date(`${expiresOn}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) return status;
  return expiry.getTime() < now.getTime() ? "expired" : status;
}

export function formatAgreementWindow(startsOn: string | null, expiresOn: string | null): string {
  const fmt = (value: string | null) =>
    value
      ? new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";
  return `${fmt(startsOn)} → ${fmt(expiresOn)}`;
}

export function matchesAgreementSearch(
  row: {
    contract_number: string;
    location_code: string | null;
    program_name: string;
    category: string | null;
    qrm_companies?: { name?: string } | { name?: string }[] | null;
    qrm_equipment?: {
      stock_number?: string | null;
      serial_number?: string | null;
      make?: string | null;
      model?: string | null;
    } | Array<{
      stock_number?: string | null;
      serial_number?: string | null;
      make?: string | null;
      model?: string | null;
    }> | null;
  },
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const company = Array.isArray(row.qrm_companies) ? row.qrm_companies[0] : row.qrm_companies;
  const equipment = Array.isArray(row.qrm_equipment) ? row.qrm_equipment[0] : row.qrm_equipment;
  const haystack = [
    row.contract_number,
    row.location_code,
    row.program_name,
    row.category,
    company?.name,
    equipment?.stock_number,
    equipment?.serial_number,
    equipment?.make,
    equipment?.model,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
