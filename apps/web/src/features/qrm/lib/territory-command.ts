export interface TerritoryContactRow {
  id: string;
  first_name: string;
  last_name: string;
  primary_company_id: string | null;
}

export interface TerritoryCompanyRow {
  id: string;
  name: string;
}

export interface TerritoryDealRow {
  id: string;
  name: string;
  company_id: string | null;
  primary_contact_id: string | null;
  amount: number | null;
  expected_close_on: string | null;
  next_follow_up_at: string | null;
}

export interface TerritoryActivityRow {
  occurred_at: string;
  company_id: string | null;
  contact_id: string | null;
}

export interface TerritoryRow {
  id: string;
  name: string;
  description: string | null;
  assigned_rep_id: string | null;
}

export interface TerritoryLinkRow {
  contact_id: string;
}

export interface TerritoryPriorityRow {
  key: string;
  companyId: string | null;
  companyName: string;
  primaryContactId: string | null;
  primaryContactName: string | null;
  openDealCount: number;
  openPipelineValue: number;
  staleDays: number | null;
  overdueFollowUps: number;
  closingSoonCount: number;
  priorityScore: number;
  reasons: string[];
}

export interface TerritoryCommandSummary {
  contactCount: number;
  accountCount: number;
  openDealCount: number;
  overdueFollowUps: number;
  highPriorityCount: number;
}

function daysBetween(from: string | null | undefined, nowTime: number): number | null {
  if (!from) return null;
  const parsed = Date.parse(from);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((nowTime - parsed) / 86_400_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringIdsFromRows(rows: unknown, key: string): string[] {
  if (!Array.isArray(rows)) return [];

  return [...new Set(rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const value = row[key];
    return typeof value === "string" && value.trim().length > 0 ? [value] : [];
  }))];
}

export function buildTerritoryCommandHref(territoryId: string): string {
  return `/qrm/territories/${territoryId}/command`;
}

export function normalizeTerritoryRow(row: unknown): TerritoryRow | null {
  if (!isRecord(row) || typeof row.id !== "string") return null;

  return {
    id: row.id,
    name: requiredString(row.name, "Unnamed territory"),
    description: nullableString(row.description),
    assigned_rep_id: nullableString(row.assigned_rep_id),
  };
}

export function normalizeTerritoryLinkRows(rows: unknown): TerritoryLinkRow[] {
  return stringIdsFromRows(rows, "contact_id").map((contact_id) => ({ contact_id }));
}

export function extractTerritoryCompanyIds(rows: unknown): string[] {
  return stringIdsFromRows(rows, "primary_company_id");
}

export function normalizeTerritoryContactRows(rows: unknown): TerritoryContactRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      first_name: requiredString(row.first_name, ""),
      last_name: requiredString(row.last_name, ""),
      primary_company_id: nullableString(row.primary_company_id),
    }];
  });
}

export function normalizeTerritoryCompanyRows(rows: unknown): TerritoryCompanyRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      name: requiredString(row.name, "Unnamed account"),
    }];
  });
}

export function normalizeTerritoryDealRows(rows: unknown): TerritoryDealRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      name: requiredString(row.name, "Unnamed deal"),
      company_id: nullableString(row.company_id),
      primary_contact_id: nullableString(row.primary_contact_id),
      amount: nullableNumber(row.amount),
      expected_close_on: nullableString(row.expected_close_on),
      next_follow_up_at: nullableString(row.next_follow_up_at),
    }];
  });
}

export function normalizeTerritoryActivityRows(rows: unknown): TerritoryActivityRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.occurred_at !== "string") return [];

    return [{
      occurred_at: row.occurred_at,
      company_id: nullableString(row.company_id),
      contact_id: nullableString(row.contact_id),
    }];
  });
}

