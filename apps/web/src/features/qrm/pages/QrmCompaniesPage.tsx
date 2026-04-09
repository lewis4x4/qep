import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Building2, Download, Plus, Search } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QrmCompanyEditorSheet } from "../components/QrmCompanyEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { listCrmCompanies } from "../lib/qrm-api";

export function QrmCompaniesPage() {
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

  const companiesQuery = useInfiniteQuery({
    queryKey: ["crm", "companies", debouncedSearch],
    queryFn: ({ pageParam }) => listCrmCompanies(debouncedSearch, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 60_000,
  });

  const companies = companiesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const hasNextPage = companiesQuery.hasNextPage;
  const isFetchingNextPage = companiesQuery.isFetchingNextPage;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="QRM Companies"
        subtitle="Browse accounts and log activities by organization."
      />
      <QrmSubNav />

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => {
          import("@/lib/csv-export").then(({ exportCompanies }) => {
            exportCompanies(companies.map((c) => ({
              ...c,
              assignedRepName: null,
            })));
          });
        }}>
          <Download className="mr-1 h-4 w-4" />
          Export CSV
        </Button>
        <Button onClick={() => setEditorOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New company
        </Button>
      </div>

      <Card className="border-border bg-card p-3 sm:p-4">
        <label htmlFor="crm-companies-search" className="sr-only">
          Search companies
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="crm-companies-search"
            ref={searchRef}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by company, city, or state"
            className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </Card>

      {companiesQuery.isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading companies">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl border border-border bg-muted/40"
            />
          ))}
        </div>
      )}

      {companiesQuery.isError && (
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load companies. Please refresh and try again.
          </p>
        </Card>
      )}

      {!companiesQuery.isLoading && !companiesQuery.isError && companies.length === 0 && (
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No companies found. Try a different search term.
          </p>
        </Card>
      )}

      {!companiesQuery.isLoading && !companiesQuery.isError && companies.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-3" aria-label="Company results">
            {companies.map((company) => (
              <Link
                key={company.id}
                to={`/crm/companies/${company.id}`}
                className="block min-h-[44px] rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Building2 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{company.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[company.city, company.state, company.country].filter(Boolean).join(", ") ||
                        "Location not specified"}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">{companies.length} companies loaded</p>
            {hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void companiesQuery.fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading more..." : "Load more companies"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground/80">
                You&apos;re at the end of the company list.
              </p>
            )}
          </div>
        </div>
      )}

      <QrmCompanyEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(company) => navigate(`/crm/companies/${company.id}`)}
      />
    </div>
  );
}
