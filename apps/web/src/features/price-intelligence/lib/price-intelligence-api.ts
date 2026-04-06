import { supabase } from "@/lib/supabase";

const PRICE_IMPORT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/price-file-import`;
const REQUOTE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/requote-drafts`;

async function authHeadersJson(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

async function authHeadersFormData(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}

/* ── Types matching backend response ────────────────────────────── */

export interface ImpactItem {
  quote_package_id: string;
  workspace_id?: string;
  deal_id: string | null;
  quote_status: string;
  quote_total: number | null;
  quote_created_at: string;
  line_item_id: string;
  catalog_entry_id: string | null;
  make: string | null;
  model: string | null;
  quoted_list_price: number | null;
  current_list_price: number | null;
  price_delta_total: number | null;
  price_change_pct: number | null;
  price_changed_at: string | null;
  price_change_source: string | null;
}

export interface ImpactSummary {
  total_quotes_affected: number;
  total_deals_affected: number;
  total_dollar_exposure: number;
}

export interface ImpactReportResponse {
  summary: ImpactSummary;
  impact_items: ImpactItem[];
}

export interface PriceFileImportResult {
  rows_parsed: number;
  rows_imported: number;
  prices_changed: number;
  quotes_flagged: number;
  errors: string[];
}

export interface PriceFileImportResponse {
  ok: boolean;
  results: PriceFileImportResult;
  impact_report?: {
    total_line_items_affected: number;
    total_quotes_affected: number;
    total_deals_affected: number;
    total_dollar_exposure: number;
    top_10_by_dollar_impact: Array<{
      quote_package_id: string;
      deal_id: string | null;
      make: string | null;
      model: string | null;
      price_delta_total: number | null;
      price_change_pct: number | null;
    }>;
  };
}

export interface RequoteDraftResult {
  ok: boolean;
  email_draft: {
    id: string | null;
    subject: string;
    body: string;
    tone: "urgent" | "professional" | "friendly";
    ai_generated: boolean;
  };
  impact: {
    line_items_affected: number;
    total_dollar_delta: number;
    manufacturers: string;
    effective_date: string;
  };
}

/* ── API functions ───────────────────────────────────────────────── */

export async function fetchImpactReport(): Promise<ImpactReportResponse> {
  const res = await fetch(`${REQUOTE_URL}/impact`, {
    method: "GET",
    headers: await authHeadersJson(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load impact report" }));
    throw new Error((err as { error?: string }).error ?? `Failed to load (${res.status})`);
  }
  return res.json();
}

export async function uploadPriceFile(file: File): Promise<PriceFileImportResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(PRICE_IMPORT_URL, {
    method: "POST",
    headers: await authHeadersFormData(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Price file import failed" }));
    throw new Error((err as { error?: string }).error ?? `Import failed (${res.status})`);
  }
  return res.json();
}

export async function draftRequote(quotePackageId: string): Promise<RequoteDraftResult> {
  const res = await fetch(`${REQUOTE_URL}/draft`, {
    method: "POST",
    headers: await authHeadersJson(),
    body: JSON.stringify({ quote_package_id: quotePackageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Requote draft failed" }));
    throw new Error((err as { error?: string }).error ?? `Requote failed (${res.status})`);
  }
  return res.json();
}

export interface BatchRequoteResult {
  ok: boolean;
  generated: number;
  failed: number;
  results: Array<{ quote_package_id: string; draft_id: string | null; error?: string }>;
}

export async function batchRequote(quotePackageIds: string[]): Promise<BatchRequoteResult> {
  const res = await fetch(`${REQUOTE_URL}/batch`, {
    method: "POST",
    headers: await authHeadersJson(),
    body: JSON.stringify({ quote_package_ids: quotePackageIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Batch requote failed" }));
    throw new Error((err as { error?: string }).error ?? `Batch failed (${res.status})`);
  }
  return res.json();
}
