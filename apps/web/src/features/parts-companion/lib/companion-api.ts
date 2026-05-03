// ============================================================
// Parts Companion — Feature-local API adapter
// Pattern: matches features/sales/lib/sales-api.ts
// ============================================================

import { supabase } from "../../../lib/supabase";
import type {
  QueueItem,
  RequestActivity,
  MachineProfile,
  SearchResponse,
  CounterInquiry,
  PartsPreferences,
  RequestItem,
} from "./types";
import {
  normalizeCounterInquiries,
  normalizeMachineProfile,
  normalizeMachineProfiles,
  normalizePartsPreferences,
  normalizeQueueItem,
  normalizeQueueItems,
  normalizeRequestActivities,
} from "./companion-api-normalizers";

// ── Auth Helper ─────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken();
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    // Try to extract real error message
    const msg =
      error.context instanceof Response
        ? await error.context.text().catch(() => error.message)
        : error.message;
    throw new Error(msg || "Function invocation failed");
  }
  return data as T;
}

// ── Queue ───────────────────────────────────────────────────

export async function fetchPartsQueue(): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from("v_parts_queue")
    .select("*")
    .order("priority_sort", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return normalizeQueueItems(data);
}

export async function fetchRequestDetail(
  requestId: string,
): Promise<QueueItem | null> {
  const { data, error } = await supabase
    .from("v_parts_queue")
    .select("*")
    .eq("id", requestId)
    .single();

  if (error) return null;
  return normalizeQueueItem(data);
}

export async function fetchRequestActivity(
  requestId: string,
): Promise<RequestActivity[]> {
  const { data, error } = await supabase
    .from("parts_request_activity")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return normalizeRequestActivities(data);
}

// ── Request Actions (via Edge Function) ─────────────────────

export async function createPartsRequest(payload: {
  request_source: string;
  priority?: string;
  machine_profile_id?: string;
  machine_description?: string;
  customer_name?: string;
  bay_number?: string;
  work_order_number?: string;
  items?: Array<{
    part_number: string;
    description?: string;
    quantity: number;
    notes?: string;
  }>;
  notes?: string;
}) {
  return invokeFunction("process-parts-request", {
    action: "create",
    ...payload,
  });
}

export async function assignRequest(
  requestId: string,
  assignTo?: string,
) {
  return invokeFunction("process-parts-request", {
    action: "assign",
    request_id: requestId,
    assign_to: assignTo,
  });
}

export async function updateRequestStatus(
  requestId: string,
  newStatus: string,
  notes?: string,
) {
  return invokeFunction("process-parts-request", {
    action: "update_status",
    request_id: requestId,
    new_status: newStatus,
    notes,
  });
}

export async function addRequestNote(requestId: string, notes: string) {
  return invokeFunction("process-parts-request", {
    action: "add_note",
    request_id: requestId,
    notes,
  });
}

export async function addRequestItem(
  requestId: string,
  item: { part_number: string; description?: string; quantity: number; notes?: string },
) {
  return invokeFunction("process-parts-request", {
    action: "add_item",
    request_id: requestId,
    item,
  });
}

export async function completeRequest(requestId: string, notes?: string) {
  return invokeFunction("process-parts-request", {
    action: "complete",
    request_id: requestId,
    notes,
  });
}

export async function cancelRequest(requestId: string, notes?: string) {
  return invokeFunction("process-parts-request", {
    action: "cancel",
    request_id: requestId,
    notes,
  });
}

// ── Parts Lookup (via Edge Function) ────────────────────────

export async function searchParts(
  query: string,
  filters?: {
    manufacturer?: string;
    category?: string;
    machine_profile_id?: string;
  },
  limit?: number,
): Promise<SearchResponse> {
  return invokeFunction<SearchResponse>("ai-parts-lookup", {
    query,
    filters: filters || {},
    include_cross_references: true,
    limit: limit || 10,
  });
}

// ── Machine Profiles ────────────────────────────────────────

export async function fetchMachineProfiles(filters?: {
  manufacturer?: string;
  category?: string;
  search?: string;
}): Promise<MachineProfile[]> {
  let query = supabase
    .from("machine_profiles")
    .select("*")
    .is("deleted_at", null)
    .order("manufacturer", { ascending: true })
    .order("model", { ascending: true });

  if (filters?.manufacturer) {
    query = query.eq("manufacturer", filters.manufacturer);
  }
  if (filters?.category) {
    query = query.eq("category", filters.category);
  }

  const { data, error } = await query;
  if (error) throw error;

  let results = normalizeMachineProfiles(data);

  // Client-side text filter if search provided
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (m) =>
        m.manufacturer.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.model_family || "").toLowerCase().includes(q),
    );
  }

  return results;
}

export async function fetchMachineProfile(
  id: string,
): Promise<MachineProfile | null> {
  const { data, error } = await supabase
    .from("machine_profiles")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error) return null;
  return normalizeMachineProfile(data);
}

// ── Counter Inquiries ───────────────────────────────────────

export async function logCounterInquiry(inquiry: {
  inquiry_type: string;
  machine_profile_id?: string;
  machine_description?: string;
  query_text: string;
  result_parts?: string[];
  outcome: string;
  duration_seconds?: number;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("counter_inquiries").insert({
    user_id: user.id,
    ...inquiry,
  });

  if (error) throw error;
}

export async function fetchRecentInquiries(
  limit = 20,
): Promise<CounterInquiry[]> {
  const { data, error } = await supabase
    .from("counter_inquiries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return normalizeCounterInquiries(data);
}

// ── Preferences ─────────────────────────────────────────────

export async function fetchPreferences(): Promise<PartsPreferences | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("parts_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return normalizePartsPreferences(data);
}

export async function upsertPreferences(
  prefs: Partial<PartsPreferences>,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("parts_preferences")
    .upsert(
      { user_id: user.id, ...prefs },
      { onConflict: "user_id" },
    );

  if (error) throw error;
}
