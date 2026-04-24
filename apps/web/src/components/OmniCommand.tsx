import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ClipboardList,
  FileText,
  FolderOpen,
  Gauge,
  KeyboardIcon,
  LayoutDashboard,
  Loader2,
  Package,
  Wrench,
} from "lucide-react";

import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  searchDocumentsViaRouter,
  type DocumentSearchResultItem,
} from "@/features/documents/router";

type OmniRole = "rep" | "admin" | "manager" | "owner" | "client_stakeholder";

interface JumpEntry {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  role?: OmniRole[];
}

const JUMPS: JumpEntry[] = [
  {
    id: "jump:dashboard",
    label: "Dashboard",
    description: "Your daily command center",
    path: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    id: "jump:documents",
    label: "Document Center",
    description: "Workspace-scoped document navigation",
    path: "/admin/documents",
    icon: FolderOpen,
    role: ["admin", "manager", "owner"],
  },
  {
    id: "jump:pending-review",
    label: "Pending Review",
    description: "Documents awaiting approval",
    path: "/admin/documents?view=pending_review",
    icon: ClipboardList,
    role: ["admin", "manager", "owner"],
  },
  {
    id: "jump:ingest-failures",
    label: "Ingest Failures",
    description: "Documents whose ingest did not complete",
    path: "/admin/documents?view=ingest_failed",
    icon: AlertTriangle,
    role: ["admin", "manager", "owner"],
  },
  {
    id: "jump:qrm",
    label: "QRM Command Center",
    description: "Deal pipeline, plays, and risks",
    path: "/qrm",
    icon: Gauge,
  },
  {
    id: "jump:parts",
    label: "Parts Companion",
    description: "Parts catalog and operations",
    path: "/parts",
    icon: Package,
  },
  {
    id: "jump:service",
    label: "Service",
    description: "Service command center",
    path: "/service",
    icon: Wrench,
  },
];

export interface OmniCommandProps {
  role: OmniRole;
}

export function OmniCommand({ role }: OmniCommandProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<DocumentSearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  const navigate = useNavigate();

  const debounceTimerRef = useRef<number | null>(null);
  const latestSearchRef = useRef(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isPaletteKey = event.key === "k" && (event.metaKey || event.ctrlKey);
      if (isPaletteKey) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    function onOpenOmniCommand() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("qep:open-omni-command", onOpenOmniCommand);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("qep:open-omni-command", onOpenOmniCommand);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setError(null);
      setLastTraceId(null);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  const fetchResults = useCallback(async (q: string, searchId: number) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await searchDocumentsViaRouter({ query: q, matchCount: 10 });
      if (latestSearchRef.current !== searchId) return;
      setResults(payload.results);
      setLastTraceId(payload.traceId);
    } catch (err) {
      if (latestSearchRef.current !== searchId) return;
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
      setLastTraceId(null);
    } finally {
      if (latestSearchRef.current === searchId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!debouncedQuery) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++latestSearchRef.current;
    void fetchResults(debouncedQuery, id);
  }, [debouncedQuery, open, fetchResults]);

  const visibleJumps = useMemo(
    () => JUMPS.filter((j) => !j.role || j.role.includes(role)),
    [role],
  );

  function handleSelectDocument(doc: DocumentSearchResultItem) {
    const traceQuery = lastTraceId ? `&trace=${encodeURIComponent(lastTraceId)}` : "";
    const chunkQuery = doc.chunkId ? `?chunk=${encodeURIComponent(doc.chunkId)}` : "";
    const path =
      doc.chunkId !== null
        ? `/admin/documents/${doc.documentId}${chunkQuery}${traceQuery ? `&rank=${chunkQuery ? "" : "1"}${traceQuery.slice(1)}` : ""}`
        : `/admin/documents?document=${doc.documentId}`;
    setOpen(false);
    navigate(path);
  }

  function handleSelectJump(jump: JumpEntry) {
    setOpen(false);
    navigate(jump.path);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0 gap-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search documents and jump to any surface. Use arrow keys and enter to select.
        </DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search documents or jump to a surface…"
          />
          <CommandList>
            {error ? (
              <div className="p-4 text-sm text-destructive">
                <div className="font-medium">Search failed</div>
                <div className="text-xs text-muted-foreground">{error}</div>
              </div>
            ) : null}

            {loading ? (
              <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Searching…
              </div>
            ) : null}

            {!loading && debouncedQuery && results.length === 0 && !error ? (
              <CommandEmpty>
                No documents matched "{debouncedQuery}".
              </CommandEmpty>
            ) : null}

            {results.length > 0 ? (
              <CommandGroup heading="Documents">
                {results.map((doc, idx) => (
                  <CommandItem
                    key={`${doc.documentId}:${doc.chunkId ?? idx}`}
                    value={`${doc.documentId}:${doc.chunkId ?? ""}:${idx}`}
                    onSelect={() => handleSelectDocument(doc)}
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{doc.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {doc.sectionTitle ? `${doc.sectionTitle} · ` : ""}
                        {doc.excerpt}
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {(doc.confidence * 100).toFixed(0)}%
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {results.length > 0 ? <CommandSeparator /> : null}

            <CommandGroup heading="Jump to">
              {visibleJumps.map((jump) => {
                const Icon = jump.icon;
                return (
                  <CommandItem
                    key={jump.id}
                    value={jump.id}
                    onSelect={() => handleSelectJump(jump)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-sm">{jump.label}</span>
                      <span className="text-xs text-muted-foreground">{jump.description}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>

            <CommandSeparator />
            <div className="flex items-center gap-3 px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <KeyboardIcon className="h-3 w-3" />
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-muted/50 px-1">⌘</kbd>
                <kbd className="rounded border border-border bg-muted/50 px-1">K</kbd>
                toggle
              </span>
              <CommandShortcut>↑ ↓ navigate · ↵ open · esc close</CommandShortcut>
            </div>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
