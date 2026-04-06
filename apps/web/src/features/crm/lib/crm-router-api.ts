import { supabase } from "@/lib/supabase";
import type {
  CrmActivityCreateInput,
  CrmActivityPatchInput,
  CrmActivityTaskPatchInput,
  CrmActivityItem,
  CrmCompanySummary,
  CrmCompanyHierarchy,
  CrmCompanyUpsertInput,
  CrmContactSummary,
  CrmContactUpsertInput,
  CrmCustomField,
  CrmDealCreateInput,
  CrmDealPatchInput,
  CrmRepSafeDeal,
  CrmDealEquipmentLink,
  CrmDealEquipmentRole,
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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
}

async function getAuthHeaders(idempotencyKey?: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in is required to access QRM.");
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
    const message = payload.error?.message || "QRM request failed.";
    throw new Error(message);
  }

  return payload;
}

export async function searchCrm(query: string): Promise<CrmSearchItem[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({ q: query.trim(), types: "contact,company" });
  const payload = await requestRouter<{ results: CrmSearchItem[] }>(`/qrm/search?${params.toString()}`);
  return payload.results;
}

export async function createCrmActivityViaRouter(
  input: CrmActivityCreateInput,
): Promise<CrmActivityItem> {
  const payload = await requestRouter<{ activity: CrmActivityItem }>("/qrm/activities", {
    method: "POST",
    body: input,
  });
  return payload.activity;
}

