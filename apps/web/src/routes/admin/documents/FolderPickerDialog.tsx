import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FolderClosed, FolderOpen, Home, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DocumentCenterFolder } from "@/features/documents/router";

export interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  folders: DocumentCenterFolder[];
  disabledFolderIds?: Set<string>;
  allowRoot?: boolean;
  initialFolderId?: string | null;
  submitLabel?: string;
  onSubmit: (folderId: string | null) => Promise<void>;
}

interface FolderNode {
  folder: DocumentCenterFolder;
  depth: number;
  children: FolderNode[];
}

function buildTree(folders: DocumentCenterFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const folder of folders) {
    byId.set(folder.id, { folder, depth: 0, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.folder.parentId && byId.has(node.folder.parentId)) {
      const parent = byId.get(node.folder.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  roots.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
  for (const node of byId.values()) {
    node.children.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
  }
  return roots;
}

function flatten(tree: FolderNode[], filter: string | null, expanded: Set<string>, acc: FolderNode[] = []): FolderNode[] {
  for (const node of tree) {
    const matches = !filter || node.folder.name.toLowerCase().includes(filter);
    const isExpanded = !filter ? expanded.has(node.folder.id) : true;
    if (matches || hasMatchingDescendant(node, filter)) {
      acc.push({ ...node, depth: node.depth });
    }
    if (isExpanded && node.children.length > 0) {
      flatten(node.children, filter, expanded, acc);
    }
  }
  return acc;
}

function hasMatchingDescendant(node: FolderNode, filter: string | null): boolean {
  if (!filter) return false;
  for (const child of node.children) {
    if (child.folder.name.toLowerCase().includes(filter)) return true;
    if (hasMatchingDescendant(child, filter)) return true;
  }
  return false;
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  folders,
  disabledFolderIds,
  allowRoot = true,
  initialFolderId = null,
  submitLabel = "Move here",
  onSubmit,
}: FolderPickerDialogProps) {
  const [selected, setSelected] = useState<string | null>(initialFolderId);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const tree = useMemo(() => buildTree(folders), [folders]);
  const normalizedFilter = filter.trim().toLowerCase() || null;
  const flat = useMemo(() => flatten(tree, normalizedFilter, expanded), [tree, normalizedFilter, expanded]);

  useEffect(() => {
    if (!open) {
      setSelected(initialFolderId);
      setFilter("");
      setSubmitting(false);
    }
  }, [open, initialFolderId]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSubmit = (allowRoot || selected !== null) && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(selected);
      onOpenChange(false);
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter folders"
            className="pl-9"
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {allowRoot ? (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className={cn(
                "flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm",
                selected === null ? "bg-primary/10 text-foreground" : "hover:bg-muted",
              )}
            >
              <Home className="h-4 w-4" />
              <span className="font-medium">Root</span>
              <span className="text-xs text-muted-foreground">— top-level, no parent folder</span>
            </button>
          ) : null}
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {normalizedFilter ? "No folders match this filter." : "No folders in this workspace yet."}
            </p>
          ) : (
            flat.map((node) => {
              const disabled = disabledFolderIds?.has(node.folder.id) ?? false;
              const isSelected = selected === node.folder.id;
              const isExpanded = expanded.has(node.folder.id);
              const hasChildren = node.children.length > 0;
              return (
                <div
                  key={node.folder.id}
                  className={cn(
                    "flex items-center gap-2 border-b border-border/60 px-2 py-1.5 text-sm last:border-b-0",
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                    isSelected ? "bg-primary/10 text-foreground" : disabled ? "" : "hover:bg-muted",
                  )}
                  style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                  onClick={() => {
                    if (!disabled) setSelected(node.folder.id);
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasChildren) toggleExpand(node.folder.id);
                    }}
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-sm",
                      hasChildren ? "text-muted-foreground hover:bg-background" : "invisible",
                    )}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronRight
                      className={cn("h-3 w-3 transition-transform", isExpanded ? "rotate-90" : "")}
                    />
                  </button>
                  {isExpanded && hasChildren ? (
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FolderClosed className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">{node.folder.name}</span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {node.folder.audience.split("_").join(" ")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{node.folder.documentCount}</span>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
