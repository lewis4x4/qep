import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Loader2, Plus } from "lucide-react";

import { RequireAdmin } from "@/components/RequireAdmin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  createDownloadUrlViaRouter,
  createFolderViaRouter,
  duplicateLinkViaRouter,
  getDocumentViaRouter,
  listDocumentsViaRouter,
  moveDocumentViaRouter,
  moveFolderViaRouter,
  type DocumentCenterFolder,
  type DocumentCenterGetResponse,
  type DocumentCenterListItem,
  type DocumentCenterListResponse,
  type DocumentCenterView,
} from "@/features/documents/router";
import { FolderGrid } from "./FolderGrid";
import { FileList } from "./FileList";
import { ContextPane } from "./ContextPane";
import { OmniSearch } from "./OmniSearch";

const SYNTHETIC_VIEWS: Array<{ id: DocumentCenterView; label: string }> = [
  { id: "all", label: "All Files" },
  { id: "recent", label: "Recents" },
  { id: "pinned", label: "Pinned" },
  { id: "unfiled", label: "Unfiled" },
];

export function DocumentCenterPage() {
  return (
    <RequireAdmin roles={["admin", "manager", "owner"]}>
      <DocumentCenterPageInner />
    </RequireAdmin>
  );
}

function DocumentCenterPageInner() {
  const { toast } = useToast();

  const [view, setView] = useState<DocumentCenterView>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [listState, setListState] = useState<DocumentCenterListResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<DocumentCenterGetResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const foldersById = useMemo(() => {
    const map = new Map<string, DocumentCenterFolder>();
    for (const folder of listState?.folderTree ?? []) map.set(folder.id, folder);
    return map;
  }, [listState?.folderTree]);

  const loadList = useCallback(
    async (cursor: string | null = null, append = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingList(true);
      }
      try {
        const payload = await listDocumentsViaRouter({
          view,
          folderId,
          search: searchValue || null,
          cursor,
          pageSize: 50,
        });
        setListState((prev) => {
          if (!append || !prev) return payload;
          const mergedDocs = [
            ...prev.documents,
            ...payload.documents.filter(
              (doc) => !prev.documents.some((existing) => existing.id === doc.id),
            ),
          ];
          return { ...payload, documents: mergedDocs };
        });
      } catch (error) {
        toast({
          title: "Document Center failed to load",
          description: error instanceof Error ? error.message : "Could not load documents",
          variant: "destructive",
        });
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoadingList(false);
        }
      }
    },
    [view, folderId, searchValue, toast],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void getDocumentViaRouter(selectedDocumentId)
      .then((payload) => {
        if (!cancelled) setSelectedDetail(payload);
      })
      .catch((error) => {
        if (!cancelled) {
          toast({
            title: "Could not load document context",
            description: error instanceof Error ? error.message : "Document context failed",
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, toast]);

  const documents: DocumentCenterListItem[] = listState?.documents ?? [];

  async function handleCreateFolder() {
    const name = window.prompt("Folder name");
    if (!name) return;

    const audience = window.prompt(
      "Audience (company_wide | finance | leadership | admin_owner | owner_only)",
      "company_wide",
    );
    if (!audience) return;

    try {
      await createFolderViaRouter({
        name,
        audience,
        parentId: folderId,
      });
      toast({ title: "Folder created" });
      await loadList();
    } catch (error) {
      toast({
        title: "Folder create failed",
        description: error instanceof Error ? error.message : "Could not create folder",
        variant: "destructive",
      });
    }
  }

  async function handleMoveFolder(targetFolderId: string) {
    const parent = window.prompt("New parent folder id (blank for root)", "");
    try {
      await moveFolderViaRouter({
        folderId: targetFolderId,
        parentId: parent?.trim() ? parent.trim() : null,
      });
      toast({ title: "Folder moved" });
      await loadList();
    } catch (error) {
      toast({
        title: "Folder move failed",
        description: error instanceof Error ? error.message : "Could not move folder",
        variant: "destructive",
      });
    }
  }

  async function handleMoveDocument(documentId: string) {
    const targetFolderId = window.prompt("Target folder id");
    if (!targetFolderId) return;
    const sourceFolderId = window.prompt("Source folder id (optional)", "");
    try {
      await moveDocumentViaRouter({
        documentId,
        targetFolderId: targetFolderId.trim(),
        sourceFolderId: sourceFolderId?.trim() ? sourceFolderId.trim() : null,
      });
      toast({ title: "Document moved" });
      await loadList();
    } catch (error) {
      toast({
        title: "Move failed",
        description: error instanceof Error ? error.message : "Could not move document",
        variant: "destructive",
      });
    }
  }

  async function handleDuplicateLink(documentId: string) {
    const targetFolderId = window.prompt("Target folder id");
    if (!targetFolderId) return;
    try {
      await duplicateLinkViaRouter({
        documentId,
        targetFolderId: targetFolderId.trim(),
      });
      toast({ title: "Folder link created" });
      await loadList();
    } catch (error) {
      toast({
        title: "Link failed",
        description: error instanceof Error ? error.message : "Could not link document",
        variant: "destructive",
      });
    }
  }

  async function handleDownloadSelected() {
    if (!selectedDocumentId) return;
    setDownloading(true);
    try {
      const payload = await createDownloadUrlViaRouter(selectedDocumentId);
      window.open(payload.url, "_blank", "noopener,noreferrer");
      toast({
        title: "Download URL generated",
        description: `Expires ${new Date(payload.expiresAt).toLocaleTimeString()}`,
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Could not create download URL",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  function handleSelectView(nextView: DocumentCenterView) {
    setView(nextView);
    setFolderId(null);
    setSelectedDocumentId(null);
  }

  function handleOpenFolder(nextFolderId: string) {
    setView("folder");
    setFolderId(nextFolderId);
    setSelectedDocumentId(null);
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Document Center</h1>
          <p className="text-sm text-muted-foreground">
            Workspace-scoped document navigation with folder organization and governed access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={handleCreateFolder}>
            <Plus className="mr-2 h-4 w-4" />
            New Folder
          </Button>
          <Button type="button" variant="outline" onClick={() => void loadList()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Views</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              {SYNTHETIC_VIEWS.map((entry) => {
                const active = view === entry.id && (entry.id !== "folder" || !folderId);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => handleSelectView(entry.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                      active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span>{entry.label}</span>
                    {active && <Badge variant="secondary">Active</Badge>}
                  </button>
                );
              })}
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Folders</p>
              <div className="max-h-[420px] space-y-1 overflow-auto pr-1">
                {(listState?.folderTree ?? []).map((folder) => {
                  const depth = getFolderDepth(folder.id, foldersById);
                  const active = view === "folder" && folderId === folder.id;
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => handleOpenFolder(folder.id)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs ${
                        active ? "bg-primary/90 text-primary-foreground" : "text-foreground hover:bg-muted"
                      }`}
                      style={{ paddingLeft: `${8 + depth * 12}px` }}
                    >
                      <span className="truncate">{folder.name}</span>
                      <span className="text-[10px] opacity-70">{folder.documentCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <OmniSearch
                value={searchInput}
                onChange={setSearchInput}
                onSubmit={() => setSearchValue(searchInput.trim())}
                onClear={() => {
                  setSearchInput("");
                  setSearchValue("");
                }}
              />

              {listState?.breadcrumbs && listState.breadcrumbs.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FolderOpen className="h-3 w-3" />
                  <span>{listState.breadcrumbs.map((crumb) => crumb.name).join(" / ")}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {loadingList ? (
            <div className="flex h-40 items-center justify-center rounded-md border border-border">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <FolderGrid
                folders={listState?.folders ?? []}
                onOpenFolder={handleOpenFolder}
                onMoveFolder={(targetFolderId) => void handleMoveFolder(targetFolderId)}
              />
              <FileList
                documents={documents}
                selectedDocumentId={selectedDocumentId}
                onSelectDocument={setSelectedDocumentId}
                onMove={(documentId) => void handleMoveDocument(documentId)}
                onDuplicateLink={(documentId) => void handleDuplicateLink(documentId)}
              />
              {listState?.nextCursor && (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingMore}
                    onClick={() => void loadList(listState.nextCursor, true)}
                  >
                    {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <ContextPane
          detail={selectedDetail}
          loading={loadingDetail}
          onDownload={() => void handleDownloadSelected()}
          downloading={downloading}
        />
      </div>
    </div>
  );
}

function getFolderDepth(folderId: string, foldersById: Map<string, DocumentCenterFolder>): number {
  let depth = 0;
  let cursor = foldersById.get(folderId)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    depth += 1;
    seen.add(cursor);
    cursor = foldersById.get(cursor)?.parentId ?? null;
  }
  return depth;
}
