import { supabase } from "@/lib/supabase";
import type {
  CrmActivityCreateInput,
  CrmActivityItem,
  CrmCompanyHierarchy,
  CrmCustomField,
  CrmDuplicateCandidate,
  CrmEquipment,
  CrmRecordType,
  CrmSearchItem,
} from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface EdgeErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

interface RouterRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  idempotencyKey?: string;
}

async function getAuthHeaders(idempotencyKey?: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in is required to access CRM.");
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function requestRouter<T>(
  path: string,
  options: RouterRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const response = await fetch(`${SUPABASE_URL}/functions/v1/crm-router${path}`, {
    method,
    headers: await getAuthHeaders(options.idempotencyKey),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = await response.json() as T & EdgeErrorPayload;
  if (!response.ok || payload.error) {
    const message = payload.error?.message || "CRM request failed.";
    throw new Error(message);
  }

  return payload;
}

export async function searchCrm(query: string): Promise<CrmSearchItem[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({ q: query.trim(), types: "contact,company" });
  const payload = await requestRouter<{ results: CrmSearchItem[] }>(`/crm/search?${params.toString()}`);
  return payload.results;
}

export async function createCrmActivityViaRouter(
  input: CrmActivityCreateInput,
): Promise<CrmActivityItem> {
  const payload = await requestRouter<{ activity: CrmActivityItem }>("/crm/activities", {
    method: "POST",
    body: input,
  });
  return payload.activity;
}

export async function fetchCompanyHierarchy(companyId: string): Promise<CrmCompanyHierarchy | null> {
  try {
    return await requestRouter<CrmCompanyHierarchy>(`/crm/companies/${companyId}/hierarchy`);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
      return null;
    }
    throw error;
  }
}

export async function updateCompanyParent(
  companyId: string,
  parentCompanyId: string | null,
): Promise<{ id: string; parentCompanyId: string | null; updatedAt: string }> {
  const payload = await requestRouter<{
    company: { id: string; parentCompanyId: string | null; updatedAt: string };
  }>(`/crm/companies/${companyId}/parent`, {
    method: "PATCH",
    body: { parentCompanyId },
  });
  return payload.company;
}

export async function fetchCompanyEquipment(companyId: string): Promise<CrmEquipment[]> {
  const params = new URLSearchParams({ company_id: companyId });
  const payload = await requestRouter<{ items: CrmEquipment[] }>(`/crm/equipment?${params.toString()}`);
  return payload.items;
}

export async function createCompanyEquipment(input: {
  companyId: string;
  name: string;
  assetTag?: string | null;
  serialNumber?: string | null;
  primaryContactId?: string | null;
}): Promise<CrmEquipment> {
  const payload = await requestRouter<{ equipment: CrmEquipment }>("/crm/equipment", {
    method: "POST",
    body: input,
  });
  return payload.equipment;
}

export async function listCustomFieldDefinitions(
  objectType: CrmRecordType,
): Promise<Array<{
  id: string;
  objectType: CrmRecordType;
  key: string;
  label: string;
  dataType: string;
  required: boolean;
  visibilityRoles: string[];
  sortOrder: number;
  constraints: Record<string, unknown>;
}>> {
  const params = new URLSearchParams({ object_type: objectType });
  const payload = await requestRouter<{ items: Array<{
    id: string;
    objectType: CrmRecordType;
    key: string;
    label: string;
    dataType: string;
    required: boolean;
    visibilityRoles: string[];
    sortOrder: number;
    constraints: Record<string, unknown>;
  }> }>(`/crm/custom-field-definitions?${params.toString()}`);
  return payload.items;
}

export async function createCustomFieldDefinition(input: {
  objectType: CrmRecordType;
  key: string;
  label: string;
  dataType: string;
  required: boolean;
  visibilityRoles: string[];
}): Promise<void> {
  await requestRouter<{ definition: unknown }>("/crm/custom-field-definitions", {
    method: "POST",
    body: input,
  });
}

export async function fetchRecordCustomFields(
  recordType: CrmRecordType,
  recordId: string,
): Promise<CrmCustomField[]> {
  const params = new URLSearchParams({ record_type: recordType, record_id: recordId });
  const payload = await requestRouter<{ fields: CrmCustomField[] }>(`/crm/custom-fields?${params.toString()}`);
  return payload.fields;
}

export async function saveRecordCustomFields(
  recordType: CrmRecordType,
  recordId: string,
  values: Record<string, unknown>,
): Promise<CrmCustomField[]> {
  const payload = await requestRouter<{ fields: CrmCustomField[] }>("/crm/custom-fields", {
    method: "PATCH",
    body: {
      recordType,
      recordId,
      values,
    },
  });
  return payload.fields;
}

export async function listDuplicateCandidates(): Promise<CrmDuplicateCandidate[]> {
  const payload = await requestRouter<{ candidates: CrmDuplicateCandidate[] }>("/crm/duplicates");
  return payload.candidates;
}

export async function dismissDuplicateCandidate(candidateId: string): Promise<void> {
  await requestRouter<{ ok: boolean }>(`/crm/duplicates/${candidateId}/dismiss`, {
    method: "POST",
  });
}

export async function mergeDuplicateContacts(input: {
  survivorId: string;
  loserId: string;
}): Promise<void> {
  await requestRouter<{ merge: unknown }>("/crm/merges", {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: input,
  });
}
