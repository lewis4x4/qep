import { Link2, MoveRight } from "lucide-react";

import type { DocumentCenterListItem } from "@/features/documents/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface FileListProps {
  documents: DocumentCenterListItem[];
  selectedDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  onMove: (documentId: string) => void;
  onDuplicateLink: (documentId: string) => void;
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
}: FileListProps) {
  if (documents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No documents in this view.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/80">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Audience</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-[140px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => {
            const isSelected = selectedDocumentId === doc.id;
            return (
              <TableRow
                key={doc.id}
                className={isSelected ? "bg-muted/40" : ""}
              >
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onSelectDocument(doc.id)}
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
                  <div className="flex justify-end gap-1">
                    <Button type="button" size="icon" variant="ghost" onClick={() => onMove(doc.id)}>
                      <MoveRight className="h-4 w-4" />
                      <span className="sr-only">Move document</span>
                    </Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => onDuplicateLink(doc.id)}>
                      <Link2 className="h-4 w-4" />
                      <span className="sr-only">Duplicate link</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
