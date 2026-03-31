import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  MessageCircleMore,
  LayoutGrid,
  UsersRound,
  Building2,
  NotebookPen,
  GitMerge,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { crmSupabase } from "../lib/crm-supabase";
import { CrmPageHeader } from "../components/CrmPageHeader";

interface CrmHubPageProps {
  userRole: UserRole;
}

interface CrmStats {
  openDeals: number | null;
  contacts: number | null;
  companies: number | null;
  recentActivities: number | null;
}

async function fetchCrmStats(): Promise<CrmStats> {
  const [dealsResult, contactsResult, companiesResult, activitiesResult] =
    await Promise.all([
      crmSupabase
        .from("crm_deals")
        .select("id", { count: "exact", head: true })
        .is("closed_at", null),
      crmSupabase
        .from("crm_contacts")
        .select("id", { count: "exact", head: true }),
      crmSupabase
        .from("crm_companies")
        .select("id", { count: "exact", head: true }),
      crmSupabase
        .from("crm_activities")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .gte("occurred_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

  return {
    openDeals: dealsResult.error ? null : (dealsResult.count ?? null),
    contacts: contactsResult.error ? null : (contactsResult.count ?? null),
    companies: companiesResult.error ? null : (companiesResult.count ?? null),
    recentActivities: activitiesResult.error ? null : (activitiesResult.count ?? null),
  };
}

const STAT_CARDS: {
  key: keyof CrmStats;
  label: string;
  href: string;
}[] = [
  { key: "openDeals", label: "Open Deals", href: "/crm/deals" },
  { key: "contacts", label: "Contacts", href: "/crm/contacts" },
  { key: "companies", label: "Companies", href: "/crm/companies" },
  { key: "recentActivities", label: "Activities (7d)", href: "/crm/activities" },
];

interface SectionCard {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PRIMARY_SECTIONS: SectionCard[] = [
  {
    label: "Activities",
    description: "Track calls, emails, tasks, and follow-ups.",
    href: "/crm/activities",
    icon: MessageCircleMore,
  },
  {
    label: "Deals",
    description: "View pipeline, stages, and weighted revenue.",
    href: "/crm/deals",
    icon: LayoutGrid,
  },
  {
    label: "Contacts",
    description: "Manage customer contacts and relationships.",
    href: "/crm/contacts",
    icon: UsersRound,
  },
  {
    label: "Companies",
    description: "Organize accounts and company records.",
    href: "/crm/companies",
    icon: Building2,
  },
];

const ADMIN_SECTIONS: SectionCard[] = [
  {
    label: "Sequences",
    description: "Automated follow-up sequences.",
    href: "/crm/sequences",
    icon: NotebookPen,
  },
  {
    label: "Templates",
    description: "Activity and email templates.",
    href: "/crm/templates",
    icon: NotebookPen,
  },
  {
    label: "Duplicates",
    description: "Find and merge duplicate records.",
    href: "/crm/duplicates",
    icon: GitMerge,
  },
];

const ADMIN_ROLES: UserRole[] = ["admin", "manager", "owner"];

function StatCard({
  label,
  value,
  href,
  isLoading,
}: {
  label: string;
  value: number | null;
  href: string;
  isLoading: boolean;
}) {
  return (
    <Link to={href} className="group">
      <Card className="border-border bg-card px-4 py-3 transition-shadow duration-150 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-qep-orange">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {isLoading ? (
          <div className="mt-1.5 h-7 w-16 animate-pulse rounded bg-muted" />
        ) : (
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-qep-orange">
            {value ?? "—"}
          </p>
        )}
      </Card>
    </Link>
  );
}

function SectionCardItem({ section }: { section: SectionCard }) {
  return (
    <Link to={section.href} className="group">
      <Card className="flex items-center gap-4 border-border bg-card px-5 py-4 transition-shadow duration-150 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-qep-orange min-h-[72px]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-qep-orange/10">
          <section.icon className="h-5 w-5 text-qep-orange" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{section.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
            {section.description}
          </p>
        </div>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Card>
    </Link>
  );
}

export function CrmHubPage({ userRole }: CrmHubPageProps) {
  const statsQuery = useQuery({
    queryKey: ["crm", "hub-stats"],
    queryFn: fetchCrmStats,
    staleTime: 30_000,
  });

  const stats = statsQuery.data;
  const isAdmin = ADMIN_ROLES.includes(userRole);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <CrmPageHeader title="CRM" subtitle="Customer relationship management hub" />

      {/* Quick stats */}
      <section aria-label="CRM quick stats">
        {statsQuery.isError ? (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="flex-1 text-sm text-destructive">
              Could not load CRM stats.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => statsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STAT_CARDS.map((card) => (
              <StatCard
                key={card.key}
                label={card.label}
                value={stats?.[card.key] ?? null}
                href={card.href}
                isLoading={statsQuery.isLoading}
              />
            ))}
          </div>
        )}
      </section>

      {/* Primary sections */}
      <section aria-label="CRM sections">
        <div className="grid gap-3 sm:grid-cols-2">
          {PRIMARY_SECTIONS.map((section) => (
            <SectionCardItem key={section.href} section={section} />
          ))}
        </div>
      </section>

      {/* Admin tools */}
      {isAdmin && (
        <section aria-label="Admin tools">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Admin Tools
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {ADMIN_SECTIONS.map((section) => (
              <SectionCardItem key={section.href} section={section} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
