import { supabase } from "@/lib/supabase";
import type {
  QrmActivityCreateInput,
  QrmActivityPatchInput,
  QrmActivityTaskPatchInput,
  QrmActivityItem,
  QrmCompanySummary,
  QrmCompanyHierarchy,
  QrmCompanyUpsertInput,
  QrmContactSummary,
  QrmContactUpsertInput,
  QrmCustomField,
  QrmDealCreateInput,
  QrmDealPatchInput,
  QrmRepSafeDeal,
  QrmDealEquipmentLink,
  QrmDealEquipmentRole,
  QrmDuplicateCandidate,
  QrmEquipment,
  QrmRecordType,
  QrmSearchEntityType,
  QrmSearchItem,
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
  const response = await fetch(`${SUPABASE_URL}/functions/v1/qrm-router${path}`, {
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

export async function searchCrm(query: string): Promise<QrmSearchItem[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({ q: query.trim(), types: "contact,company" });
  const payload = await requestRouter<{ results: QrmSearchItem[] }>(`/qrm/search?${params.toString()}`);
  return payload.results;
}

/**
 * Universal search across the operator graph. Pass `types` to narrow the
 * lookup, or omit to search every known entity type. Used by the GraphExplorer
 * surface and the global command-k bar.
 */
export async function searchQrmGraph(
  query: string,
  types?: QrmSearchEntityType[],
): Promise<QrmSearchItem[]> {
  if (!query.trim()) return [];
  const allTypes: QrmSearchEntityType[] =
    types && types.length > 0 ? types : ["contact", "company", "deal", "equipment", "rental"];
  const params = new URLSearchParams({ q: query.trim(), types: allTypes.join(",") });
  const payload = await requestRouter<{ results: QrmSearchItem[] }>(
    `/qrm/search?${params.toString()}`,
  );
  return payload.results;
}

export async function createCrmActivityViaRouter(
  input: QrmActivityCreateInput,
): Promise<QrmActivityItem> {
  const payload = await requestRouter<{ activity: QrmActivityItem }>("/qrm/activities", {
    method: "POST",
    body: input,
  });
  return payload.activity;
}

export async function patchCrmActivityTaskViaRouter(
  activityId: string,
  input: QrmActivityTaskPatchInput,
): Promise<QrmActivityItem> {
  const payload = await requestRouter<{ activity: QrmActivityItem }>(`/qrm/activities/${activityId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.activity;
}

export async function patchCrmActivityViaRouter(
  activityId: string,
  input: QrmActivityPatchInput,
): Promise<QrmActivityItem> {
  const payload = await requestRouter<{ activity: QrmActivityItem }>(`/qrm/activities/${activityId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.activity;
}

export async function deliverCrmActivityViaRouter(
  activityId: string,
  updatedAt?: string,
): Promise<QrmActivityItem> {
  const payload = await requestRouter<{ activity: QrmActivityItem }>(`/qrm/activities/${activityId}/deliver`, {
    method: "POST",
    body: { sendNow: true, updatedAt },
  });
  return payload.activity;
}

export async function patchCrmDealViaRouter(
  dealId: string,
  input: QrmDealPatchInput,
): Promise<QrmRepSafeDeal> {
  const payload = await requestRouter<{ deal: QrmRepSafeDeal }>(`/qrm/deals/${dealId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.deal;
}

export async function createCrmContactViaRouter(
  input: QrmContactUpsertInput,
): Promise<QrmContactSummary> {
  const payload = await requestRouter<{ contact: QrmContactSummary }>("/qrm/contacts", {
    method: "POST",
    body: input,
  });
  return payload.contact;
}

export async function patchCrmContactViaRouter(
  contactId: string,
  input: Partial<QrmContactUpsertInput>,
): Promise<QrmContactSummary> {
  const payload = await requestRouter<{ contact: QrmContactSummary }>(`/qrm/contacts/${contactId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.contact;
}

export async function createCrmCompanyViaRouter(
  input: QrmCompanyUpsertInput,
): Promise<QrmCompanySummary> {
  const payload = await requestRouter<{ company: QrmCompanySummary }>("/qrm/companies", {
    method: "POST",
    body: input,
  });
  return payload.company;
}

export async function patchCrmCompanyViaRouter(
  companyId: string,
  input: Partial<QrmCompanyUpsertInput>,
): Promise<QrmCompanySummary> {
  const payload = await requestRouter<{ company: QrmCompanySummary }>(`/qrm/companies/${companyId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.company;
}

export async function createCrmDealViaRouter(
  input: QrmDealCreateInput,
): Promise<QrmRepSafeDeal> {
  const payload = await requestRouter<{ deal: QrmRepSafeDeal }>("/qrm/deals", {
    method: "POST",
    body: input,
  });
  return payload.deal;
}

export async function fetchCompanyHierarchy(companyId: string): Promise<QrmCompanyHierarchy | null> {
  try {
    return await requestRouter<QrmCompanyHierarchy>(`/qrm/companies/${companyId}/hierarchy`);
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

export async function fetchCompanyEquipment(companyId: string): Promise<QrmEquipment[]> {
  const params = new URLSearchParams({ company_id: companyId });
  const payload = await requestRouter<{ items: QrmEquipment[] }>(`/qrm/equipment?${params.toString()}`);
  return payload.items;
}

/** Equipment on this company and all descendant companies (matches hierarchy roll-up). */
export async function fetchCompanySubtreeEquipment(companyId: string): Promise<QrmEquipment[]> {
  const params = new URLSearchParams({ subtree_root: companyId });
  const payload = await requestRouter<{ items: QrmEquipment[] }>(`/qrm/equipment?${params.toString()}`);
  return payload.items;
}

export async function createCompanyEquipment(input: Omit<Partial<QrmEquipment>, "id" | "createdAt" | "updatedAt" | "companyName"> & { companyId: string; name: string }): Promise<QrmEquipment> {
  const payload = await requestRouter<{ equipment: QrmEquipment }>("/qrm/equipment", {
    method: "POST",
    body: input,
  });
  return payload.equipment;
}

export async function getEquipmentById(equipmentId: string): Promise<QrmEquipment> {
  const payload = await requestRouter<{ equipment: QrmEquipment }>(`/qrm/equipment/${equipmentId}`);
  return payload.equipment;
}

export async function patchEquipment(
  equipmentId: string,
  input: Partial<QrmEquipment>,
): Promise<QrmEquipment> {
  const payload = await requestRouter<{ equipment: QrmEquipment }>(`/qrm/equipment/${equipmentId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.equipment;
}

export async function fetchDealEquipment(dealId: string): Promise<QrmDealEquipmentLink[]> {
  const params = new URLSearchParams({ deal_id: dealId });
  const payload = await requestRouter<{ items: QrmDealEquipmentLink[] }>(`/qrm/deal-equipment?${params.toString()}`);
  return payload.items;
}

export async function linkEquipmentToDeal(input: {
  dealId: string;
  equipmentId: string;
  role?: QrmDealEquipmentRole;
  notes?: string | null;
}): Promise<QrmDealEquipmentLink> {
  const payload = await requestRouter<{ link: QrmDealEquipmentLink }>("/qrm/deal-equipment", {
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
  objectType: QrmRecordType,
): Promise<Array<{
  id: string;
  objectType: QrmRecordType;
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
    objectType: QrmRecordType;
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
  objectType: QrmRecordType;
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
  recordType: QrmRecordType,
  recordId: string,
): Promise<QrmCustomField[]> {
  const params = new URLSearchParams({ record_type: recordType, record_id: recordId });
  const payload = await requestRouter<{ fields: QrmCustomField[] }>(`/qrm/custom-fields?${params.toString()}`);
  return payload.fields;
}

export async function saveRecordCustomFields(
  recordType: QrmRecordType,
  recordId: string,
  values: Record<string, unknown>,
): Promise<QrmCustomField[]> {
  const payload = await requestRouter<{ fields: QrmCustomField[] }>("/qrm/custom-fields", {
    method: "PATCH",
    body: {
      recordType,
      recordId,
      values,
    },
  });
  return payload.fields;
}

export async function listDuplicateCandidates(): Promise<QrmDuplicateCandidate[]> {
  const payload = await requestRouter<{ candidates: QrmDuplicateCandidate[] }>("/qrm/duplicates");
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

// ─── Moves (Slice 2 Today surface) ──────────────────────────────────────────
// A "move" is a recommended unit of work. The recommender writes them, the
// operator accepts/dismisses/snoozes them, and the card collapses back to
// quiet once the move is completed or dismissed.

export type {
  QrmMove,
  QrmMoveAction,
  QrmMoveEntityType,
  QrmMoveKind,
  QrmMoveStatus,
} from "./moves-types";
import type {
  QrmMove,
  QrmMoveEntityType,
  QrmMoveStatus,
} from "./moves-types";

export interface ListMovesParams {
  statuses?: QrmMoveStatus[];
  assignedRepId?: string | null;
  entityType?: QrmMoveEntityType | null;
  entityId?: string | null;
  limit?: number;
}

export async function listQrmMoves(params: ListMovesParams = {}): Promise<QrmMove[]> {
  const q = new URLSearchParams();
  if (params.statuses && params.statuses.length > 0) {
    q.set("status", params.statuses.join(","));
  }
  if (params.assignedRepId) q.set("assigned_rep_id", params.assignedRepId);
  if (params.entityType) q.set("entity_type", params.entityType);
  if (params.entityId) q.set("entity_id", params.entityId);
  if (params.limit != null) q.set("limit", String(params.limit));

  const qs = q.toString();
  const payload = await requestRouter<{ moves: QrmMove[] }>(
    `/qrm/moves${qs ? `?${qs}` : ""}`,
  );
  return payload.moves;
}

export interface PatchMoveInput {
  action: import("./moves-types").QrmMoveAction;
  snoozedUntil?: string;
  reason?: string;
}

export async function patchQrmMove(moveId: string, input: PatchMoveInput): Promise<QrmMove> {
  const payload = await requestRouter<{ move: QrmMove }>(`/qrm/moves/${moveId}`, {
    method: "PATCH",
    body: input,
  });
  return payload.move;
}
