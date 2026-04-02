import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { searchCrm } from "../lib/crm-router-api";
import type { CrmSearchItem } from "../lib/types";

function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;

  const lower = text.toLowerCase();
  const index = lower.indexOf(q);
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <span className="font-semibold text-foreground">{text.slice(index, index + q.length)}</span>
      {text.slice(index + q.length)}
    </>
  );
}

function resultPath(result: CrmSearchItem): string {
  return result.type === "contact" ? `/crm/contacts/${result.id}` : `/crm/companies/${result.id}`;
}

export function CrmGlobalSearchCommand() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const shouldOpen = isMac ? event.metaKey : event.ctrlKey;
      if (!shouldOpen || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen((prev) => !prev);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const searchQuery = useQuery({
    queryKey: ["crm", "global-search", query],
    queryFn: () => searchCrm(query),
    enabled: open && query.trim().length > 1,
    staleTime: 15_000,
  });

  const contacts = useMemo(
    () => (searchQuery.data ?? []).filter((item) => item.type === "contact"),
    [searchQuery.data],
  );
  const companies = useMemo(
    () => (searchQuery.data ?? []).filter((item) => item.type === "company"),
    [searchQuery.data],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:flex h-9 w-full max-w-[400px] items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground hover:text-foreground"
        aria-label="Open CRM search"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="truncate">Search contacts and companies</span>
        <kbd className="ml-auto shrink-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setQuery("");
          }
        }}
      >
        <DialogContent className="p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>CRM Search</DialogTitle>
            <DialogDescription>Search contacts and companies using keyboard navigation.</DialogDescription>
          </DialogHeader>

          <Command shouldFilter={false} loop className="rounded-lg border-0 bg-background">
            <div className="flex items-center border-b border-border px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search contacts or companies..."
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                aria-label="Search contacts or companies"
              />
            </div>

            <Command.List className="max-h-[460px] overflow-y-auto p-2">
              {query.trim().length < 2 && (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Type at least 2 characters to search.
                </div>
              )}

              {searchQuery.isLoading && (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">Searching...</div>
              )}

              {searchQuery.isError && (
                <div className="px-2 py-6 text-center text-sm text-destructive">
                  Search failed. Try again.
                </div>
              )}

              {!searchQuery.isLoading && !searchQuery.isError && query.trim().length > 1 && searchQuery.data?.length === 0 && (
                <Command.Empty>No matching CRM records.</Command.Empty>
              )}

              {companies.length > 0 && (
                <Command.Group heading="Companies" className="px-2 pb-2 text-xs text-muted-foreground">
                  {companies.map((result) => (
                    <Command.Item
                      key={result.id}
                      value={`company-${result.id}`}
                      onSelect={() => {
                        setOpen(false);
                        navigate(resultPath(result));
                      }}
                      className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-secondary"
                    >
                      <span className="text-foreground">{highlightMatch(result.title, query)}</span>
                      {result.subtitle && (
                        <span className="text-xs text-muted-foreground">{highlightMatch(result.subtitle, query)}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {contacts.length > 0 && (
                <Command.Group heading="Contacts" className="px-2 pb-2 text-xs text-muted-foreground">
                  {contacts.map((result) => (
                    <Command.Item
                      key={result.id}
                      value={`contact-${result.id}`}
                      onSelect={() => {
                        setOpen(false);
                        navigate(resultPath(result));
                      }}
                      className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-secondary"
                    >
                      <span className="text-foreground">{highlightMatch(result.title, query)}</span>
                      {result.subtitle && (
                        <span className="text-xs text-muted-foreground">{highlightMatch(result.subtitle, query)}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
