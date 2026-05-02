import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Clock3, MapPin, Route, UsersRound } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeckSurface } from "../components/command-deck";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  computeTerritoryVisitPriorities,
  extractTerritoryCompanyIds,
  normalizeTerritoryActivityRows,
  normalizeTerritoryCompanyRows,
  normalizeTerritoryContactRows,
  normalizeTerritoryDealRows,
  normalizeTerritoryLinkRows,
  normalizeTerritoryRow,
  type TerritoryActivityRow,
  type TerritoryCompanyRow,
  type TerritoryContactRow,
  type TerritoryDealRow,
  type TerritoryLinkRow,
  type TerritoryRow,
} from "../lib/territory-command";
import { buildAccountCommandHref } from "../lib/account-command";
import { supabase } from "@/lib/supabase";

export function TerritoryCommandCenterPage() {
  const { territoryId } = useParams<{ territoryId: string }>();

  const territoryQuery = useQuery({
    queryKey: ["territory-command", territoryId, "territory"],
    queryFn: async (): Promise<TerritoryRow | null> => {
      const { data, error } = await supabase
        .from("crm_territories")
        .select("id, name, description, assigned_rep_id")
        .eq("id", territoryId!)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return normalizeTerritoryRow(data);
    },
    enabled: Boolean(territoryId),
    staleTime: 60_000,
  });

  const linksQuery = useQuery({
    queryKey: ["territory-command", territoryId, "links"],
    queryFn: async (): Promise<TerritoryLinkRow[]> => {
      const { data, error } = await supabase
        .from("crm_contact_territories")
        .select("contact_id")
        .eq("territory_id", territoryId!)
        .limit(500);
      if (error) throw new Error(error.message);
      return normalizeTerritoryLinkRows(data);
    },
    enabled: Boolean(territoryId),
    staleTime: 60_000,
  });

  const contactIds = useMemo(
    () => [...new Set((linksQuery.data ?? []).map((row) => row.contact_id).filter(Boolean))],
    [linksQuery.data],
  );

  const [contactsQuery, companiesQuery, dealsQuery, activitiesQuery, repNameQuery] = useQueries({
    queries: [
      {
        queryKey: ["territory-command", territoryId, "contacts", contactIds.join(",")],
        enabled: contactIds.length > 0,
        queryFn: async (): Promise<TerritoryContactRow[]> => {
          const { data, error } = await supabase
            .from("crm_contacts")
            .select("id, first_name, last_name, primary_company_id")
            .in("id", contactIds)
            .is("deleted_at", null);
          if (error) throw new Error(error.message);
          return normalizeTerritoryContactRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["territory-command", territoryId, "companies", contactIds.join(",")],
        enabled: contactIds.length > 0,
        queryFn: async (): Promise<TerritoryCompanyRow[]> => {
          const { data: contacts } = await supabase
            .from("crm_contacts")
            .select("primary_company_id")
            .in("id", contactIds)
            .is("deleted_at", null);
          const companyIds = extractTerritoryCompanyIds(contacts);
          if (companyIds.length === 0) return [];
          const { data, error } = await supabase
            .from("crm_companies")
            .select("id, name")
            .in("id", companyIds)
            .is("deleted_at", null);
          if (error) throw new Error(error.message);
          return normalizeTerritoryCompanyRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["territory-command", territoryId, "deals", contactIds.join(",")],
        enabled: contactIds.length > 0,
        queryFn: async (): Promise<TerritoryDealRow[]> => {
          const { data: contacts } = await supabase
            .from("crm_contacts")
            .select("primary_company_id")
            .in("id", contactIds)
            .is("deleted_at", null);
          const companyIds = extractTerritoryCompanyIds(contacts);
          const { data, error } = await supabase
            .from("crm_deals")
            .select("id, name, company_id, primary_contact_id, amount, expected_close_on, next_follow_up_at")
            .or([
              contactIds.length > 0 ? `primary_contact_id.in.(${contactIds.join(",")})` : "",
              companyIds.length > 0 ? `company_id.in.(${companyIds.join(",")})` : "",
            ].filter(Boolean).join(","))
            .is("deleted_at", null)
            .is("closed_at", null)
            .limit(500);
          if (error) throw new Error(error.message);
          return normalizeTerritoryDealRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["territory-command", territoryId, "activities", contactIds.join(",")],
        enabled: contactIds.length > 0,
        queryFn: async (): Promise<TerritoryActivityRow[]> => {
          const { data: contacts } = await supabase
            .from("crm_contacts")
            .select("primary_company_id")
            .in("id", contactIds)
            .is("deleted_at", null);
          const companyIds = extractTerritoryCompanyIds(contacts);
          const { data, error } = await supabase
            .from("crm_activities")
            .select("occurred_at, company_id, contact_id")
            .or([
              contactIds.length > 0 ? `contact_id.in.(${contactIds.join(",")})` : "",
              companyIds.length > 0 ? `company_id.in.(${companyIds.join(",")})` : "",
            ].filter(Boolean).join(","))
            .is("deleted_at", null)
            .limit(1000);
          if (error) throw new Error(error.message);
          return normalizeTerritoryActivityRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["territory-command", territoryId, "rep-name", territoryQuery.data?.assigned_rep_id],
        enabled: Boolean(territoryQuery.data?.assigned_rep_id),
        queryFn: async (): Promise<string | null> => {
          const { data, error } = await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("id", territoryQuery.data!.assigned_rep_id!)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return data?.full_name || data?.email || null;
        },
        staleTime: 60_000,
      },
    ],
  });

  const computed = useMemo(
    () =>
      computeTerritoryVisitPriorities({
        contacts: contactsQuery.data ?? [],
        companies: companiesQuery.data ?? [],
        deals: dealsQuery.data ?? [],
        activities: activitiesQuery.data ?? [],
      }),
    [activitiesQuery.data, companiesQuery.data, contactsQuery.data, dealsQuery.data],
  );

  if (!territoryId) {
    return <Navigate to="/qrm/contacts" replace />;
  }

  if (territoryQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (territoryQuery.isError || !territoryQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">This territory command surface isn&apos;t available right now.</p>
        </DeckSurface>
      </div>
    );
  }

  const territory = territoryQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/qrm/contacts">
            <ArrowLeft className="h-4 w-4" />
            Back to contacts
          </Link>
        </Button>
      </div>

      <QrmPageHeader
        title={territory.name}
        subtitle={territory.description || "Territory routing and visit priority"}
      />

      <QrmSubNav />

      <div className="grid gap-4 md:grid-cols-4">
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            <UsersRound className="h-4 w-4 text-qep-orange" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contacts</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-foreground">{String(computed.summary.contactCount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Contacts assigned to this territory</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-qep-orange" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Accounts</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-foreground">{String(computed.summary.accountCount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Companies represented in the territory</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-qep-orange" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Open deals</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-foreground">{String(computed.summary.openDealCount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Open commercial opportunities in-territory</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-qep-orange" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">High-priority visits</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-foreground">{String(computed.summary.highPriorityCount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{computed.summary.overdueFollowUps} overdue follow-ups need routing</p>
        </DeckSurface>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <DeckSurface className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Territory routing</h2>
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-muted-foreground">Assigned rep: {repNameQuery.data ?? "Unassigned"}</p>
            <p className="text-muted-foreground">Territory contacts: {computed.summary.contactCount}</p>
            <p className="text-muted-foreground">Open deals: {computed.summary.openDealCount}</p>
          </div>
        </DeckSurface>

        <DeckSurface className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Priority logic</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Visit priority weights open pipeline, overdue follow-up pressure, closing-soon deals, and stale touch history for accounts inside this territory.
          </p>
        </DeckSurface>
      </div>

      <DeckSurface className="p-4">
        <h2 className="text-sm font-semibold text-foreground">Visit priority</h2>
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Primary contact</TableHead>
              <TableHead className="text-right">Open deals</TableHead>
              <TableHead className="text-right">Pipeline</TableHead>
              <TableHead className="text-right">Stale</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Why now</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {computed.rows.slice(0, 20).map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium text-foreground">{row.companyName}</TableCell>
                <TableCell className="text-muted-foreground">{row.primaryContactName ?? "—"}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.openDealCount}</TableCell>
                <TableCell className="text-right text-muted-foreground">${Math.round(row.openPipelineValue).toLocaleString()}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.staleDays != null ? `${row.staleDays}d` : "—"}</TableCell>
                <TableCell className="text-right font-medium text-foreground">{row.priorityScore}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.reasons.join(" · ") || "Baseline routing only"}</TableCell>
                <TableCell className="text-right">
                  {row.companyId ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link to={buildAccountCommandHref(row.companyId)}>
                        Open account <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DeckSurface>
    </div>
  );
}
