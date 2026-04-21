import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Loader2, Plus } from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

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
  reindexDocumentViaRouter,
  type DocumentCenterFolder,
  type DocumentCenterGetResponse,
  type DocumentCenterListItem,
  type DocumentCenterListResponse,
  type DocumentCenterView,
} from "@/features/documents/router";
import { cn } from "@/lib/utils";
import { FolderGrid } from "./FolderGrid";
import { FileList } from "./FileList";
import { ContextPane } from "./ContextPane";
import { OmniSearch } from "./OmniSearch";
import { FolderCreateDialog, type DocumentAudience } from "./FolderCreateDialog";
import { FolderPickerDialog } from "./FolderPickerDialog";

const SYNTHETIC_VIEWS: Array<{ id: DocumentCenterView; label: string; section: "browse" | "review" }> = [
  { id: "all", label: "All Files", section: "browse" },
  { id: "recent", label: "Recents", section: "browse" },
  { id: "pinned", label: "Pinned", section: "browse" },
  { id: "unfiled", label: "Unfiled", section: "browse" },
  { id: "pending_review", label: "Pending Review", section: "review" },
  { id: "ingest_failed", label: "Ingest Failures", section: "review" },
];

type DocumentMoveTarget =
  | { kind: "move"; documentId: string; sourceFolderId: string | null }
  | { kind: "duplicate-link"; documentId: string }
  | null;

