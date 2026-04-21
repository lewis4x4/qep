import { FolderOpen, MoveRight } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";

import type { DocumentCenterFolder } from "@/features/documents/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface FolderGridProps {
  folders: DocumentCenterFolder[];
  activeDropTargetId: string | null;
  onOpenFolder: (folderId: string) => void;
  onMoveFolder: (folderId: string) => void;
}

function formatTokenLabel(value: string): string {
  return value.split("_").join(" ");
}

export function FolderGrid({ folders, activeDropTargetId, onOpenFolder, onMoveFolder }: FolderGridProps) {
  if (folders.length === 0) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {folders.map((folder) => (
        <FolderTile
          key={folder.id}
          folder={folder}
          isActiveDropTarget={activeDropTargetId === `folder:${folder.id}`}
          onOpenFolder={onOpenFolder}
          onMoveFolder={onMoveFolder}
        />
      ))}
    </div>
  );
}

interface FolderTileProps {
  folder: DocumentCenterFolder;
  isActiveDropTarget: boolean;
  onOpenFolder: (folderId: string) => void;
  onMoveFolder: (folderId: string) => void;
}

function FolderTile({ folder, isActiveDropTarget, onOpenFolder, onMoveFolder }: FolderTileProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${folder.id}`,
    data: { kind: "folder", folderId: folder.id },
  });

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "border-border/80 transition-colors",
        (isOver || isActiveDropTarget) ? "border-primary bg-primary/5" : "",
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <button type="button" onClick={() => onOpenFolder(folder.id)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-3">
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <FolderOpen className="h-4 w-4 text-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{folder.name}</p>
              <p className="text-xs text-muted-foreground">
                {folder.documentCount} document{folder.documentCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="hidden text-[10px] uppercase sm:inline-flex">
            {formatTokenLabel(folder.audience)}
          </Badge>
          <Button type="button" size="icon" variant="ghost" onClick={() => onMoveFolder(folder.id)}>
            <MoveRight className="h-4 w-4" />
            <span className="sr-only">Move folder</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
