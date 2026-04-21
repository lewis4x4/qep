import { supabase } from "@/lib/supabase";

export type DocumentCenterView =
  | "all"
  | "recent"
  | "pinned"
  | "unfiled"
  | "folder"
  | "pending_review"
  | "ingest_failed";

export interface DocumentCenterFolder {
  id: string;
  parentId: string | null;
  name: string;
  audience: string;
  isSmart: boolean;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
}

export interface DocumentCenterBreadcrumb {
  id: string;
  name: string;
  audience: string;
}

export interface DocumentCenterListItem {
  id: string;
  title: string;
  source: string;
  mimeType: string | null;
  summary: string | null;
  audience: string;
  status: string;
  updatedAt: string;
  createdAt: string;
  wordCount: number | null;
  folderCount: number;
  pinned: boolean;
  sortOrder: number | null;
  addedAt: string | null;
}

export interface DocumentCenterMembership {
  folderId: string;
  pinned: boolean;
  sortOrder: number;
  addedAt: string;
  folder: DocumentCenterFolder | null;
}

export interface DocumentCenterAuditEvent {
  id: string;
  eventType: string;
  createdAt: string;
  documentTitleSnapshot: string | null;
  metadata: Record<string, unknown>;
}

export interface DocumentCenterFact {
  id: string;
  chunkId: string | null;
  factType: string;
  value: Record<string, unknown>;
  confidence: number;
  audience: string;
  extractedByModel: string;
  extractedAt: string;
  traceId: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface DocumentCenterDocument {
  id: string;
  title: string;
  source: string;
  sourceUrl: string | null;
  mimeType: string | null;
  summary: string | null;
  audience: string;
  status: string;
  updatedAt: string;
  createdAt: string;
  wordCount: number | null;
  reviewDueAt: string | null;
  reviewOwnerUserId: string | null;
  approvedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface DocumentCenterListResponse {
  view: DocumentCenterView;
  currentFolder: DocumentCenterFolder | null;
  breadcrumbs: DocumentCenterBreadcrumb[];
  folders: DocumentCenterFolder[];
  folderTree: DocumentCenterFolder[];
  documents: DocumentCenterListItem[];
  nextCursor: string | null;
}

export interface DocumentCenterGetResponse {
  document: DocumentCenterDocument;
  memberships: DocumentCenterMembership[];
  auditEvents: DocumentCenterAuditEvent[];
  breadcrumbs: DocumentCenterBreadcrumb[];
  facts: DocumentCenterFact[];
}

export interface DocumentCenterNeighbor {
  id: string;
  direction: "inbound" | "outbound";
  edgeType: string;
  status: string;
  validFrom: string | null;
  validUntil: string | null;
  toDocumentId: string | null;
  toEntityType: string | null;
  toEntityId: string | null;
  toEntityLabel: string | null;
  fromDocumentId: string | null;
  confidence: number;
  sourceFactIds: string[];
}

export interface DocumentCenterNeighborsResponse {
  documentId: string;
  neighbors: DocumentCenterNeighbor[];
}

export interface DocumentAskCitation {
  chunkId: string;
  chunkIndex: number | null;
  excerpt: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  confidence: number;
}

export interface DocumentAskResponse {
  documentId: string;
  traceId: string;
  question: string;
  answer: string;
  citations: DocumentAskCitation[];
}

export interface DocumentCenterDownloadResponse {
  url: string;
  expiresAt: string;
}

async function documentRouterFetch<T>(path: string, options: {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  query?: Record<string, string | null | undefined>;
} = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-router${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorField = (payload as { error?: unknown }).error;
    let code: string | null = null;
    let message = "Document Center request failed";
    let details: string | null = null;
    if (errorField && typeof errorField === "object") {
      const errObj = errorField as { code?: unknown; message?: unknown; details?: unknown };
      if (typeof errObj.code === "string") code = errObj.code;
      if (typeof errObj.message === "string" && errObj.message.length > 0) message = errObj.message;
      if (typeof errObj.details === "string" && errObj.details.length > 0) details = errObj.details;
    } else if (typeof errorField === "string") {
      message = errorField;
    }
    const parts = [
      `${response.status}`,
      code,
      message,
      details && details !== message ? details : null,
    ].filter((part): part is string => Boolean(part));
    throw new Error(parts.join(" · "));
  }
  return payload as T;
}

export async function listDocumentsViaRouter(input: {
  view: DocumentCenterView;
  folderId?: string | null;
  cursor?: string | null;
  search?: string | null;
  pageSize?: number;
}): Promise<DocumentCenterListResponse> {
  return await documentRouterFetch<DocumentCenterListResponse>("/list", {
    query: {
      view: input.view,
      folder_id: input.folderId ?? null,
      cursor: input.cursor ?? null,
      search: input.search ?? null,
      page_size: String(input.pageSize ?? 50),
    },
  });
}

export async function getDocumentViaRouter(documentId: string): Promise<DocumentCenterGetResponse> {
  return await documentRouterFetch<DocumentCenterGetResponse>("/get", {
    query: { document_id: documentId },
  });
}

export async function createFolderViaRouter(input: {
  name: string;
  audience: string;
  parentId?: string | null;
}): Promise<{ folder: DocumentCenterFolder }> {
  return await documentRouterFetch<{ folder: DocumentCenterFolder }>("/folder-create", {
    method: "POST",
    body: {
      name: input.name,
      audience: input.audience,
      parentId: input.parentId ?? null,
    },
  });
}

export async function moveFolderViaRouter(input: {
  folderId: string;
  parentId?: string | null;
}): Promise<{ folder: DocumentCenterFolder }> {
  return await documentRouterFetch<{ folder: DocumentCenterFolder }>("/folder-move", {
    method: "POST",
    body: {
      folderId: input.folderId,
      parentId: input.parentId ?? null,
    },
  });
}

export async function moveDocumentViaRouter(input: {
  documentId: string;
  targetFolderId: string;
  sourceFolderId?: string | null;
}): Promise<{ success: true }> {
  return await documentRouterFetch<{ success: true }>("/move", {
    method: "POST",
    body: {
      documentId: input.documentId,
      targetFolderId: input.targetFolderId,
      sourceFolderId: input.sourceFolderId ?? null,
    },
  });
}

export async function duplicateLinkViaRouter(input: {
  documentId: string;
  targetFolderId: string;
}): Promise<{ success: true }> {
  return await documentRouterFetch<{ success: true }>("/duplicate-link", {
    method: "POST",
    body: {
      documentId: input.documentId,
      targetFolderId: input.targetFolderId,
    },
  });
}

export async function createDownloadUrlViaRouter(documentId: string): Promise<DocumentCenterDownloadResponse> {
  return await documentRouterFetch<DocumentCenterDownloadResponse>("/download-url", {
    method: "POST",
    body: { documentId },
  });
}

export interface DocumentReindexResponse {
  documentId: string;
  previousStatus: string;
  nextStatus: string;
}

export async function reindexDocumentViaRouter(documentId: string): Promise<DocumentReindexResponse> {
  return await documentRouterFetch<DocumentReindexResponse>("/reindex", {
    method: "POST",
    body: { documentId },
  });
}

export interface DocumentSearchResultItem {
  documentId: string;
  chunkId: string | null;
  title: string;
  excerpt: string;
  confidence: number;
  accessClass: string;
  chunkKind: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  sourceType: string;
}

export interface DocumentSearchResponse {
  query: string;
  traceId: string;
  results: DocumentSearchResultItem[];
}

export async function searchDocumentsViaRouter(input: {
  query: string;
  matchCount?: number;
}): Promise<DocumentSearchResponse> {
  return await documentRouterFetch<DocumentSearchResponse>("/search", {
    method: "POST",
    body: { query: input.query, matchCount: input.matchCount ?? 8 },
  });
}

export async function getDocumentNeighborsViaRouter(documentId: string): Promise<DocumentCenterNeighborsResponse> {
  return await documentRouterFetch<DocumentCenterNeighborsResponse>("/neighbors", {
    query: { document_id: documentId },
  });
}

export async function askDocumentViaRouter(input: {
  documentId: string;
  question: string;
}): Promise<DocumentAskResponse> {
  return await documentRouterFetch<DocumentAskResponse>("/ask", {
    method: "POST",
    body: { documentId: input.documentId, question: input.question },
  });
}

export async function rerunTwinViaRouter(input: {
  documentId: string;
  force?: boolean;
}): Promise<{ documentId: string; jobId: string; status: string; factCount: number; traceId: string }> {
  return await documentRouterFetch<{
    documentId: string;
    jobId: string;
    status: string;
    factCount: number;
    traceId: string;
  }>("/twin-rerun", {
    method: "POST",
    body: { documentId: input.documentId, force: input.force === true },
  });
}
