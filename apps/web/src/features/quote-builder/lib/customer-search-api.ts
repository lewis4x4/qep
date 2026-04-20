/**
 * Customer search service — Slice post-ship.
 *
 * Unified search over crm_contacts + crm_companies with in-the-moment
 * signals (open deal count + value, last contact age, past quote count).
 * Replaces the 4-field free-text form in Quote Builder step 1.
 *
 * Design principles:
 *  - Single query entry point per keystroke (debounced in the UI).
 *  - 2 parallel base queries (contacts, companies) + 1 batched signals
 *    query keyed on company IDs. RLS does workspace isolation for free.
 *  - Pure ranking + warmth helpers exported separately for tests.
 *  - No new migrations; no new edge function. All through supabase-js.
 *
 * Result shape is a discriminated union so the UI can render two row
 * types (contact-with-company vs. bare company) from one list.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

// CRM entities live under the `public` schema as views, not tables
// (they're materialized off the underlying qrm_* tables). The Row
// shape is still the one Supabase returns on a select.
type CompanyRow = Database["public"]["Views"]["crm_companies"]["Row"];
type ContactRow = Database["public"]["Views"]["crm_contacts"]["Row"];
type DealRow    = Database["public"]["Views"]["crm_deals"]["Row"];
type ActivityRow = Database["public"]["Views"]["crm_activities"]["Row"];

// ── Public types ─────────────────────────────────────────────────────────

export type CustomerWarmth = "warm" | "cool" | "dormant" | "new";

export interface CompanySignals {
  openDeals:            number;
  openDealValueCents:   number;
  lastContactDaysAgo:   number | null;
  pastQuoteCount:       number;
  pastQuoteValueCents:  number;
}

/** Empty signals — sane default for brand-new companies. */
export const EMPTY_SIGNALS: CompanySignals = {
  openDeals: 0,
  openDealValueCents: 0,
  lastContactDaysAgo: null,
  pastQuoteCount: 0,
  pastQuoteValueCents: 0,
};

export interface CustomerSearchContact {
  kind: "contact";
  contactId:     string;
  contactName:   string;
  contactTitle:  string | null;
  contactEmail:  string | null;
  contactPhone:  string | null;
  companyId:     string | null;
  companyName:   string | null;
  companyCity:   string | null;
  companyState:  string | null;
  signals:       CompanySignals;
  warmth:        CustomerWarmth;
}

export interface CustomerSearchCompany {
  kind: "company";
  companyId:     string;
  companyName:   string;
  companyDba:    string | null;
  companyPhone:  string | null;
  companyCity:   string | null;
  companyState:  string | null;
  companyClassification: string | null;
  contactCount:  number;
  signals:       CompanySignals;
  warmth:        CustomerWarmth;
}

export type CustomerSearchResult = CustomerSearchContact | CustomerSearchCompany;

// ── Search constants ─────────────────────────────────────────────────────

export const MIN_QUERY_CHARS  = 2;
export const MAX_CONTACTS     = 6;
export const MAX_COMPANIES    = 4;

// Warmth thresholds (days since last contact activity)
export const WARM_DAYS_MAX    = 30;
export const COOL_DAYS_MAX    = 90;

// ── Main entry ───────────────────────────────────────────────────────────

/**
 * Run a unified customer search. Returns interleaved contact + company
 * rows, sorted for operator value (freshest contacts first, then
 * companies, then warmth tie-break).
 *
 * @param rawQuery  What the rep typed in the picker
 * @param limit     Total rows to return (default 8 — fits on screen)
 */
