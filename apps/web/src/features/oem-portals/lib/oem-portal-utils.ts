export type OemPortalRow = {
  id: string;
  brand_code: string | null;
  oem_name: string;
  portal_name: string;
  segment: "construction" | "forestry" | "industrial" | "support";
  launch_url: string | null;
  status: "active" | "needs_setup" | "paused";
  access_mode: "bookmark_only" | "shared_login" | "individual_login" | "oauth_ready" | "api_only";
  favorite: boolean;
  mfa_required: boolean;
  credential_owner: string | null;
  support_contact: string | null;
  notes: string | null;
  sort_order: number;
};

export function matchesOemPortalFilters(
  row: OemPortalRow,
  filters: {
    search?: string;
    segment?: string;
    status?: string;
    accessMode?: string;
  },
): boolean {
  if (filters.segment && filters.segment !== "all" && row.segment !== filters.segment) return false;
  if (filters.status && filters.status !== "all" && row.status !== filters.status) return false;
  if (filters.accessMode && filters.accessMode !== "all" && row.access_mode !== filters.accessMode) return false;

  const needle = filters.search?.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    row.brand_code,
    row.oem_name,
    row.portal_name,
    row.segment,
    row.credential_owner,
    row.support_contact,
    row.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

export function sortOemPortals(rows: OemPortalRow[]): OemPortalRow[] {
  return [...rows].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.oem_name.localeCompare(b.oem_name);
  });
}

export function countPortalSetupReady(rows: OemPortalRow[]): number {
  return rows.filter((row) => row.status === "active" && !!row.launch_url).length;
}
