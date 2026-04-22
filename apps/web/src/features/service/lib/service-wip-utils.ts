import type { ServiceJobWithRelations } from "./types";

export type ServiceWipAgingBucket = "current" | "31_60" | "61_90" | "91_120" | "over_120";
export type ServiceWipBillingStatus = "customer" | "warranty" | "internal";

export function getServiceWipBillingStatus(
  job: Pick<ServiceJobWithRelations, "status_flags">,
): ServiceWipBillingStatus {
  const flags = job.status_flags ?? [];
  if (flags.includes("internal")) return "internal";
  if (flags.includes("warranty_recall")) return "warranty";
  return "customer";
}

export function getServiceWipAgingBucket(
  createdAt: string,
  now = new Date(),
): ServiceWipAgingBucket {
  const created = new Date(createdAt);
  const ageDays = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
  if (ageDays <= 30) return "current";
  if (ageDays <= 60) return "31_60";
  if (ageDays <= 90) return "61_90";
  if (ageDays <= 120) return "91_120";
  return "over_120";
}

export function getServiceWipValue(
  job: Pick<ServiceJobWithRelations, "invoice_total" | "quote_total">,
): number {
  return Number(job.invoice_total ?? job.quote_total ?? 0);
}

export function matchesServiceWipFilters(
  job: ServiceJobWithRelations,
  search: string,
  billingStatus: ServiceWipBillingStatus | "all",
  agingBucket: ServiceWipAgingBucket | "all",
  now = new Date(),
): boolean {
  if (billingStatus !== "all" && getServiceWipBillingStatus(job) !== billingStatus) return false;
  if (agingBucket !== "all" && getServiceWipAgingBucket(job.created_at, now) !== agingBucket) return false;

  const needle = search.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    job.customer?.name,
    job.machine?.serial_number,
    job.machine?.make,
    job.machine?.model,
    job.customer_problem_summary,
    job.branch_id,
    job.current_stage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}
