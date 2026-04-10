import { supabase } from "@/lib/supabase";
import { normalizeTradePhotos, type TradeWalkaroundPhoto } from "./trade-walkaround";

const TRADE_VALUATION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trade-valuation`;
const PHOTO_BUCKET = "equipment-photos";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export interface TradeValuationRecord {
  id: string;
  deal_id: string | null;
  make: string;
  model: string;
  year: number | null;
  serial_number: string | null;
  hours: number | null;
  photos: TradeWalkaroundPhoto[];
  video_url: string | null;
  operational_status: string | null;
  last_full_service: string | null;
  needed_repairs: string | null;
  attachments_included: string[] | null;
  ai_condition_score: number | null;
  ai_condition_notes: string | null;
  ai_detected_damage: string[] | null;
  preliminary_value: number | null;
  final_value: number | null;
  conditional_language: string | null;
  created_at: string;
}

export interface TradeValuationResponse {
  valuation: TradeValuationRecord;
  ai_assessment: {
    score: number;
    notes: string;
    detected_damage: string[];
  };
  pipeline_duration_ms: number;
}

function mapTradeValuation(row: Record<string, unknown>): TradeValuationRecord {
  return {
    id: row.id as string,
    deal_id: (row.deal_id as string | null) ?? null,
    make: row.make as string,
    model: row.model as string,
    year: (row.year as number | null) ?? null,
    serial_number: (row.serial_number as string | null) ?? null,
    hours: (row.hours as number | null) ?? null,
    photos: normalizeTradePhotos(row.photos),
    video_url: (row.video_url as string | null) ?? null,
    operational_status: (row.operational_status as string | null) ?? null,
    last_full_service: (row.last_full_service as string | null) ?? null,
    needed_repairs: (row.needed_repairs as string | null) ?? null,
    attachments_included: Array.isArray(row.attachments_included)
      ? row.attachments_included.filter((value): value is string => typeof value === "string")
      : null,
    ai_condition_score: (row.ai_condition_score as number | null) ?? null,
    ai_condition_notes: (row.ai_condition_notes as string | null) ?? null,
    ai_detected_damage: Array.isArray(row.ai_detected_damage)
      ? row.ai_detected_damage.filter((value): value is string => typeof value === "string")
      : null,
    preliminary_value: (row.preliminary_value as number | null) ?? null,
    final_value: (row.final_value as number | null) ?? null,
    conditional_language: (row.conditional_language as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

export async function getTradeValuation(dealId: string): Promise<TradeValuationRecord | null> {
  const { data, error } = await supabase
    .from("trade_valuations")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapTradeValuation(data as Record<string, unknown>);
}

export async function uploadTradeWalkaroundPhoto(input: {
  dealId: string;
  type: string;
  file: File;
}): Promise<TradeWalkaroundPhoto> {
  const ext = input.file.name.split(".").pop() ?? "jpg";
  const path = `trade-walkaround/${input.dealId}/${input.type}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, input.file, {
    upsert: false,
    contentType: input.file.type || undefined,
  });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return { type: input.type, url: data.publicUrl };
}

export async function createTradeValuation(input: {
  deal_id: string;
  make: string;
  model: string;
  year?: number;
  serial_number?: string;
  hours?: number;
  photos: TradeWalkaroundPhoto[];
  operational_status?: string;
  last_full_service?: string;
  needed_repairs?: string;
  attachments_included?: string[];
}): Promise<TradeValuationResponse> {
  const response = await fetch(TRADE_VALUATION_URL, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Failed to create trade valuation.");
  }
  return {
    ...payload,
    valuation: mapTradeValuation((payload as { valuation: Record<string, unknown> }).valuation),
  } as TradeValuationResponse;
}
