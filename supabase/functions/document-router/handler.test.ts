import { assertEquals } from "jsr:@std/assert@1";

import { handleDocumentRouterRequest, type DocumentRouterService } from "./handler.ts";
import type {
  CreateFolderInput,
  DocumentRouterContext,
  DownloadUrlInput,
  DuplicateLinkInput,
  DownloadUrlResult,
  FolderSummary,
  GetDocumentResult,
  ListDocumentsInput,
  ListDocumentsResult,
  MoveDocumentInput,
  MoveFolderInput,
} from "./service.ts";

const baseContext: DocumentRouterContext = {
  admin: {} as never,
  callerDb: {} as never,
  caller: {
    authHeader: "Bearer token",
    userId: "user-1",
    role: "admin",
    isServiceRole: false,
    workspaceId: "default",
  },
  workspaceId: "default",
};

function makeService(overrides: Partial<DocumentRouterService> = {}): DocumentRouterService {
  return {
    createContext: overrides.createContext ?? (async () => baseContext),
    list: overrides.list ?? (async (): Promise<ListDocumentsResult> => ({
      view: "all",
      currentFolder: null,
      breadcrumbs: [],
      folders: [],
      folderTree: [],
      documents: [],
      nextCursor: null,
    })),
    get: overrides.get ?? (async (): Promise<GetDocumentResult> => ({
      document: {
        id: "doc-1",
        title: "Doc",
        source: "manual",
        sourceUrl: null,
        mimeType: "text/plain",
        summary: null,
        audience: "company_wide",
        status: "published",
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        wordCount: 10,
        reviewDueAt: null,
        reviewOwnerUserId: null,
        approvedAt: null,
        metadata: {},
      },
      memberships: [],
      auditEvents: [],
      breadcrumbs: [],
    })),
    createFolder: overrides.createFolder ?? (async (): Promise<FolderSummary> => ({
      id: "folder-1",
      parentId: null,
      name: "Folder",
      audience: "company_wide",
      isSmart: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documentCount: 0,
    })),
    moveFolder: overrides.moveFolder ?? (async (): Promise<FolderSummary> => ({
      id: "folder-1",
      parentId: null,
      name: "Folder",
      audience: "company_wide",
      isSmart: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documentCount: 0,
    })),
    moveDocument: overrides.moveDocument ?? (async () => undefined),
    duplicateLink: overrides.duplicateLink ?? (async () => undefined),
    downloadUrl: overrides.downloadUrl ?? (async (): Promise<DownloadUrlResult> => ({
      url: "https://example.com/signed",
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    })),
    reindex: overrides.reindex ?? (async () => ({
      documentId: "doc-1",
      previousStatus: "ingest_failed",
      nextStatus: "pending_review",
    })),
  };
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("document-router list endpoint maps request params and returns payload", async () => {
  const captured: { value: ListDocumentsInput | null } = { value: null };
  const service = makeService({
    list: async (_ctx, input) => {
      captured.value = input;
      return {
        view: input.view,
        currentFolder: null,
        breadcrumbs: [],
        folders: [],
        folderTree: [],
        documents: [],
        nextCursor: null,
      };
    },
  });

  const req = new Request(
    "https://example.com/document-router/list?view=folder&folder_id=folder-1&page_size=25&cursor=cursor-1&search=warranty",
  );
  const res = await handleDocumentRouterRequest(req, service);

  assertEquals(res.status, 200);
  const payload = await parseJson(res);
  assertEquals(payload.view, "folder");
  assertEquals(captured.value?.view ?? null, "folder");
  assertEquals(captured.value?.folderId ?? null, "folder-1");
  assertEquals(captured.value?.pageSize ?? null, 25);
  assertEquals(captured.value?.cursor ?? null, "cursor-1");
  assertEquals(captured.value?.search ?? null, "warranty");
});

Deno.test("document-router move validates required fields", async () => {
  const service = makeService();
  const req = new Request("https://example.com/document-router/move", {
    method: "POST",
    body: JSON.stringify({ documentId: "doc-1" }),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleDocumentRouterRequest(req, service);
  assertEquals(res.status, 400);
  const payload = await parseJson(res);
  assertEquals((payload.error as { code?: string }).code, "VALIDATION_ERROR");
});

Deno.test("document-router download-url returns url + expiresAt", async () => {
  const service = makeService({
    downloadUrl: async (_ctx, input) => {
      assertEquals(input.documentId, "doc-99");
      return {
        url: "https://example.com/signed-doc",
        expiresAt: "2026-01-01T00:00:30.000Z",
      };
    },
  });

  const req = new Request("https://example.com/document-router/download-url", {
    method: "POST",
    body: JSON.stringify({ documentId: "doc-99" }),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleDocumentRouterRequest(req, service);
  assertEquals(res.status, 200);
  const payload = await parseJson(res);
  assertEquals(payload.url, "https://example.com/signed-doc");
  assertEquals(payload.expiresAt, "2026-01-01T00:00:30.000Z");
});

Deno.test("document-router enforces admin+ access", async () => {
  const service = makeService({
    createContext: async () => ({
      ...baseContext,
      caller: {
        ...baseContext.caller,
        role: "rep",
      },
    }),
  });

  const req = new Request("https://example.com/document-router/list?view=all");
  const res = await handleDocumentRouterRequest(req, service);
  assertEquals(res.status, 403);
  const payload = await parseJson(res);
  assertEquals((payload.error as { code?: string }).code, "FORBIDDEN");
});

Deno.test("document-router surfaces unmapped error messages as details for diagnosis", async () => {
  const service = makeService({
    list: async () => {
      throw new Error("function get_my_workspace() does not exist");
    },
  });

  const req = new Request("https://example.com/document-router/list?view=all");
  const res = await handleDocumentRouterRequest(req, service);
  assertEquals(res.status, 500);
  const payload = await parseJson(res);
  const err = payload.error as { code?: string; message?: string; details?: string };
  assertEquals(err.code, "INTERNAL_ERROR");
  assertEquals(
    typeof err.details === "string" && err.details.includes("get_my_workspace"),
    true,
  );
});

Deno.test("document-router reindex endpoint flips ingest_failed documents to pending_review", async () => {
  const captured: { documentId: string | null } = { documentId: null };
  const service = makeService({
    reindex: async (_ctx, input) => {
      captured.documentId = input.documentId;
      return { documentId: input.documentId, previousStatus: "ingest_failed", nextStatus: "pending_review" };
    },
  });

  const req = new Request("https://example.com/document-router/reindex", {
    method: "POST",
    body: JSON.stringify({ documentId: "doc-42" }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleDocumentRouterRequest(req, service);
  assertEquals(res.status, 200);
  const payload = await parseJson(res);
  assertEquals(payload.documentId, "doc-42");
  assertEquals(payload.previousStatus, "ingest_failed");
  assertEquals(payload.nextStatus, "pending_review");
  assertEquals(captured.documentId, "doc-42");
});

Deno.test("document-router list accepts pending_review and ingest_failed views", async () => {
  const captured: Array<string> = [];
  const service = makeService({
    list: async (_ctx, input) => {
      captured.push(input.view);
      return {
        view: input.view,
        currentFolder: null,
        breadcrumbs: [],
        folders: [],
        folderTree: [],
        documents: [],
        nextCursor: null,
      };
    },
  });

  for (const view of ["pending_review", "ingest_failed"]) {
    const req = new Request(`https://example.com/document-router/list?view=${view}`);
    const res = await handleDocumentRouterRequest(req, service);
    assertEquals(res.status, 200, `expected 200 for view=${view}`);
  }
  assertEquals(captured, ["pending_review", "ingest_failed"]);
});

Deno.test("document-router fails closed when caller has no userId", async () => {
  const service = makeService({
    createContext: async () => ({
      ...baseContext,
      caller: {
        authHeader: null,
        userId: null,
        role: null,
        isServiceRole: false,
        workspaceId: null,
      },
    }),
  });

  const req = new Request("https://example.com/document-router/list?view=all");
  const res = await handleDocumentRouterRequest(req, service);
  assertEquals(res.status, 401);
  const payload = await parseJson(res);
  assertEquals((payload.error as { code?: string }).code, "UNAUTHORIZED");
});