export async function searchCustomers(
  rawQuery: string,
  limit = 8,
): Promise<CustomerSearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_CHARS) return [];

  // Sanitize ilike wildcards — chars that would change pattern semantics
  const sanitized = query.replace(/[\\%_]/g, "");
  const pattern = `%${sanitized}%`;

  const [contactsRes, companiesRes] = await Promise.all([
    supabase
      .from("crm_contacts")
      .select("id, first_name, last_name, title, email, phone, primary_company_id")
      .is("deleted_at", null)
      .or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`,
      )
      .limit(MAX_CONTACTS),
    supabase
      .from("crm_companies")
      .select("id, name, dba, phone, city, state, classification")
      .is("deleted_at", null)
      .or(`name.ilike.${pattern},dba.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(MAX_COMPANIES),
  ]);

  const contacts = (contactsRes.data ?? []) as Pick<ContactRow,
    "id" | "first_name" | "last_name" | "title" | "email" | "phone" | "primary_company_id">[];
  const companies = (companiesRes.data ?? []) as Pick<CompanyRow,
    "id" | "name" | "dba" | "phone" | "city" | "state" | "classification">[];

  // Collect every distinct company id referenced — both by direct company
  // hits AND by the contacts' primary_company_id — so we hydrate signals
  // in one batch fetch. Skipping when no company ids avoids a wasted
  // query on pure-contact matches that have no linked company.
  const companyIdSet = new Set<string>();
  for (const c of contacts) if (c.primary_company_id) companyIdSet.add(c.primary_company_id);
  for (const c of companies) if (c.id) companyIdSet.add(c.id);
  const companyIds = [...companyIdSet];

  // For company rows we also want the contact count at that company.
  const allCompanyIds = companies.map((c) => c.id).filter((v): v is string => !!v);

  const signalsByCompany = companyIds.length > 0
    ? await fetchSignalsForCompanies(companyIds)
    : new Map<string, CompanySignals>();

  const contactCountByCompany = allCompanyIds.length > 0
    ? await fetchContactCounts(allCompanyIds)
    : new Map<string, number>();

  // Fetch company names for contacts' primary_company_id so we can show
  // "Angela Peterson · Acme Landscaping" even when the search hit only
  // the contact row, not the company row.
  const contactCompanyIds = [...new Set(
    contacts
      .map((c) => c.primary_company_id)
      .filter((v): v is string => !!v),
  )];
  const companyById = new Map<string, Pick<CompanyRow, "id" | "name" | "city" | "state">>();
  for (const c of companies) {
    if (c.id) companyById.set(c.id, { id: c.id, name: c.name ?? "", city: c.city, state: c.state });
  }
  const missingCompanyIds = contactCompanyIds.filter((id) => !companyById.has(id));
  if (missingCompanyIds.length > 0) {
    const { data: extras } = await supabase
      .from("crm_companies")
      .select("id, name, city, state")
      .in("id", missingCompanyIds);
    for (const row of (extras ?? []) as Pick<CompanyRow, "id" | "name" | "city" | "state">[]) {
      if (row.id) companyById.set(row.id, row);
    }
  }

  return assembleResults({
    contacts, companies, signalsByCompany, contactCountByCompany, companyById,
    limit,
  });
}

// ── Pure assembly + ranking (exported for tests) ─────────────────────────

export function assembleResults(input: {
  contacts:               Pick<ContactRow, "id" | "first_name" | "last_name" | "title" | "email" | "phone" | "primary_company_id">[];
  companies:              Pick<CompanyRow, "id" | "name" | "dba" | "phone" | "city" | "state" | "classification">[];
  signalsByCompany:       Map<string, CompanySignals>;
  contactCountByCompany:  Map<string, number>;
  companyById:            Map<string, Pick<CompanyRow, "id" | "name" | "city" | "state">>;
  limit:                  number;
}): CustomerSearchResult[] {
  const contactRows: CustomerSearchContact[] = input.contacts.map((c) => {
    const companyRef = c.primary_company_id ? input.companyById.get(c.primary_company_id) : null;
    const signals = (c.primary_company_id
      ? input.signalsByCompany.get(c.primary_company_id)
      : undefined) ?? EMPTY_SIGNALS;
    return {
      kind:          "contact",
      contactId:     c.id ?? "",
      contactName:   formatContactName(c.first_name, c.last_name),
      contactTitle:  c.title ?? null,
      contactEmail:  c.email ?? null,
      contactPhone:  c.phone ?? null,
      companyId:     c.primary_company_id ?? null,
      companyName:   companyRef?.name ?? null,
      companyCity:   companyRef?.city ?? null,
      companyState:  companyRef?.state ?? null,
      signals,
      warmth:        deriveWarmth(signals),
    };
  });

  const companyRows: CustomerSearchCompany[] = input.companies.map((c) => {
    const companyId = c.id ?? "";
    const signals = input.signalsByCompany.get(companyId) ?? EMPTY_SIGNALS;
    return {
      kind:                  "company",
      companyId,
      companyName:           c.name ?? "",
      companyDba:            c.dba ?? null,
      companyPhone:          c.phone ?? null,
      companyCity:           c.city ?? null,
      companyState:          c.state ?? null,
      companyClassification: c.classification ?? null,
      contactCount:          input.contactCountByCompany.get(companyId) ?? 0,
      signals,
      warmth:                deriveWarmth(signals),
    };
  });

  // Interleave: contacts first (primary operator intent is "who am I
  // selling to"), then bare-company hits for cases where the rep typed
  // the company name but no contact matched. Then cap at limit.
  return [...contactRows, ...companyRows].slice(0, input.limit);
}

export function formatContactName(first: string | null, last: string | null): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f && l) return `${f} ${l}`;
  return f || l || "(unnamed contact)";
}

