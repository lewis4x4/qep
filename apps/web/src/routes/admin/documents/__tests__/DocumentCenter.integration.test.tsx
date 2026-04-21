import { beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastSpy = mock(() => undefined);

mock.module("@/components/RequireAdmin", () => ({
  RequireAdmin: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}));

const mockListDocuments = mock(() =>
  Promise.resolve({
    view: "all",
    currentFolder: null,
    breadcrumbs: [],
    folders: [
      {
        id: "folder-1",
        parentId: null,
        name: "Rental Agreements",
        audience: "company_wide",
        isSmart: false,
        createdAt: "2026-04-21T10:00:00Z",
        updatedAt: "2026-04-21T10:00:00Z",
        documentCount: 1,
      },
    ],
    folderTree: [
      {
        id: "folder-1",
        parentId: null,
        name: "Rental Agreements",
        audience: "company_wide",
        isSmart: false,
        createdAt: "2026-04-21T10:00:00Z",
        updatedAt: "2026-04-21T10:00:00Z",
        documentCount: 1,
      },
    ],
    documents: [
      {
        id: "doc-1",
        title: "Rental Contract A",
        source: "manual",
        mimeType: "application/pdf",
        summary: "Test summary",
        audience: "company_wide",
        status: "published",
        updatedAt: "2026-04-21T11:00:00Z",
        createdAt: "2026-04-21T10:00:00Z",
        wordCount: 120,
        folderCount: 1,
        pinned: false,
        sortOrder: null,
        addedAt: null,
      },
    ],
    nextCursor: null,
  }),
);

const mockGetDocument = mock(() =>
  Promise.resolve({
    document: {
      id: "doc-1",
      title: "Rental Contract A",
      source: "manual",
      sourceUrl: null,
      mimeType: "application/pdf",
      summary: "Test summary",
      audience: "company_wide",
      status: "published",
      updatedAt: "2026-04-21T11:00:00Z",
      createdAt: "2026-04-21T10:00:00Z",
      wordCount: 120,
      reviewDueAt: null,
      reviewOwnerUserId: null,
      approvedAt: null,
      metadata: { storage_bucket: "documents", storage_path: "x.pdf" },
    },
    memberships: [],
    auditEvents: [],
    breadcrumbs: [],
  }),
);

const mockCreateDownload = mock(() =>
  Promise.resolve({
    url: "https://example.com/signed",
    expiresAt: "2026-04-21T11:00:30Z",
  }),
);

mock.module("@/features/documents/router", () => ({
  listDocumentsViaRouter: mockListDocuments,
  getDocumentViaRouter: mockGetDocument,
  createFolderViaRouter: mock(() => Promise.resolve({ folder: null })),
  moveFolderViaRouter: mock(() => Promise.resolve({ folder: null })),
  moveDocumentViaRouter: mock(() => Promise.resolve({ success: true })),
  duplicateLinkViaRouter: mock(() => Promise.resolve({ success: true })),
  createDownloadUrlViaRouter: mockCreateDownload,
}));

const { DocumentCenterPage } = await import("../DocumentCenter");

describe("DocumentCenterPage (integration)", () => {
  beforeEach(() => {
    // Order matters: zero the body first, then call cleanup() defensively.
    // Under happy-dom, a prior test file's teardown can leave @testing-
    // library's internal container registry pointing at nodes that have
    // already been detached. Calling cleanup() first then throws
    // `DOMException: Failed to execute 'removeChild'`. Swapping the order
    // and wrapping cleanup() in try/catch makes this robust to any file-
    // load ordering.
    document.body.innerHTML = "";
    try { cleanup(); } catch { /* stale container registry — safe to ignore */ }
    mockListDocuments.mockClear();
    mockGetDocument.mockClear();
    mockCreateDownload.mockClear();
    toastSpy.mockClear();
  });

  test("loads folders/documents and opens context on row click", async () => {
    render(<DocumentCenterPage />);

    await screen.findByRole("heading", { name: "Document Center" });
    await waitFor(() => expect(mockListDocuments).toHaveBeenCalled());
    const folderButtons = await screen.findAllByRole("button", { name: /Rental Agreements/i });
    expect(folderButtons.length).toBeGreaterThan(0);
    const titleNode = await screen.findByText("Rental Contract A");
    const documentRow = titleNode.closest("button");
    expect(documentRow).not.toBeNull();

    fireEvent.click(documentRow as HTMLButtonElement);
    await waitFor(() => {
      expect(mockGetDocument).toHaveBeenCalledWith("doc-1");
    });
  });

  test("download button calls router download endpoint", async () => {
    const openSpy = mock(() => null);
    (globalThis as unknown as { open: typeof openSpy }).open = openSpy;

    render(<DocumentCenterPage />);
    await waitFor(() => expect(mockListDocuments).toHaveBeenCalled());
    const titleNode = await screen.findByText("Rental Contract A");
    const documentRow = titleNode.closest("button");
    expect(documentRow).not.toBeNull();

    fireEvent.click(documentRow as HTMLButtonElement);
    await waitFor(() => {
      expect(mockGetDocument).toHaveBeenCalled();
    });

    const downloadButton = await screen.findByRole("button", { name: /download/i });
    fireEvent.click(downloadButton);
    await waitFor(() => {
      expect(mockCreateDownload).toHaveBeenCalledWith("doc-1");
    });
  });
});
