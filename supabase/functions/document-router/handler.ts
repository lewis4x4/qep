import {
  crmFail,
  crmOk,
  crmOptionsResponse,
  readJsonBody,
  safeText,
} from "../_shared/crm-router-http.ts";
import type {
  CreateFolderInput,
  DocumentRouterContext,
  DownloadUrlInput,
  DuplicateLinkInput,
  GetDocumentResult,
  ListDocumentsInput,
  ListDocumentsResult,
  MoveDocumentInput,
  MoveFolderInput,
  FolderSummary,
  DownloadUrlResult,
  ReindexInput,
  ReindexResult,
  SearchInput,
  SearchResult,
} from "./service.ts";
import {
  createDocumentRouterContext,
  createDownloadUrl,
  createFolder,
  duplicateLink,
  getDocument,
  listDocuments,
  moveDocument,
  moveFolder,
  reindexDocument,
  requireDocumentCenterAccess,
  searchDocuments,
} from "./service.ts";

export interface DocumentRouterService {
  createContext(req: Request): Promise<DocumentRouterContext>;
  list(ctx: DocumentRouterContext, input: ListDocumentsInput): Promise<ListDocumentsResult>;
  get(ctx: DocumentRouterContext, documentId: string): Promise<GetDocumentResult>;
  createFolder(ctx: DocumentRouterContext, input: CreateFolderInput): Promise<FolderSummary>;
  moveFolder(ctx: DocumentRouterContext, input: MoveFolderInput): Promise<FolderSummary>;
  moveDocument(ctx: DocumentRouterContext, input: MoveDocumentInput): Promise<void>;
  duplicateLink(ctx: DocumentRouterContext, input: DuplicateLinkInput): Promise<void>;
  downloadUrl(ctx: DocumentRouterContext, input: DownloadUrlInput): Promise<DownloadUrlResult>;
  reindex(ctx: DocumentRouterContext, input: ReindexInput): Promise<ReindexResult>;
  search(ctx: DocumentRouterContext, input: SearchInput): Promise<SearchResult>;
}

function normalizeDocumentRouterPath(pathname: string): string {
  if (pathname.startsWith("/document-router")) {
    return pathname.slice("/document-router".length) || "/";
  }
  return pathname;
}

function parsePageSize(value: string | null): number {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("VALIDATION_ERROR");
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function mapError(origin: string | null, error: unknown): Response {
  if (error instanceof SyntaxError) {
    return crmFail({
      origin,
      status: 400,
      code: "INVALID_JSON",
      message: "Request body must be valid JSON.",
    });
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message === "UNAUTHORIZED") {
    return crmFail({
      origin,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Missing or invalid authentication.",
    });
  }

  if (message === "FORBIDDEN") {
    return crmFail({
      origin,
      status: 403,
      code: "FORBIDDEN",
      message: "Caller role is not authorized for Document Center.",
    });
  }

  if (message === "SERVICE_WORKSPACE_UNBOUND") {
    return crmFail({
      origin,
      status: 403,
      code: "FORBIDDEN",
      message: "Service callers must present a signed workspace claim.",
    });
  }

  if (message === "INVALID_CURSOR") {
    return crmFail({
      origin,
      status: 400,
      code: "INVALID_CURSOR",
      message: "Cursor is malformed.",
    });
  }

  if (message === "VALIDATION_ERROR" || message.includes("invalid document center view")) {
    return crmFail({
      origin,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "The request parameters are invalid.",
    });
  }

  if (message === "HIERARCHY_CYCLE") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Folder move would create a hierarchy cycle.",
    });
  }

  if (message === "DOCUMENT_FILE_UNAVAILABLE") {
    return crmFail({
      origin,
      status: 409,
      code: "FILE_UNAVAILABLE",
      message: "This document does not have a locally downloadable original yet.",
    });
  }

  if (message === "REINDEX_NOT_APPLICABLE") {
    return crmFail({
      origin,
      status: 409,
      code: "REINDEX_NOT_APPLICABLE",
      message: "Reindex is only available for documents in the Ingest Failed state.",
    });
  }

  if (message === "NOT_FOUND" || message.includes("not found")) {
    return crmFail({
      origin,
      status: 404,
      code: "NOT_FOUND",
      message: "Requested document resource was not found.",
    });
  }

  return crmFail({
    origin,
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Document router request failed.",
    details: message.length > 0 ? message.slice(0, 500) : undefined,
  });
}

async function defaultService(): Promise<DocumentRouterService> {
  return {
    createContext: createDocumentRouterContext,
    list: listDocuments,
    get: getDocument,
    createFolder,
    moveFolder,
    moveDocument,
    duplicateLink,
    downloadUrl: createDownloadUrl,
    reindex: reindexDocument,
    search: searchDocuments,
  };
}