/** Exported for tests. Pure. */
export function deriveWarmth(signals: CompanySignals): CustomerWarmth {
  if (signals.lastContactDaysAgo == null && signals.pastQuoteCount === 0 && signals.openDeals === 0) {
    return "new";
  }
  if (signals.lastContactDaysAgo == null) {
    // Never contacted but had past activity/quote — treat as cool
    return "cool";
  }
  if (signals.lastContactDaysAgo <= WARM_DAYS_MAX) return "warm";
  if (signals.lastContactDaysAgo <= COOL_DAYS_MAX) return "cool";
  return "dormant";
}

// ── Signal fetching ──────────────────────────────────────────────────────

/**
 * One-shot signal hydration across up to ~10 company ids. Runs three
 * parallel aggregation queries. Returns a map keyed by company id.
 */
async function fetchSignalsForCompanies(
  companyIds: string[],
): Promise<Map<string, CompanySignals>> {
  const [openDealsRes, activitiesRes, companiesRes] = await Promise.all([
    // Open deals per company
    supabase
      .from("crm_deals")
      .select("company_id, amount")
      .in("company_id", companyIds)
      .is("closed_at", null)
      .is("deleted_at", null),

    // Most recent activity per company (we pull the full set in this
    // window and reduce client-side — simpler than a grouped query)
    supabase
      .from("crm_activities")
      .select("company_id, occurred_at")
      .in("company_id", companyIds)
      .not("occurred_at", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(companyIds.length * 10),  // enough headroom to see each company's top row

    // Company names for quote_packages matching by customer_company
    // (quote_packages stores the company as a string, not FK)
    supabase
      .from("crm_companies")
      .select("id, name")
      .in("id", companyIds),
  ]);

  const signals = new Map<string, CompanySignals>();
  for (const id of companyIds) signals.set(id, { ...EMPTY_SIGNALS });

  // Open deals rollup
  for (const d of (openDealsRes.data ?? []) as Pick<DealRow, "company_id" | "amount">[]) {
    if (!d.company_id) continue;
    const slot = signals.get(d.company_id);
    if (!slot) continue;
    slot.openDeals += 1;
    slot.openDealValueCents += Math.round(Number(d.amount ?? 0) * 100);
  }

  // Latest activity per company
  const seenLatest = new Set<string>();
  const now = new Date();
  for (const a of (activitiesRes.data ?? []) as Pick<ActivityRow, "company_id" | "occurred_at">[]) {
    if (!a.company_id || !a.occurred_at) continue;
    if (seenLatest.has(a.company_id)) continue;
    seenLatest.add(a.company_id);
    const slot = signals.get(a.company_id);
    if (!slot) continue;
    slot.lastContactDaysAgo = daysBetween(new Date(a.occurred_at), now);
  }

  // Past quote count — match by company NAME since quote_packages has no
  // company FK. Pull distinct names, then run one ilike batch.
  const namesByCompanyId = new Map<string, string>();
  for (const c of (companiesRes.data ?? []) as { id: string; name: string | null }[]) {
    if (c.id && c.name) namesByCompanyId.set(c.id, c.name);
  }
  if (namesByCompanyId.size > 0) {
    const namesList = [...namesByCompanyId.values()];
    const { data: pastQuotes } = await supabase
      .from("quote_packages")
      .select("customer_company, net_total")
      .in("customer_company", namesList);
    for (const q of (pastQuotes ?? []) as { customer_company: string | null; net_total: number | null }[]) {
      if (!q.customer_company) continue;
      // Find the company id for this name (first hit wins — rare collisions)
      for (const [companyId, name] of namesByCompanyId) {
        if (name === q.customer_company) {
          const slot = signals.get(companyId);
          if (slot) {
            slot.pastQuoteCount += 1;
            slot.pastQuoteValueCents += Math.round(Number(q.net_total ?? 0) * 100);
          }
          break;
        }
      }
    }
  }

  return signals;
}

async function fetchContactCounts(companyIds: string[]): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("crm_contacts")
    .select("primary_company_id")
    .in("primary_company_id", companyIds)
    .is("deleted_at", null);

  const counts = new Map<string, number>();
  for (const c of (data ?? []) as { primary_company_id: string | null }[]) {
    if (!c.primary_company_id) continue;
    counts.set(c.primary_company_id, (counts.get(c.primary_company_id) ?? 0) + 1);
  }
  return counts;
}

// ── Pure numeric helper ──────────────────────────────────────────────────

