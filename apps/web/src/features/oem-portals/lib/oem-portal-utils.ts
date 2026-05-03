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

const OEM_PORTAL_SEGMENTS = new Set<OemPortalRow["segment"]>([
  "construction",
  "forestry",
  "industrial",
  "support",
]);

const OEM_PORTAL_STATUSES = new Set<OemPortalRow["status"]>([
  "active",
  "needs_setup",
  "paused",
]);

const OEM_PORTAL_ACCESS_MODES = new Set<OemPortalRow["access_mode"]>([
  "bookmark_only",
  "shared_login",
  "individual_login",
  "oauth_ready",
  "api_only",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteNumberOrDefault(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeOemPortalRows(rows: unknown): OemPortalRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const oemName = stringOrNull(row.oem_name);
    const portalName = stringOrNull(row.portal_name);
    if (!id || !oemName || !portalName) return [];

    const segment = stringOrNull(row.segment);
    const status = stringOrNull(row.status);
    const accessMode = stringOrNull(row.access_mode);

    return [{
      id,
      brand_code: stringOrNull(row.brand_code),
      oem_name: oemName,
      portal_name: portalName,
      segment: segment && OEM_PORTAL_SEGMENTS.has(segment as OemPortalRow["segment"])
        ? segment as OemPortalRow["segment"]
        : "support",
      launch_url: stringOrNull(row.launch_url),
      status: status && OEM_PORTAL_STATUSES.has(status as OemPortalRow["status"])
        ? status as OemPortalRow["status"]
        : "needs_setup",
      access_mode: accessMode && OEM_PORTAL_ACCESS_MODES.has(accessMode as OemPortalRow["access_mode"])
        ? accessMode as OemPortalRow["access_mode"]
        : "bookmark_only",
      favorite: row.favorite === true,
      mfa_required: row.mfa_required === true,
      credential_owner: stringOrNull(row.credential_owner),
      support_contact: stringOrNull(row.support_contact),
      notes: stringOrNull(row.notes),
      sort_order: finiteNumberOrDefault(row.sort_order, 999),
    }];
  });
}

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
