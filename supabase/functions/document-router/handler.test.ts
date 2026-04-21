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
    search: overrides.search ?? (async () => ({
      query: "test",
      traceId: "00000000-0000-0000-0000-000000000000",
      results: [],
    })),
    twinRerun: overrides.twinRerun ?? (async () => ({
      documentId: "doc-1",
      jobId: "job-1",
      status: "succeeded",
      factCount: 3,
      traceId: "22222222-2222-2222-2222-222222222222",
      modelVersion: "test",
    })),
    neighbors: overrides.neighbors ?? (async () => ({
      documentId: "doc-1",
      neighbors: [],
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

Deno.test("document-router search endpoint rejects empty queries and normalizes results", async () => {
  const captured: { query: string | null } = { query: null };
  const service = makeService({
    search: async (_ctx, input) => {
      captured.query = input.query;
      return {
        query: input.query,
        traceId: "11111111-1111-1111-1111-111111111111",
        results: [
          {
            documentId: "doc-9",
            chunkId: "chunk-1",
            title: "Rental Agreement #482",
            excerpt: "The lessee shall…",
            confidence: 0.87,
            accessClass: "company_wide",
            chunkKind: "paragraph",
            sectionTitle: "§7 Return Conditions",
            pageNumber: 4,
            sourceType: "document",
          },
        ],
      };
    },
  });

  const badReq = new Request("https://example.com/document-router/search", {
    method: "POST",
    body: JSON.stringify({ query: "   " }),
    headers: { "Content-Type": "application/json" },
  });
  const badRes = await handleDocumentRouterRequest(badReq, service);
  assertEquals(badRes.status, 400);

  const okReq = new Request("https://example.com/document-router/search", {
    method: "POST",
    body: JSON.stringify({ query: "return inspection" }),
    headers: { "Content-Type": "application/json" },
  });
  const okRes = await handleDocumentRouterRequest(okReq, service);
  assertEquals(okRes.status, 200);
  const payload = await parseJson(okRes);
  assertEquals(captured.query, "return inspection");
  assertEquals(payload.query, "return inspection");
  assertEquals((payload.results as unknown[]).length, 1);
});

Deno.test("document-router twin-rerun forwards documentId and returns twin result", async () => {
  const captured: { documentId: string | null; force: boolean | null } = { documentId: null, force: null };
  const service = makeService({
    twinRerun: async (_ctx, input) => {
      captured.documentId = input.documentId;
      captured.force = input.force ?? false;
      return {
        documentId: input.documentId,
        jobId: "job-99",
        status: "succeeded",
        factCount: 7,
        traceId: "33333333-3333-3333-3333-333333333333",
        modelVersion: "2026-04-21.1",
      };
    },
  });

  const req = new Request("https://example.com/document-router/twin-rerun", {
    method: "POST",
    body: JSON.stringify({ documentId: "doc-twin", force: true }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleDocumentRouterRequest(req, service);
  assertEquals(res.status, 200);
  const payload = await parseJson(res);
  assertEquals(captured.documentId, "doc-twin");
  assertEquals(captured.force, true);
  assertEquals(payload.jobId, "job-99");
  assertEquals(payload.status, "succeeded");
  assertEquals(payload.factCount, 7);
});

Deno.test("document-router neighbors endpoint returns outbound + inbound edges", async () => {
  const captured: { documentId: string | null } = { documentId: null };
  const service = makeService({
    neighbors: async (_ctx, input) => {
      captured.documentId = input.documentId;
      return {
        documentId: input.documentId,
        neighbors: [
          {
            id: "edge-1",
            direction: "outbound",
            edgeType: "expires_on",
            status: "at_risk",
            validFrom: null,
            validUntil: "2026-05-01T00:00:00.000Z",
            toDocumentId: null,
            toEntityType: "commitment",
            toEntityId: null,
            toEntityLabel: "2026-05-01",
            fromDocumentId: input.documentId,
            confidence: 0.92,
            sourceFactIds: ["fact-1"],
          },
        ],
      };
    },
  });

  const req = new Request("https://example.com/document-router/neighbors?document_id=doc-graph");
  const res = await handleDocumentRouterRequest(req, service);
  assertEquals(res.status, 200);
  const payload = await parseJson(res);
  assertEquals(captured.documentId, "doc-graph");
  assertEquals((payload.neighbors as unknown[]).length, 1);
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