export function daysBetween(past: Date, now: Date): number {
  const diffMs = now.getTime() - past.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ── Slice 20a: Digital Twin hydration ────────────────────────────────────

/**
 * Fetch a customer's past equipment fleet — the top distinct make+model
 * combos from prior quote_packages. Rendered on the Customer step so the
 * rep immediately sees "they've quoted Cat 259D3 × 2 and Kubota SVL75-2"
 * before picking equipment. Drives the Customer Digital Twin surface.
 *
 * Matches on customer_company because quote_packages has no company FK.
 * Returns top 5 distinct combos by recency, with quote count per combo.
 */
export interface CustomerPastEquipment {
  make:  string;
  model: string;
  count: number;
  lastQuotedAt: string | null;
}

export async function fetchCustomerPastEquipment(
  customerCompany: string,
): Promise<CustomerPastEquipment[]> {
  const name = customerCompany.trim();
  if (!name) return [];

  // quote_packages stores equipment as a JSON array on the row itself
  // (no separate quote_package_items table). Pull the most recent 50
  // packages for this company and roll up distinct make+model.
  const { data: packages } = await supabase
    .from("quote_packages")
    .select("equipment, created_at")
    .eq("customer_company", name)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!packages || packages.length === 0) return [];

  const rollup = new Map<string, CustomerPastEquipment>();
  for (const row of packages as { equipment: unknown; created_at: string | null }[]) {
    const createdAt = row.created_at ?? null;
    const items = Array.isArray(row.equipment) ? row.equipment : [];
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const kind = typeof item.kind === "string" ? item.kind : null;
      if (kind && kind !== "equipment") continue;
      const make  = typeof item.make  === "string" ? item.make.trim()  : "";
      const model = typeof item.model === "string" ? item.model.trim() : "";
      if (!make && !model) continue;
      const key = `${make}|${model}`;
      const existing = rollup.get(key);
      if (existing) {
        existing.count += 1;
        if (createdAt && (!existing.lastQuotedAt || createdAt > existing.lastQuotedAt)) {
          existing.lastQuotedAt = createdAt;
        }
      } else {
        rollup.set(key, { make, model, count: 1, lastQuotedAt: createdAt });
      }
    }
  }

  return [...rollup.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (!a.lastQuotedAt) return 1;
      if (!b.lastQuotedAt) return -1;
      return b.lastQuotedAt.localeCompare(a.lastQuotedAt);
    })
    .slice(0, 5);
}

/**
 * Hydrate a customer from a CRM contact id or company id — used when
 * Quote Builder is deep-linked from QRM with `?contact_id=` or
 * `?deal_id=`. Resolves the same shape the CustomerPicker emits so the
 * draft can be seeded and the intel panel renders on mount.
 */
export async function hydrateCustomerById(args: {
  contactId?: string | null;
  companyId?: string | null;
}): Promise<{
  contactId: string | null;
  companyId: string | null;
  customerName: string;
  customerCompany: string;
  customerPhone: string;
  customerEmail: string;
  signals: CompanySignals;
  warmth: CustomerWarmth;
} | null> {
  const { contactId, companyId } = args;
  if (!contactId && !companyId) return null;

  let resolvedContactId: string | null = null;
  let resolvedCompanyId: string | null = companyId ?? null;
  let contactName = "";
  let contactPhone = "";
  let contactEmail = "";
  let companyName = "";

  if (contactId) {
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("id, first_name, last_name, phone, email, primary_company_id")
      .eq("id", contactId)
      .is("deleted_at", null)
      .maybeSingle();
    if (contact) {
      const c = contact as Pick<ContactRow,
        "id" | "first_name" | "last_name" | "phone" | "email" | "primary_company_id">;
      resolvedContactId = c.id ?? null;
      contactName  = formatContactName(c.first_name, c.last_name);
      contactPhone = c.phone ?? "";
      contactEmail = c.email ?? "";
      if (!resolvedCompanyId && c.primary_company_id) {
        resolvedCompanyId = c.primary_company_id;
      }
    }
  }

  if (resolvedCompanyId) {
    const { data: company } = await supabase
      .from("crm_companies")
      .select("id, name")
      .eq("id", resolvedCompanyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (company) {
      companyName = (company as { name: string | null }).name ?? "";
    }
  }

  if (!resolvedContactId && !resolvedCompanyId) return null;

  const signalsMap = resolvedCompanyId
    ? await fetchSignalsForCompanies([resolvedCompanyId])
    : new Map<string, CompanySignals>();
  const signals = (resolvedCompanyId && signalsMap.get(resolvedCompanyId)) || { ...EMPTY_SIGNALS };

  return {
    contactId:       resolvedContactId,
    companyId:       resolvedCompanyId,
    customerName:    contactName,
    customerCompany: companyName,
    customerPhone:   contactPhone,
    customerEmail:   contactEmail,
    signals,
    warmth:          deriveWarmth(signals),
  };
}