export async function handleDocumentRouterRequest(
  req: Request,
  serviceOverride?: DocumentRouterService,
): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return crmOptionsResponse(origin);

  const service = serviceOverride ?? await defaultService();

  try {
    const url = new URL(req.url);
    const path = normalizeDocumentRouterPath(url.pathname);
    const ctx = await service.createContext(req);
    requireDocumentCenterAccess(ctx);

    if (req.method === "GET" && path === "/list") {
      const view = safeText(url.searchParams.get("view")) ?? "all";
      if (
        view !== "all" &&
        view !== "recent" &&
        view !== "pinned" &&
        view !== "unfiled" &&
        view !== "folder" &&
        view !== "pending_review" &&
        view !== "ingest_failed"
      ) {
        throw new Error("VALIDATION_ERROR");
      }

      const payload = await service.list(ctx, {
        view,
        folderId: safeText(url.searchParams.get("folder_id")),
        pageSize: parsePageSize(url.searchParams.get("page_size")),
        cursor: safeText(url.searchParams.get("cursor")),
        search: safeText(url.searchParams.get("search")),
      });
      return crmOk(payload, { origin });
    }

    if (req.method === "GET" && path === "/get") {
      const documentId = safeText(url.searchParams.get("document_id"));
      if (!documentId) throw new Error("VALIDATION_ERROR");
      const payload = await service.get(ctx, documentId);
      return crmOk(payload, { origin });
    }

    if (req.method === "POST" && path === "/folder-create") {
      const body = await readJsonBody<CreateFolderInput>(req);
      const payload = await service.createFolder(ctx, {
        name: safeText(body.name) ?? "",
        audience: safeText(body.audience) ?? "",
        parentId: safeText(body.parentId),
      });
      return crmOk({ folder: payload }, { origin, status: 201 });
    }

    if (req.method === "POST" && path === "/folder-move") {
      const body = await readJsonBody<MoveFolderInput>(req);
      if (!safeText(body.folderId)) throw new Error("VALIDATION_ERROR");
      const payload = await service.moveFolder(ctx, {
        folderId: body.folderId,
        parentId: safeText(body.parentId),
      });
      return crmOk({ folder: payload }, { origin });
    }

    if (req.method === "POST" && path === "/move") {
      const body = await readJsonBody<MoveDocumentInput>(req);
      if (!safeText(body.documentId) || !safeText(body.targetFolderId)) throw new Error("VALIDATION_ERROR");
      await service.moveDocument(ctx, {
        documentId: body.documentId,
        targetFolderId: body.targetFolderId,
        sourceFolderId: safeText(body.sourceFolderId),
      });
      return crmOk({ success: true }, { origin });
    }

    if (req.method === "POST" && path === "/duplicate-link") {
      const body = await readJsonBody<DuplicateLinkInput>(req);
      if (!safeText(body.documentId) || !safeText(body.targetFolderId)) throw new Error("VALIDATION_ERROR");
      await service.duplicateLink(ctx, {
        documentId: body.documentId,
        targetFolderId: body.targetFolderId,
      });
      return crmOk({ success: true }, { origin });
    }

    if (req.method === "POST" && path === "/download-url") {
      const body = await readJsonBody<DownloadUrlInput>(req);
      if (!safeText(body.documentId)) throw new Error("VALIDATION_ERROR");
      const payload = await service.downloadUrl(ctx, {
        documentId: body.documentId,
      });
      return crmOk(payload, { origin });
    }

    if (req.method === "POST" && path === "/reindex") {
      const body = await readJsonBody<ReindexInput>(req);
      if (!safeText(body.documentId)) throw new Error("VALIDATION_ERROR");
      const payload = await service.reindex(ctx, {
        documentId: body.documentId,
      });
      return crmOk(payload, { origin });
    }

    if (req.method === "POST" && path === "/search") {
      const body = await readJsonBody<SearchInput>(req);
      const query = safeText(body.query);
      if (!query) throw new Error("VALIDATION_ERROR");
      const matchCount =
        typeof body.matchCount === "number" && Number.isFinite(body.matchCount)
          ? Math.trunc(body.matchCount)
          : undefined;
      const payload = await service.search(ctx, { query, matchCount });
      return crmOk(payload, { origin });
    }

    return crmFail({
      origin,
      status: 404,
      code: "NOT_FOUND",
      message: "Requested document router resource was not found.",
    });
  } catch (error) {
    return mapError(origin, error);
  }
}