type FolderMoveTarget = { folderId: string } | null;

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

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [documentMoveTarget, setDocumentMoveTarget] = useState<DocumentMoveTarget>(null);
  const [folderMoveTarget, setFolderMoveTarget] = useState<FolderMoveTarget>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const foldersById = useMemo(() => {
    const map = new Map<string, DocumentCenterFolder>();
    for (const folder of listState?.folderTree ?? []) map.set(folder.id, folder);
    return map;
  }, [listState?.folderTree]);

  const loadList = useCallback(
    async (cursor: string | null = null, append = false) => {
      if (append) setLoadingMore(true);
      else setLoadingList(true);
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
            ...payload.documents.filter((doc) => !prev.documents.some((existing) => existing.id === doc.id)),
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
        if (append) setLoadingMore(false);
        else setLoadingList(false);
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
  const folderTree = listState?.folderTree ?? [];
  const descendantsByFolder = useMemo(() => buildDescendantMap(folderTree), [folderTree]);

  function primaryFolderIdForDocument(documentId: string): string | null {
    const doc = documents.find((d) => d.id === documentId);
    if (!doc) return null;
    if (view === "folder" && folderId) return folderId;
    return doc.sortOrder !== null ? folderId : null;
  }

  async function handleCreateFolderSubmit(input: { name: string; audience: DocumentAudience }) {
    try {
      await createFolderViaRouter({
        name: input.name,
        audience: input.audience,
        parentId: view === "folder" ? folderId : null,
      });
      toast({ title: "Folder created" });
      await loadList();
    } catch (error) {
      toast({
        title: "Folder create failed",
        description: error instanceof Error ? error.message : "Could not create folder",
        variant: "destructive",
      });
      throw error;
    }
  }

  async function handleFolderMoveSubmit(nextParentId: string | null) {
    if (!folderMoveTarget) return;
    try {
      await moveFolderViaRouter({ folderId: folderMoveTarget.folderId, parentId: nextParentId });
      toast({ title: "Folder moved" });
      await loadList();
    } catch (error) {
      toast({
        title: "Folder move failed",
        description: error instanceof Error ? error.message : "Could not move folder",
        variant: "destructive",
      });
      throw error;
    }
  }

  async function handleDocumentMoveSubmit(targetFolderId: string | null) {
    if (!documentMoveTarget) return;
    if (!targetFolderId) {
      throw new Error("Pick a destination folder.");
    }
    try {
      if (documentMoveTarget.kind === "move") {
        await moveDocumentViaRouter({
          documentId: documentMoveTarget.documentId,
          targetFolderId,
          sourceFolderId: documentMoveTarget.sourceFolderId,
        });
        toast({ title: "Document moved" });
      } else {
        await duplicateLinkViaRouter({
          documentId: documentMoveTarget.documentId,
          targetFolderId,
        });
        toast({ title: "Folder link created" });
      }
      await loadList();
    } catch (error) {
      toast({
        title: documentMoveTarget.kind === "move" ? "Move failed" : "Link failed",
        description: error instanceof Error ? error.message : "Could not complete action",
        variant: "destructive",
      });
      throw error;
    }
  }

  async function handleQuickMoveToFolder(documentId: string, targetFolderId: string) {
    try {
      await moveDocumentViaRouter({
        documentId,
        targetFolderId,
        sourceFolderId: primaryFolderIdForDocument(documentId),
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

  async function handleReindexDocument(documentId: string) {
    try {
      const payload = await reindexDocumentViaRouter(documentId);
      toast({
        title: "Reindex requested",
        description: `Status ${payload.previousStatus} → ${payload.nextStatus}`,
      });
      await loadList();
    } catch (error) {
      toast({
        title: "Reindex failed",
        description: error instanceof Error ? error.message : "Could not requeue document",
        variant: "destructive",
      });
    }
  }

  async function handleCopyDownloadUrl(documentId: string) {
    try {
      const payload = await createDownloadUrlViaRouter(documentId);
      await navigator.clipboard.writeText(payload.url);
      toast({
        title: "Download URL copied",
        description: `Expires ${new Date(payload.expiresAt).toLocaleTimeString()}`,
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: error instanceof Error ? error.message : "Could not generate download URL",
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

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    setActiveDropTargetId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    setActiveDropTargetId(null);
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as { kind?: string; documentId?: string } | undefined;
    const overData = over.data.current as { kind?: string; folderId?: string } | undefined;
    if (activeData?.kind !== "document" || !activeData.documentId) return;
    if (overData?.kind !== "folder" || !overData.folderId) return;
    void handleQuickMoveToFolder(activeData.documentId, overData.folderId);
  }

  const documentMoveDisabled = useMemo(() => {
    if (!documentMoveTarget) return undefined;
    const disabled = new Set<string>();
    if (documentMoveTarget.kind === "move" && documentMoveTarget.sourceFolderId) {
      disabled.add(documentMoveTarget.sourceFolderId);
    }
    return disabled;
  }, [documentMoveTarget]);

  const folderMoveDisabled = useMemo(() => {
    if (!folderMoveTarget) return undefined;
    const disabled = new Set<string>(descendantsByFolder.get(folderMoveTarget.folderId) ?? []);
    disabled.add(folderMoveTarget.folderId);
    return disabled;
  }, [folderMoveTarget, descendantsByFolder]);

  const currentFolderName = view === "folder" && folderId ? foldersById.get(folderId)?.name ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveDragId(null);
        setActiveDropTargetId(null);
      }}
    >
      <div className="mx-auto max-w-[1600px] space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Document Center</h1>
            <p className="text-sm text-muted-foreground">
              Workspace-scoped document navigation with folder organization and governed access.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New folder
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
                {SYNTHETIC_VIEWS.filter((entry) => entry.section === "browse").map((entry) => {
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
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Review
                </p>
                <div className="space-y-1">
                  {SYNTHETIC_VIEWS.filter((entry) => entry.section === "review").map((entry) => {
                    const active = view === entry.id;
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
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Folders
                </p>
                <div className="max-h-[420px] space-y-1 overflow-auto pr-1">
                  {folderTree.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      No folders yet. Use <em>New folder</em> to create one.
                    </p>
                  ) : (
                    folderTree.map((folder) => (
                      <SidebarFolderRow
                        key={folder.id}
                        folder={folder}
                        depth={getFolderDepth(folder.id, foldersById)}
                        active={view === "folder" && folderId === folder.id}
                        activeDropTargetId={activeDropTargetId}
                        onOpen={handleOpenFolder}
                      />
                    ))
                  )}
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
                  activeDropTargetId={activeDropTargetId}
                  onOpenFolder={handleOpenFolder}
                  onMoveFolder={(folderIdValue) => setFolderMoveTarget({ folderId: folderIdValue })}
                />
                <FileList
                  documents={documents}
                  selectedDocumentId={selectedDocumentId}
                  onSelectDocument={setSelectedDocumentId}
                  onMove={(documentId) =>
                    setDocumentMoveTarget({
                      kind: "move",
                      documentId,
                      sourceFolderId: primaryFolderIdForDocument(documentId),
                    })
                  }
                  onDuplicateLink={(documentId) => setDocumentMoveTarget({ kind: "duplicate-link", documentId })}
                  onCopyDownloadUrl={(documentId) => void handleCopyDownloadUrl(documentId)}
                  onReindex={(documentId) => void handleReindexDocument(documentId)}
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
                      Load more
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

      <FolderCreateDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        parentFolderName={currentFolderName}
        onSubmit={handleCreateFolderSubmit}
      />

      <FolderPickerDialog
        open={folderMoveTarget !== null}
        onOpenChange={(next) => {
          if (!next) setFolderMoveTarget(null);
        }}
        title="Move folder"
        description={
          folderMoveTarget
            ? `Select a new parent for ${foldersById.get(folderMoveTarget.folderId)?.name ?? "this folder"}.`
            : undefined
        }
        folders={folderTree}
        disabledFolderIds={folderMoveDisabled}
        allowRoot
        initialFolderId={
          folderMoveTarget ? foldersById.get(folderMoveTarget.folderId)?.parentId ?? null : null
        }
        submitLabel="Move folder"
        onSubmit={handleFolderMoveSubmit}
      />

      <FolderPickerDialog
        open={documentMoveTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDocumentMoveTarget(null);
        }}
        title={documentMoveTarget?.kind === "duplicate-link" ? "Link document to folder" : "Move document"}
        description={
          documentMoveTarget?.kind === "duplicate-link"
            ? "Creates an additional reference to this document in the target folder. No file copy is made."
            : "Pick a destination folder. The original folder link is replaced."
        }
        folders={folderTree}
        disabledFolderIds={documentMoveDisabled}
        allowRoot={false}
        submitLabel={documentMoveTarget?.kind === "duplicate-link" ? "Create link" : "Move here"}
        onSubmit={handleDocumentMoveSubmit}
      />

      {activeDragId ? (
        <div className="pointer-events-none fixed bottom-6 right-6 z-[60] rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground shadow">
          Drop on a folder to move
        </div>
      ) : null}
    </DndContext>
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

function buildDescendantMap(folders: DocumentCenterFolder[]): Map<string, Set<string>> {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId) {
      const siblings = childrenByParent.get(folder.parentId) ?? [];
      siblings.push(folder.id);
      childrenByParent.set(folder.parentId, siblings);
    }
  }
  const result = new Map<string, Set<string>>();
  function collect(folderId: string, acc: Set<string>) {
    for (const child of childrenByParent.get(folderId) ?? []) {
      if (acc.has(child)) continue;
      acc.add(child);
      collect(child, acc);
    }
  }
  for (const folder of folders) {
    const acc = new Set<string>();
    collect(folder.id, acc);
    result.set(folder.id, acc);
  }
  return result;
}

interface SidebarFolderRowProps {
  folder: DocumentCenterFolder;
  depth: number;
  active: boolean;
  activeDropTargetId: string | null;
  onOpen: (folderId: string) => void;
}

function SidebarFolderRow({ folder, depth, active, activeDropTargetId, onOpen }: SidebarFolderRowProps) {
  const dropId = `folder:${folder.id}`;
  const { setNodeRef, isOver } = useDroppable({ id: dropId, data: { kind: "folder", folderId: folder.id } });
  const highlighted = isOver || activeDropTargetId === dropId;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onOpen(folder.id)}
      className={cn(
        "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors",
        active
          ? "bg-primary/90 text-primary-foreground"
          : highlighted
          ? "bg-primary/10 text-foreground"
          : "text-foreground hover:bg-muted",
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <span className="truncate">{folder.name}</span>
      <span className="text-[10px] opacity-70">{folder.documentCount}</span>
    </button>
  );
}
