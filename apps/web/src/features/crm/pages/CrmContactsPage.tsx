import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CrmContactEditorSheet } from "../components/CrmContactEditorSheet";
import { CrmPageHeader } from "../components/CrmPageHeader";
import { CrmSubNav } from "../components/CrmSubNav";
import { listCrmContacts } from "../lib/crm-api";

export function CrmContactsPage() {
  const navigate = useNavigate();
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
    queryKey: ["crm", "contacts", debouncedSearch],
    queryFn: ({ pageParam }) => listCrmContacts(debouncedSearch, pageParam),
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
      <CrmPageHeader
        title="CRM Contacts"
        subtitle="Search and open contact timelines quickly from the field."
      />
      <CrmSubNav />

      <div className="flex justify-end">
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
            No contacts found. Try a different search term.
          </p>
        </Card>
      )}

      {!contactsQuery.isLoading && !contactsQuery.isError && contacts.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-3" aria-label="Contact results">
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                to={`/crm/contacts/${contact.id}`}
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

      <CrmContactEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(contact) => navigate(`/crm/contacts/${contact.id}`)}
      />
    </div>
  );
}
