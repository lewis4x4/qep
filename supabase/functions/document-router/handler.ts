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
  TwinRerunInput,
  TwinRerunResult,
  NeighborsInput,
  NeighborsResult,
  AskInput,
  AskResult,
  PlaysListInput,
  PlaysListResult,
  PlayActionInput,
  PlayActionResult,
  PlaysRunInput,
  PlaysRunResult,
  PlayDraftInput,
  PlayDraftResult,
} from "./service.ts";
import {
  actionDocumentPlay,
  askDocument,
  createDocumentRouterContext,
  createDownloadUrl,
  createFolder,
  draftFromPlay,
  duplicateLink,
  getDocument,
  getDocumentNeighbors,
  listDocumentPlays,
  listDocuments,
  moveDocument,
  moveFolder,
  reindexDocument,
  requireDocumentCenterAccess,
  rerunTwin,
  runPlaysBatch,
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
  twinRerun(ctx: DocumentRouterContext, input: TwinRerunInput): Promise<TwinRerunResult>;
  neighbors(ctx: DocumentRouterContext, input: NeighborsInput): Promise<NeighborsResult>;
  ask(ctx: DocumentRouterContext, input: AskInput): Promise<AskResult>;
  playsList(ctx: DocumentRouterContext, input: PlaysListInput): Promise<PlaysListResult>;
  playAction(ctx: DocumentRouterContext, input: PlayActionInput): Promise<PlayActionResult>;
  playsRun(ctx: DocumentRouterContext, input: PlaysRunInput): Promise<PlaysRunResult>;
  playDraft(ctx: DocumentRouterContext, input: PlayDraftInput): Promise<PlayDraftResult>;
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

  if (message === "TWIN_UNCONFIGURED") {
    return crmFail({
      origin,
      status: 503,
      code: "TWIN_UNCONFIGURED",
      message: "Document twin is not configured on this deployment.",
    });
  }

  if (message === "OPENAI_UNCONFIGURED") {
    return crmFail({
      origin,
      status: 503,
      code: "OPENAI_UNCONFIGURED",
      message: "OPENAI_API_KEY is not configured for the document-router.",
    });
  }

  if (message === "PLAY_NOT_OPEN") {
    return crmFail({
      origin,
      status: 409,
      code: "PLAY_NOT_OPEN",
      message: "This play is no longer in the open state.",
    });
  }

  if (message.startsWith("TWIN_UPSTREAM:")) {
    const parts = message.split(":");
    const upstreamCode = parts[1] ?? "TWIN_UPSTREAM_ERROR";
    const detail = parts.slice(2).join(":").slice(0, 500);
    return crmFail({
      origin,
      status: 502,
      code: upstreamCode,
      message: "Document twin pipeline returned an error.",
      details: detail.length > 0 ? detail : undefined,
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
    twinRerun: rerunTwin,
    neighbors: getDocumentNeighbors,
    ask: askDocument,
    playsList: listDocumentPlays,
    playAction: actionDocumentPlay,
    playsRun: runPlaysBatch,
    playDraft: draftFromPlay,
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

    if (req.method === "POST" && path === "/twin-rerun") {
      const body = await readJsonBody<TwinRerunInput>(req);
      if (!safeText(body.documentId)) throw new Error("VALIDATION_ERROR");
      const payload = await service.twinRerun(ctx, {
        documentId: body.documentId,
        force: body.force === true,
      });
      return crmOk(payload, { origin });
    }

    if (req.method === "GET" && path === "/neighbors") {
      const documentId = safeText(url.searchParams.get("document_id"));
      if (!documentId) throw new Error("VALIDATION_ERROR");
      const payload = await service.neighbors(ctx, { documentId });
      return crmOk(payload, { origin });
    }

    if (req.method === "POST" && path === "/ask") {
      const body = await readJsonBody<AskInput>(req);
      const documentId = safeText(body.documentId);
      const question = safeText(body.question);
      if (!documentId || !question) throw new Error("VALIDATION_ERROR");
      const payload = await service.ask(ctx, { documentId, question });
      return crmOk(payload, { origin });
    }

    if (req.method === "GET" && path === "/plays") {
      const status = safeText(url.searchParams.get("status")) ?? undefined;
      const ownerUserId = safeText(url.searchParams.get("owner")) ?? null;
      const documentIdFilter = safeText(url.searchParams.get("document_id")) ?? null;
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const payload = await service.playsList(ctx, {
        status,
        ownerUserId,
        documentId: documentIdFilter,
        limit: Number.isFinite(limit) ? (limit as number) : undefined,
      });
      return crmOk(payload, { origin });
    }

    if (req.method === "POST" && path === "/plays/action") {
      const body = await readJsonBody<PlayActionInput>(req);
      if (!safeText(body.playId) || !safeText(body.action)) throw new Error("VALIDATION_ERROR");
      const payload = await service.playAction(ctx, {
        playId: body.playId,
        action: body.action,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
      });
      return crmOk(payload, { origin });
    }

    if (req.method === "POST" && path === "/plays/run") {
      const body = await readJsonBody<PlaysRunInput>(req);
      const payload = await service.playsRun(ctx, {
        documentId: safeText(body.documentId),
      });
      return crmOk(payload, { origin });
    }

    if (req.method === "POST" && path === "/plays/draft") {
      const body = await readJsonBody<PlayDraftInput>(req);
      if (!safeText(body.playId)) throw new Error("VALIDATION_ERROR");
      const payload = await service.playDraft(ctx, {
        playId: body.playId,
        flow: body.flow,
      });
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
