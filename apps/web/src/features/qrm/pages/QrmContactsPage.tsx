import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Download, Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QrmContactEditorSheet } from "../components/QrmContactEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { listCrmContacts } from "../lib/qrm-api";
import { isUuid } from "@/lib/uuid";

export function QrmContactsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const treeRootParam = searchParams.get("treeRoot");
  const treeRootCompanyId = useMemo(() => {
    if (!treeRootParam || !isUuid(treeRootParam)) return undefined;
    return treeRootParam;
  }, [treeRootParam]);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      searchRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const startedAt = useMemo(() => performance.now(), [debouncedSearch]);

  const contactsQuery = useInfiniteQuery({
    queryKey: ["crm", "contacts", debouncedSearch, treeRootCompanyId ?? null],
    queryFn: ({ pageParam }) =>
      listCrmContacts(debouncedSearch, pageParam, {
        treeRootCompanyId: treeRootCompanyId,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 60_000,
    meta: { startedAt },
  });

  const contacts = contactsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const hasNextPage = contactsQuery.hasNextPage;
  const isFetchingNextPage = contactsQuery.isFetchingNextPage;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="QRM Contacts"
        subtitle="Search and open contact timelines quickly from the field."
      />
      <QrmSubNav />

      {treeRootCompanyId && (
        <Card className="flex flex-col gap-2 border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p>
              Showing contacts linked to this company and its child companies (same scope as the hierarchy
              roll-up on the company detail page).
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 self-start sm:self-auto">
            <Link to="/qrm/contacts">Clear company filter</Link>
          </Button>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => {
          import("@/lib/csv-export").then(({ exportContacts }) => {
            exportContacts(contacts.map((c) => ({
              ...c,
              companyName: null,
              assignedRepName: null,
            })));
          });
        }}>
          <Download className="mr-1 h-4 w-4" />
          Export CSV
        </Button>
        <Button onClick={() => setEditorOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New contact
        </Button>
      </div>

      <Card className="border-border bg-card p-3 sm:p-4">
        <label htmlFor="crm-contacts-search" className="sr-only">
          Search contacts
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="crm-contacts-search"
            ref={searchRef}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by name, email, or phone"
            className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </Card>

      {contactsQuery.isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading contacts">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl border border-border bg-muted/40"
            />
          ))}
        </div>
      )}

      {contactsQuery.isError && (
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load contacts. Please refresh and try again.
          </p>
        </Card>
      )}

      {!contactsQuery.isLoading && !contactsQuery.isError && contacts.length === 0 && (
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {treeRootCompanyId
              ? "No contacts linked to this company tree with the current search."
              : "No contacts found. Try a different search term."}
          </p>
        </Card>
      )}

      {!contactsQuery.isLoading && !contactsQuery.isError && contacts.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-3" aria-label="Contact results">
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                to={`/qrm/contacts/${contact.id}`}
                className="block min-h-[44px] rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {contact.firstName} {contact.lastName}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {contact.title || "Sales contact"}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground/90">
                      {contact.email || contact.phone || "No contact details"}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">{contacts.length} contacts loaded</p>
            {hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void contactsQuery.fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading more..." : "Load more contacts"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground/80">
                You&apos;re at the end of the contact list.
              </p>
            )}
          </div>
        </div>
      )}

      <QrmContactEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(contact) => navigate(`/qrm/contacts/${contact.id}`)}
      />
    </div>
  );
}
