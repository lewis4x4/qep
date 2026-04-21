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