export function computeTerritoryVisitPriorities(input: {
  contacts: TerritoryContactRow[];
  companies: TerritoryCompanyRow[];
  deals: TerritoryDealRow[];
  activities: TerritoryActivityRow[];
  nowTime?: number;
}): { summary: TerritoryCommandSummary; rows: TerritoryPriorityRow[] } {
  const nowTime = input.nowTime ?? Date.now();
  const companyNameById = new Map(input.companies.map((row) => [row.id, row.name]));
  const contactsByCompany = new Map<string, TerritoryContactRow[]>();
  const activitiesByKey = new Map<string, TerritoryActivityRow[]>();

  for (const contact of input.contacts) {
    if (!contact.primary_company_id) continue;
    const bucket = contactsByCompany.get(contact.primary_company_id) ?? [];
    bucket.push(contact);
    contactsByCompany.set(contact.primary_company_id, bucket);
  }

  for (const activity of input.activities) {
    const companyKey = activity.company_id ? `company:${activity.company_id}` : null;
    const contactKey = activity.contact_id ? `contact:${activity.contact_id}` : null;
    for (const key of [companyKey, contactKey]) {
      if (!key) continue;
      const bucket = activitiesByKey.get(key) ?? [];
      bucket.push(activity);
      activitiesByKey.set(key, bucket);
    }
  }

  const grouped = new Map<string, TerritoryPriorityRow>();

  const ensureRow = (companyId: string | null, contact: TerritoryContactRow | null): TerritoryPriorityRow => {
    const key = companyId ? `company:${companyId}` : `contact:${contact?.id ?? "unknown"}`;
    const existing = grouped.get(key);
    if (existing) return existing;

    const primaryContactName = contact
      ? `${contact.first_name} ${contact.last_name}`.trim()
      : null;

    const created: TerritoryPriorityRow = {
      key,
      companyId,
      companyName: companyId
        ? companyNameById.get(companyId) ?? "Unlinked company"
        : primaryContactName ?? "Territory contact",
      primaryContactId: contact?.id ?? null,
      primaryContactName,
      openDealCount: 0,
      openPipelineValue: 0,
      staleDays: null,
      overdueFollowUps: 0,
      closingSoonCount: 0,
      priorityScore: 0,
      reasons: [],
    };
    grouped.set(key, created);
    return created;
  };

  for (const contact of input.contacts) {
    ensureRow(contact.primary_company_id, contact);
  }

  for (const deal of input.deals) {
    const fallbackContact = input.contacts.find((row) => row.id === deal.primary_contact_id) ?? null;
    const row = ensureRow(deal.company_id, fallbackContact);
    row.openDealCount += 1;
    row.openPipelineValue += Number(deal.amount ?? 0);

    const closingSoonDays = daysBetween(deal.expected_close_on, nowTime);
    if (closingSoonDays !== null && closingSoonDays <= 14 && closingSoonDays >= -365) {
      row.closingSoonCount += 1;
    }

    const followUpDays = daysBetween(deal.next_follow_up_at, nowTime);
    if (followUpDays !== null && followUpDays > 0) {
      row.overdueFollowUps += 1;
    }
  }

  for (const row of grouped.values()) {
    const companyActivities = row.companyId ? activitiesByKey.get(`company:${row.companyId}`) ?? [] : [];
    const contactActivities = row.primaryContactId ? activitiesByKey.get(`contact:${row.primaryContactId}`) ?? [] : [];
    const latest = [...companyActivities, ...contactActivities]
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;
    row.staleDays = daysBetween(latest?.occurred_at ?? null, nowTime);

    let score = 0;
    const reasons: string[] = [];

    if (row.openDealCount > 0) {
      score += 30 + Math.min(20, row.openDealCount * 5);
      reasons.push(`${row.openDealCount} open deal${row.openDealCount === 1 ? "" : "s"}`);
    }
    if (row.openPipelineValue > 0) {
      score += Math.min(20, Math.round(row.openPipelineValue / 50_000) * 5);
      reasons.push(`$${Math.round(row.openPipelineValue).toLocaleString()} pipeline`);
    }
    if (row.overdueFollowUps > 0) {
      score += row.overdueFollowUps * 15;
      reasons.push(`${row.overdueFollowUps} overdue follow-up${row.overdueFollowUps === 1 ? "" : "s"}`);
    }
    if (row.closingSoonCount > 0) {
      score += row.closingSoonCount * 10;
      reasons.push(`${row.closingSoonCount} closing soon`);
    }
    if (row.staleDays !== null) {
      if (row.staleDays >= 14) {
        score += 20;
        reasons.push(`${row.staleDays}d since last touch`);
      } else if (row.staleDays >= 7) {
        score += 10;
        reasons.push(`${row.staleDays}d since last touch`);
      }
    }

    row.priorityScore = score;
    row.reasons = reasons;
  }

  const rows = [...grouped.values()].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (b.openPipelineValue !== a.openPipelineValue) return b.openPipelineValue - a.openPipelineValue;
    return a.companyName.localeCompare(b.companyName);
  });

  return {
    summary: {
      contactCount: input.contacts.length,
      accountCount: new Set(input.contacts.map((row) => row.primary_company_id).filter(Boolean)).size,
      openDealCount: input.deals.length,
      overdueFollowUps: rows.reduce((sum, row) => sum + row.overdueFollowUps, 0),
      highPriorityCount: rows.filter((row) => row.priorityScore >= 40).length,
    },
    rows,
  };
}
