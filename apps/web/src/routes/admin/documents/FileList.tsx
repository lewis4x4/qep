import { GripVertical, Link2, MoreHorizontal, MoveRight, RefreshCw } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";

import type { DocumentCenterListItem } from "@/features/documents/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface FileListProps {
  documents: DocumentCenterListItem[];
  selectedDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  onMove: (documentId: string) => void;
  onDuplicateLink: (documentId: string) => void;
  onCopyDownloadUrl: (documentId: string) => void;
  onReindex: (documentId: string) => void;
}

function formatAudienceLabel(audience: string): string {
  return audience.split("_").join(" ");
}

export function FileList({
  documents,
  selectedDocumentId,
  onSelectDocument,
  onMove,
  onDuplicateLink,
  onCopyDownloadUrl,
  onReindex,
}: FileListProps) {
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm font-medium text-foreground">No documents in this view.</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Switch to another view, clear any search filter, or drop a file here once uploads ship. Admins can
          also create a folder to organize existing documents.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/80">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Audience</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-[60px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <FileRow
              key={doc.id}
              doc={doc}
              isSelected={selectedDocumentId === doc.id}
              onSelect={onSelectDocument}
              onMove={onMove}
              onDuplicateLink={onDuplicateLink}
              onCopyDownloadUrl={onCopyDownloadUrl}
              onReindex={onReindex}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface FileRowProps {
  doc: DocumentCenterListItem;
  isSelected: boolean;
  onSelect: (documentId: string) => void;
  onMove: (documentId: string) => void;
  onDuplicateLink: (documentId: string) => void;
  onCopyDownloadUrl: (documentId: string) => void;
  onReindex: (documentId: string) => void;
}

function FileRow({
  doc,
  isSelected,
  onSelect,
  onMove,
  onDuplicateLink,
  onCopyDownloadUrl,
  onReindex,
}: FileRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `doc:${doc.id}`,
    data: { kind: "document", documentId: doc.id },
  });

  return (
    <TableRow
      ref={setNodeRef}
      className={cn(
        isSelected ? "bg-muted/40" : "",
        isDragging ? "opacity-40" : "",
      )}
      aria-grabbed={isDragging || undefined}
    >
      <TableCell className="w-8 text-muted-foreground">
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label="Drag document"
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded-sm hover:bg-muted active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell>
        <button
          type="button"
          onClick={() => onSelect(doc.id)}
          className="max-w-[420px] truncate text-left text-sm font-medium text-foreground hover:underline"
        >
          {doc.title}
        </button>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-[10px] uppercase">
          {formatAudienceLabel(doc.audience)}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={doc.status === "published" ? "default" : "secondary"}>
          {doc.status.split("_").join(" ")}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(doc.updatedAt).toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        {doc.status === "ingest_failed" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onReindex(doc.id)}
            className="mr-1"
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" aria-label="Document actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => onSelect(doc.id)}>Open context</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(doc.id)}>
              <MoveRight className="h-4 w-4" />
              Move to folder…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicateLink(doc.id)}>
              <Link2 className="h-4 w-4" />
              Link to another folder…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onCopyDownloadUrl(doc.id)}>
              Copy signed download URL
            </DropdownMenuItem>
            {doc.status === "ingest_failed" ? (
              <DropdownMenuItem onSelect={() => onReindex(doc.id)}>
                <RefreshCw className="h-4 w-4" />
                Retry ingest
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
