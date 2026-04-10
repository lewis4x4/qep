import { supabase } from "@/lib/supabase";

const QUOTE_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-builder-v2`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function getQuoteForDeal(dealId: string) {
  const res = await fetch(`${QUOTE_API_URL}?deal_id=${dealId}`, {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load quote");
  return res.json();
}

export async function getAiEquipmentRecommendation(jobDescription: string) {
  const res = await fetch(`${QUOTE_API_URL}/recommend`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ job_description: jobDescription }),
  });
  if (!res.ok) throw new Error("AI recommendation failed");
  return res.json();
}

export async function calculateFinancing(totalAmount: number, marginPct?: number, manufacturer?: string) {
  const res = await fetch(`${QUOTE_API_URL}/calculate`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ total_amount: totalAmount, margin_pct: marginPct, manufacturer }),
  });
  if (!res.ok) throw new Error("Financing calculation failed");
  return res.json();
}

export async function saveQuotePackage(data: Record<string, unknown>) {
  const res = await fetch(`${QUOTE_API_URL}/save`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save quote");
  return res.json();
}

export async function sendQuotePackage(quotePackageId: string): Promise<{ sent: boolean; to_email: string }> {
  const res = await fetch(`${QUOTE_API_URL}/send-package`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ quote_package_id: quotePackageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to send quote" }));
    throw new Error((err as { error?: string }).error ?? "Failed to send quote");
  }
  return res.json() as Promise<{ sent: boolean; to_email: string }>;
}

export async function saveQuoteSignature(data: {
  quote_package_id: string;
  deal_id?: string;
  signer_name: string;
  signer_email?: string | null;
  signature_png_base64?: string | null;
}) {
  const res = await fetch(`${QUOTE_API_URL}/sign`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to save signature" }));
    throw new Error((err as { error?: string }).error ?? "Failed to save signature");
  }
  return res.json();
}

export async function searchCatalog(query: string) {
  // Sanitize query: strip PostgREST filter metacharacters to prevent injection
  const sanitized = query.replace(/[%,().!]/g, "").trim().substring(0, 100);
  if (!sanitized) return [];

  const { data, error } = await supabase
    .from("catalog_entries")
    .select("*")
    .eq("is_available", true)
    .or(`make.ilike.%${sanitized}%,model.ilike.%${sanitized}%,category.ilike.%${sanitized}%`)
    .order("make", { ascending: true })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function getTradeValuation(dealId: string) {
  const { data, error } = await supabase
    .from("trade_valuations")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
