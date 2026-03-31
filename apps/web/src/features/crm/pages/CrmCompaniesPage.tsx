import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Plus, Search } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CrmCompanyEditorSheet } from "../components/CrmCompanyEditorSheet";
import { CrmPageHeader } from "../components/CrmPageHeader";
import { listCrmCompanies } from "../lib/crm-api";

export function CrmCompaniesPage() {
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

  const companiesQuery = useQuery({
    queryKey: ["crm", "companies", debouncedSearch],
    queryFn: () => listCrmCompanies(debouncedSearch),
    staleTime: 60_000,
  });

  const companies = companiesQuery.data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <CrmPageHeader
        title="CRM Companies"
        subtitle="Browse accounts and log activities by organization."
      />

      <div className="flex justify-end">
        <Button onClick={() => setEditorOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New company
        </Button>
      </div>

      <Card className="p-3 sm:p-4">
        <label htmlFor="crm-companies-search" className="sr-only">
          Search companies
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#475569]" />
          <input
            id="crm-companies-search"
            ref={searchRef}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by company, city, or state"
            className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white pl-9 pr-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
          />
        </div>
      </Card>

      {companiesQuery.isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading companies">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />
          ))}
        </div>
      )}

      {companiesQuery.isError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">Failed to load companies. Please refresh and try again.</p>
        </Card>
      )}

      {!companiesQuery.isLoading && !companiesQuery.isError && companies.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">No companies found. Try a different search term.</p>
        </Card>
      )}

      {!companiesQuery.isLoading && !companiesQuery.isError && companies.length > 0 && (
        <div className="space-y-3" aria-label="Company results">
          {companies.map((company) => (
            <Link
              key={company.id}
              to={`/crm/companies/${company.id}`}
              className="block min-h-[44px] rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm transition hover:border-[#E87722]/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87722]"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[#1E293B]">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#0F172A]">{company.name}</p>
                  <p className="truncate text-sm text-[#334155]">
                    {[company.city, company.state, company.country].filter(Boolean).join(", ") ||
                      "Location not specified"}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CrmCompanyEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(company) => navigate(`/crm/companies/${company.id}`)}
      />
    </div>
  );
}