export async function patchCrmActivityTaskViaRouter(
  activityId: string,
  input: CrmActivityTaskPatchInput,
): Promise<CrmActivityItem> {
  const payload = await requestRouter<{ activity: CrmActivityItem }>(`/qrm/activities/${activityId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.activity;
}

export async function patchCrmActivityViaRouter(
  activityId: string,
  input: CrmActivityPatchInput,
): Promise<CrmActivityItem> {
  const payload = await requestRouter<{ activity: CrmActivityItem }>(`/qrm/activities/${activityId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.activity;
}

export async function deliverCrmActivityViaRouter(
  activityId: string,
  updatedAt?: string,
): Promise<CrmActivityItem> {
  const payload = await requestRouter<{ activity: CrmActivityItem }>(`/qrm/activities/${activityId}/deliver`, {
    method: "POST",
    body: { sendNow: true, updatedAt },
  });
  return payload.activity;
}

export async function patchCrmDealViaRouter(
  dealId: string,
  input: CrmDealPatchInput,
): Promise<CrmRepSafeDeal> {
  const payload = await requestRouter<{ deal: CrmRepSafeDeal }>(`/qrm/deals/${dealId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.deal;
}

export async function createCrmContactViaRouter(
  input: CrmContactUpsertInput,
): Promise<CrmContactSummary> {
  const payload = await requestRouter<{ contact: CrmContactSummary }>("/qrm/contacts", {
    method: "POST",
    body: input,
  });
  return payload.contact;
}

export async function patchCrmContactViaRouter(
  contactId: string,
  input: Partial<CrmContactUpsertInput>,
): Promise<CrmContactSummary> {
  const payload = await requestRouter<{ contact: CrmContactSummary }>(`/qrm/contacts/${contactId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.contact;
}

export async function createCrmCompanyViaRouter(
  input: CrmCompanyUpsertInput,
): Promise<CrmCompanySummary> {
  const payload = await requestRouter<{ company: CrmCompanySummary }>("/qrm/companies", {
    method: "POST",
    body: input,
  });
  return payload.company;
}

export async function patchCrmCompanyViaRouter(
  companyId: string,
  input: Partial<CrmCompanyUpsertInput>,
): Promise<CrmCompanySummary> {
  const payload = await requestRouter<{ company: CrmCompanySummary }>(`/qrm/companies/${companyId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.company;
}

export async function createCrmDealViaRouter(
  input: CrmDealCreateInput,
): Promise<CrmRepSafeDeal> {
  const payload = await requestRouter<{ deal: CrmRepSafeDeal }>("/qrm/deals", {
    method: "POST",
    body: input,
  });
  return payload.deal;
}

export async function fetchCompanyHierarchy(companyId: string): Promise<CrmCompanyHierarchy | null> {
  try {
    return await requestRouter<CrmCompanyHierarchy>(`/qrm/companies/${companyId}/hierarchy`);
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
  }>(`/qrm/companies/${companyId}/parent`, {
    method: "PATCH",
    body: { parentCompanyId },
  });
  return payload.company;
}

export async function fetchCompanyEquipment(companyId: string): Promise<CrmEquipment[]> {
  const params = new URLSearchParams({ company_id: companyId });
  const payload = await requestRouter<{ items: CrmEquipment[] }>(`/qrm/equipment?${params.toString()}`);
  return payload.items;
}

/** Equipment on this company and all descendant companies (matches hierarchy roll-up). */
export async function fetchCompanySubtreeEquipment(companyId: string): Promise<CrmEquipment[]> {
  const params = new URLSearchParams({ subtree_root: companyId });
  const payload = await requestRouter<{ items: CrmEquipment[] }>(`/qrm/equipment?${params.toString()}`);
  return payload.items;
}

export async function createCompanyEquipment(input: Omit<Partial<CrmEquipment>, "id" | "createdAt" | "updatedAt" | "companyName"> & { companyId: string; name: string }): Promise<CrmEquipment> {
  const payload = await requestRouter<{ equipment: CrmEquipment }>("/qrm/equipment", {
    method: "POST",
    body: input,
  });
  return payload.equipment;
}

export async function getEquipmentById(equipmentId: string): Promise<CrmEquipment> {
  const payload = await requestRouter<{ equipment: CrmEquipment }>(`/qrm/equipment/${equipmentId}`);
  return payload.equipment;
}

export async function patchEquipment(
  equipmentId: string,
  input: Partial<CrmEquipment>,
): Promise<CrmEquipment> {
  const payload = await requestRouter<{ equipment: CrmEquipment }>(`/qrm/equipment/${equipmentId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.equipment;
}

export async function fetchDealEquipment(dealId: string): Promise<CrmDealEquipmentLink[]> {
  const params = new URLSearchParams({ deal_id: dealId });
  const payload = await requestRouter<{ items: CrmDealEquipmentLink[] }>(`/qrm/deal-equipment?${params.toString()}`);
  return payload.items;
}

export async function linkEquipmentToDeal(input: {
  dealId: string;
  equipmentId: string;
  role?: CrmDealEquipmentRole;
  notes?: string | null;
}): Promise<CrmDealEquipmentLink> {
  const payload = await requestRouter<{ link: CrmDealEquipmentLink }>("/qrm/deal-equipment", {
    method: "POST",
    body: input,
  });
  return payload.link;
}

export async function unlinkEquipmentFromDeal(linkId: string): Promise<void> {
  await requestRouter<{ deleted: boolean }>(`/qrm/deal-equipment/${linkId}`, {
    method: "DELETE",
  });
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
  }> }>(`/qrm/custom-field-definitions?${params.toString()}`);
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
  await requestRouter<{ definition: unknown }>("/qrm/custom-field-definitions", {
    method: "POST",
    body: input,
  });
}

export async function fetchRecordCustomFields(
  recordType: CrmRecordType,
  recordId: string,
): Promise<CrmCustomField[]> {
  const params = new URLSearchParams({ record_type: recordType, record_id: recordId });
  const payload = await requestRouter<{ fields: CrmCustomField[] }>(`/qrm/custom-fields?${params.toString()}`);
  return payload.fields;
}

export async function saveRecordCustomFields(
  recordType: CrmRecordType,
  recordId: string,
  values: Record<string, unknown>,
): Promise<CrmCustomField[]> {
  const payload = await requestRouter<{ fields: CrmCustomField[] }>("/qrm/custom-fields", {
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
  const payload = await requestRouter<{ candidates: CrmDuplicateCandidate[] }>("/qrm/duplicates");
  return payload.candidates;
}

export async function dismissDuplicateCandidate(candidateId: string): Promise<void> {
  await requestRouter<{ ok: boolean }>(`/qrm/duplicates/${candidateId}/dismiss`, {
    method: "POST",
  });
}

export async function mergeDuplicateContacts(input: {
  survivorId: string;
  loserId: string;
}): Promise<void> {
  await requestRouter<{ merge: unknown }>("/qrm/merges", {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: input,
  });
}
