import { supabase } from "@/lib/supabase";
import type {
  QrmActivityCreateInput,
  QrmActivityPatchInput,
  QrmActivityTaskPatchInput,
  QrmActivityItem,
  QrmCampaign,
  QrmCampaignInput,
  QrmCampaignRecipient,
  QrmCompanySummary,
  QrmCompanyShipToAddress,
  QrmCompanyShipToInput,
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

export interface EdgeErrorPayload {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRouterErrorPayload(payload: unknown): EdgeErrorPayload["error"] | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const error = payload.error;
  return {
    code: typeof error.code === "string" ? error.code : undefined,
    message: typeof error.message === "string" ? error.message : undefined,
    details: error.details,
  };
}

export async function readRouterJsonPayload(response: Response, path = "QRM router"): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned malformed JSON.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${path} returned an invalid JSON payload.`);
  }
  return parsed;
}

export function requireRouterArrayPayload<T>(payload: Record<string, unknown>, key: string): T[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    throw new Error(`QRM router response is missing a valid '${key}' array.`);
  }
  return value as T[];
}

export function requireRouterObjectPayload<T>(payload: Record<string, unknown>, key: string): T {
  const value = payload[key];
  if (!isRecord(value)) {
    throw new Error(`QRM router response is missing a valid '${key}' object.`);
  }
  return value as T;
}

export function requireRouterRecordPayload<T>(payload: Record<string, unknown>, label = "QRM router response"): T {
  if (!isRecord(payload)) {
    throw new Error(`${label} is not a valid object.`);
  }
  return payload as T;
}

async function requestRouter(
  path: string,
  options: RouterRequestOptions = {},
): Promise<Record<string, unknown>> {
  const method = options.method ?? "GET";
  const response = await fetch(`${SUPABASE_URL}/functions/v1/qrm-router${path}`, {
    method,
    headers: await getAuthHeaders(options.idempotencyKey),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = await readRouterJsonPayload(response, `QRM router ${method} ${path}`);
  const edgeError = normalizeRouterErrorPayload(payload);
  if (!response.ok || edgeError) {
    const message = edgeError?.message || `QRM request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

export async function searchCrm(query: string): Promise<QrmSearchItem[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({ q: query.trim(), types: "contact,company" });
  const payload = await requestRouter(`/qrm/search?${params.toString()}`);
  return requireRouterArrayPayload<QrmSearchItem>(payload, "results");
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
  const payload = await requestRouter(
    `/qrm/search?${params.toString()}`,
  );
  return requireRouterArrayPayload<QrmSearchItem>(payload, "results");
}

export async function createCrmActivityViaRouter(
  input: QrmActivityCreateInput,
): Promise<QrmActivityItem> {
  const payload = await requestRouter("/qrm/activities", {
    method: "POST",
    body: input,
  });
  return requireRouterObjectPayload<QrmActivityItem>(payload, "activity");
}

export async function patchCrmActivityTaskViaRouter(
  activityId: string,
  input: QrmActivityTaskPatchInput,
): Promise<QrmActivityItem> {
  const payload = await requestRouter(`/qrm/activities/${activityId}`, {
    method: "PATCH",
    body: input,
  });
  return requireRouterObjectPayload<QrmActivityItem>(payload, "activity");
}

export async function patchCrmActivityViaRouter(
  activityId: string,
  input: QrmActivityPatchInput,
): Promise<QrmActivityItem> {
  const payload = await requestRouter(`/qrm/activities/${activityId}`, {
    method: "PATCH",
    body: input,
  });
  return requireRouterObjectPayload<QrmActivityItem>(payload, "activity");
}

export async function deliverCrmActivityViaRouter(
  activityId: string,
  updatedAt?: string,
): Promise<QrmActivityItem> {
  const payload = await requestRouter(`/qrm/activities/${activityId}/deliver`, {
    method: "POST",
    body: { sendNow: true, updatedAt },
  });
  return requireRouterObjectPayload<QrmActivityItem>(payload, "activity");
}

export async function patchCrmDealViaRouter(
  dealId: string,
  input: QrmDealPatchInput,
): Promise<QrmRepSafeDeal> {
  const payload = await requestRouter(`/qrm/deals/${dealId}`, {
    method: "PATCH",
    body: input,
  });
  return requireRouterObjectPayload<QrmRepSafeDeal>(payload, "deal");
}

export async function createCrmContactViaRouter(
  input: QrmContactUpsertInput,
): Promise<QrmContactSummary> {
  const payload = await requestRouter("/qrm/contacts", {
    method: "POST",
    body: input,
  });
  return requireRouterObjectPayload<QrmContactSummary>(payload, "contact");
}

export async function patchCrmContactViaRouter(
  contactId: string,
  input: Partial<QrmContactUpsertInput>,
): Promise<QrmContactSummary> {
  const payload = await requestRouter(`/qrm/contacts/${contactId}`, {
    method: "PATCH",
    body: input,
  });
  return requireRouterObjectPayload<QrmContactSummary>(payload, "contact");
}

export async function createCrmCompanyViaRouter(
  input: QrmCompanyUpsertInput,
): Promise<QrmCompanySummary> {
  const payload = await requestRouter("/qrm/companies", {
    method: "POST",
    body: input,
  });
  return requireRouterObjectPayload<QrmCompanySummary>(payload, "company");
}

export async function patchCrmCompanyViaRouter(
  companyId: string,
  input: Partial<QrmCompanyUpsertInput>,
): Promise<QrmCompanySummary> {
  const payload = await requestRouter(`/qrm/companies/${companyId}`, {
    method: "PATCH",
    body: input,
  });
  return requireRouterObjectPayload<QrmCompanySummary>(payload, "company");
}

export async function listCrmCampaignsViaRouter(): Promise<QrmCampaign[]> {
  const payload = await requestRouter("/qrm/campaigns");
  return requireRouterArrayPayload<QrmCampaign>(payload, "campaigns");
}

export async function createCrmCampaignViaRouter(
  input: QrmCampaignInput,
): Promise<QrmCampaign> {
  const payload = await requestRouter("/qrm/campaigns", {
    method: "POST",
    body: input,
  });
  return requireRouterObjectPayload<QrmCampaign>(payload, "campaign");
}

export async function patchCrmCampaignViaRouter(
  campaignId: string,
  input: QrmCampaignInput,
): Promise<QrmCampaign> {
  const payload = await requestRouter(`/qrm/campaigns/${campaignId}`, {
    method: "PATCH",
    body: input,
  });
  return requireRouterObjectPayload<QrmCampaign>(payload, "campaign");
}

export async function executeCrmCampaignViaRouter(
  campaignId: string,
): Promise<{ campaignId: string; state: string; executionSummary: Record<string, unknown> }> {
  const payload = await requestRouter(
    `/qrm/campaigns/${campaignId}/execute`,
    {
      method: "POST",
    },
  );
  return requireRouterObjectPayload<{ campaignId: string; state: string; executionSummary: Record<string, unknown> }>(payload, "result");
}

export async function listCrmCampaignRecipientsViaRouter(
  campaignId: string,
): Promise<QrmCampaignRecipient[]> {
  const payload = await requestRouter(
    `/qrm/campaigns/${campaignId}/recipients`,
  );
  return requireRouterArrayPayload<QrmCampaignRecipient>(payload, "recipients");
}

export async function createCrmDealViaRouter(
  input: QrmDealCreateInput,
): Promise<QrmRepSafeDeal> {
  const payload = await requestRouter("/qrm/deals", {
    method: "POST",
    body: input,
  });
  return requireRouterObjectPayload<QrmRepSafeDeal>(payload, "deal");
}

export async function fetchCompanyHierarchy(companyId: string): Promise<QrmCompanyHierarchy | null> {
  try {
    const payload = await requestRouter(`/qrm/companies/${companyId}/hierarchy`);
    return requireRouterRecordPayload<QrmCompanyHierarchy>(payload, "Company hierarchy response");
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
  const payload = await requestRouter(`/qrm/companies/${companyId}/parent`, {
    method: "PATCH",
    body: { parentCompanyId },
  });
  return requireRouterObjectPayload<{ id: string; parentCompanyId: string | null; updatedAt: string }>(payload, "company");
}

export async function fetchCompanyShipTos(
  companyId: string,
): Promise<QrmCompanyShipToAddress[]> {
  const payload = await requestRouter(
    `/qrm/companies/${companyId}/ship-tos`,
  );
  return requireRouterArrayPayload<QrmCompanyShipToAddress>(payload, "shipTos");
}

export async function createCompanyShipTo(
  companyId: string,
  input: QrmCompanyShipToInput,
): Promise<QrmCompanyShipToAddress> {
  const payload = await requestRouter(
    `/qrm/companies/${companyId}/ship-tos`,
    {
      method: "POST",
      body: input,
    },
  );
  return requireRouterObjectPayload<QrmCompanyShipToAddress>(payload, "shipTo");
}

export async function patchCompanyShipTo(
  companyId: string,
  shipToId: string,
  input: QrmCompanyShipToInput,
): Promise<QrmCompanyShipToAddress | { id: string; archived: true }> {
  const payload = await requestRouter(
    `/qrm/companies/${companyId}/ship-tos/${shipToId}`,
    {
      method: "PATCH",
      body: input,
    },
  );
  return requireRouterObjectPayload<QrmCompanyShipToAddress | { id: string; archived: true }>(payload, "shipTo");
}

export async function fetchCompanyEquipment(companyId: string): Promise<QrmEquipment[]> {
  const params = new URLSearchParams({ company_id: companyId });
  const payload = await requestRouter(`/qrm/equipment?${params.toString()}`);
  return requireRouterArrayPayload<QrmEquipment>(payload, "items");
}

/** Equipment on this company and all descendant companies (matches hierarchy roll-up). */
export async function fetchCompanySubtreeEquipment(companyId: string): Promise<QrmEquipment[]> {
  const params = new URLSearchParams({ subtree_root: companyId });
  const payload = await requestRouter(`/qrm/equipment?${params.toString()}`);
  return requireRouterArrayPayload<QrmEquipment>(payload, "items");
}

type EquipmentCreateInput = Omit<Partial<QrmEquipment>, "id" | "createdAt" | "updatedAt" | "companyName"> & { name: string };

export async function createCompanyEquipment(input: EquipmentCreateInput & { companyId: string }): Promise<QrmEquipment> {
  const payload = await requestRouter("/qrm/equipment", {
    method: "POST",
    body: input,
  });
  return requireRouterObjectPayload<QrmEquipment>(payload, "equipment");
}

export async function quickAddOnOrderEquipment(input: EquipmentCreateInput & { stockNumber: string }): Promise<QrmEquipment> {
  const payload = await requestRouter("/qrm/equipment/quick-add-on-order", {
    method: "POST",
    body: input,
  });
  return requireRouterObjectPayload<QrmEquipment>(payload, "equipment");
}

export async function getEquipmentById(equipmentId: string): Promise<QrmEquipment> {
  const payload = await requestRouter(`/qrm/equipment/${equipmentId}`);
  return requireRouterObjectPayload<QrmEquipment>(payload, "equipment");
}

export async function patchEquipment(
  equipmentId: string,
  input: Partial<QrmEquipment>,
): Promise<QrmEquipment> {
  const payload = await requestRouter(`/qrm/equipment/${equipmentId}`, {
    method: "PATCH",
    body: input,
  });
  return requireRouterObjectPayload<QrmEquipment>(payload, "equipment");
}

export async function archiveOnOrderEquipment(equipmentId: string): Promise<void> {
  await requestRouter(`/qrm/equipment/${equipmentId}`, {
    method: "DELETE",
  });
}

export async function fetchDealEquipment(dealId: string): Promise<QrmDealEquipmentLink[]> {
  const params = new URLSearchParams({ deal_id: dealId });
  const payload = await requestRouter(`/qrm/deal-equipment?${params.toString()}`);
  return requireRouterArrayPayload<QrmDealEquipmentLink>(payload, "items");
}

export async function linkEquipmentToDeal(input: {
  dealId: string;
  equipmentId: string;
  role?: QrmDealEquipmentRole;
  notes?: string | null;
}): Promise<QrmDealEquipmentLink> {
  const payload = await requestRouter("/qrm/deal-equipment", {
    method: "POST",
    body: input,
  });
  return requireRouterObjectPayload<QrmDealEquipmentLink>(payload, "link");
}

export async function unlinkEquipmentFromDeal(linkId: string): Promise<void> {
  await requestRouter(`/qrm/deal-equipment/${linkId}`, {
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
  const payload = await requestRouter(`/qrm/custom-field-definitions?${params.toString()}`);
  return requireRouterArrayPayload<{
    id: string;
    objectType: QrmRecordType;
    key: string;
    label: string;
    dataType: string;
    required: boolean;
    visibilityRoles: string[];
    sortOrder: number;
    constraints: Record<string, unknown>;
  }>(payload, "items");
}

export async function createCustomFieldDefinition(input: {
  objectType: QrmRecordType;
  key: string;
  label: string;
  dataType: string;
  required: boolean;
  visibilityRoles: string[];
}): Promise<void> {
  await requestRouter("/qrm/custom-field-definitions", {
    method: "POST",
    body: input,
  });
}

export async function fetchRecordCustomFields(
  recordType: QrmRecordType,
  recordId: string,
): Promise<QrmCustomField[]> {
  const params = new URLSearchParams({ record_type: recordType, record_id: recordId });
  const payload = await requestRouter(`/qrm/custom-fields?${params.toString()}`);
  return requireRouterArrayPayload<QrmCustomField>(payload, "fields");
}

export async function saveRecordCustomFields(
  recordType: QrmRecordType,
  recordId: string,
  values: Record<string, unknown>,
): Promise<QrmCustomField[]> {
  const payload = await requestRouter("/qrm/custom-fields", {
    method: "PATCH",
    body: {
      recordType,
      recordId,
      values,
    },
  });
  return requireRouterArrayPayload<QrmCustomField>(payload, "fields");
}

export async function listDuplicateCandidates(): Promise<QrmDuplicateCandidate[]> {
  const payload = await requestRouter("/qrm/duplicates");
  return requireRouterArrayPayload<QrmDuplicateCandidate>(payload, "candidates");
}

export async function dismissDuplicateCandidate(candidateId: string): Promise<void> {
  await requestRouter(`/qrm/duplicates/${candidateId}/dismiss`, {
    method: "POST",
  });
}

export async function mergeDuplicateContacts(input: {
  survivorId: string;
  loserId: string;
}): Promise<void> {
  await requestRouter("/qrm/merges", {
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
  const payload = await requestRouter(
    `/qrm/moves${qs ? `?${qs}` : ""}`,
  );
  return requireRouterArrayPayload<QrmMove>(payload, "moves");
}

/**
 * Touch channel enum for the move-complete touch composer (Slice 5).
 * Mirrors the server's `operator_touch_channel` DB enum exactly — keep
 * these aligned, or the backend will reject "unknown channel".
 */
export type QrmTouchChannel =
  | "call"
  | "email"
  | "meeting"
  | "sms"
  | "field_visit"
  | "voice_note"
  | "chat"
  | "other";

export interface PatchMoveTouchInput {
  channel: QrmTouchChannel;
  summary?: string;
  body?: string;
  durationSeconds?: number;
}

export interface PatchMoveInput {
  action: import("./moves-types").QrmMoveAction;
  snoozedUntil?: string;
  reason?: string;
  /**
   * Optional touch payload. Only relevant for action === "complete". The
   * server also creates a minimal auto-touch when this is omitted, so it's
   * safe to leave out when the rep just taps Done without filling the
   * composer.
   */
  touch?: PatchMoveTouchInput;
}

/**
 * PATCH response shape. `touch_id` is non-null when the server logged a
 * touch as part of a complete action; `signals_suppressed` is the number
 * of signals cooled off (usually equal to move.signal_ids.length, unless
 * some were already suppressed).
 */
export interface QrmMovePatchResult {
  move: QrmMove;
  touchId: string | null;
  signalsSuppressed: number;
}

export async function patchQrmMove(
  moveId: string,
  input: PatchMoveInput,
): Promise<QrmMovePatchResult> {
  const payload = await requestRouter(`/qrm/moves/${moveId}`, {
    method: "PATCH",
    body: input,
  });
  const move = requireRouterObjectPayload<QrmMove>(payload, "move");
  const touchId = typeof payload.touch_id === "string" ? payload.touch_id : null;
  const signalsSuppressed = typeof payload.signals_suppressed === "number" && Number.isFinite(payload.signals_suppressed)
    ? payload.signals_suppressed
    : 0;
  return {
    move,
    touchId,
    signalsSuppressed,
  };
}

// ---------------------------------------------------------------------------
// Signals (Slice 3) — the raw event stream backing the Pulse surface. Reads
// are RLS-scoped by workspace + rep visibility; writes go through dedicated
// ingest adapters, not this client.
// ---------------------------------------------------------------------------

export type {
  QrmSignal,
  QrmSignalEntityType,
  QrmSignalKind,
  QrmSignalSeverity,
} from "./signals-types";
import type {
  QrmSignal,
  QrmSignalEntityType,
  QrmSignalKind,
  QrmSignalSeverity,
} from "./signals-types";

export interface ListSignalsParams {
  kinds?: QrmSignalKind[];
  severityAtLeast?: QrmSignalSeverity | null;
  entityType?: QrmSignalEntityType | null;
  entityId?: string | null;
  assignedRepId?: string | null;
  /** ISO timestamp. Server floors signals to occurred_at >= since. */
  since?: string | null;
  limit?: number;
}

export async function listQrmSignals(
  params: ListSignalsParams = {},
): Promise<QrmSignal[]> {
  const q = new URLSearchParams();
  if (params.kinds && params.kinds.length > 0) {
    q.set("kind", params.kinds.join(","));
  }
  if (params.severityAtLeast) q.set("severity_at_least", params.severityAtLeast);
  if (params.entityType) q.set("entity_type", params.entityType);
  if (params.entityId) q.set("entity_id", params.entityId);
  if (params.assignedRepId) q.set("assigned_rep_id", params.assignedRepId);
  if (params.since) q.set("since", params.since);
  if (params.limit != null) q.set("limit", String(params.limit));

  const qs = q.toString();
  const payload = await requestRouter(
    `/qrm/signals${qs ? `?${qs}` : ""}`,
  );
  return requireRouterArrayPayload<QrmSignal>(payload, "signals");
}

/**
 * Fetch a fixed set of signals by id — backs the "Triggered by" panel on
 * a MoveCard. Returns in the same order as the server (occurred_at desc).
 * Capped to 20 ids server-side; extras are silently dropped.
 */
export async function listQrmSignalsByIds(ids: readonly string[]): Promise<QrmSignal[]> {
  const filtered = ids.filter((id) => typeof id === "string" && id.length > 0);
  if (filtered.length === 0) return [];
  const q = new URLSearchParams({ ids: filtered.join(",") });
  const payload = await requestRouter(
    `/qrm/signals?${q.toString()}`,
  );
  return requireRouterArrayPayload<QrmSignal>(payload, "signals");
}
