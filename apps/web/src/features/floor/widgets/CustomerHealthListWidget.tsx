/**
 * CustomerHealthListWidget — Floor widget for `nervous.customer-health`.
 *
 * Wraps the existing customer-health scoring layer (nervous-system feature)
 * into a compact top-5 at-risk list tuned for the Floor. Clicking a row
 * opens the customer's detail page in the QRM. No drawer, no modal — the
 * Floor is a surface for decisions, not deep work.
 *
 * Intentionally skips the big radial gauge the original CustomerHealthScore
 * renders — that's a single-customer detail view, and a list of 5 customers
 * each showing a gauge would overwhelm the Floor's 6-widget grid.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { CustomerHealthProfile } from "@/features/nervous-system/lib/nervous-system-api";
import type { Database, Json } from "@/lib/database.types";

const AT_RISK_LIMIT = 5;
const AT_RISK_THRESHOLD = 60;
type CustomerHealthProfileRow = Pick<
  Database["public"]["Tables"]["customer_profiles_extended"]["Row"],
  | "id"
  | "customer_name"
  | "company_name"
  | "health_score"
  | "health_score_components"
  | "health_score_updated_at"
  | "pricing_persona"
  | "lifetime_value"
>;

function scoreTone(score: number): { text: string; border: string; bg: string; label: string } {
  if (score >= 80) return { text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10", label: "Excellent" };
  if (score >= 60) return { text: "text-sky-400",    border: "border-sky-500/30",     bg: "bg-sky-500/10",     label: "Good" };
  if (score >= 40) return { text: "text-amber-400",  border: "border-amber-500/30",   bg: "bg-amber-500/10",   label: "Fair" };
  return            { text: "text-rose-400",   border: "border-rose-500/30",    bg: "bg-rose-500/10",    label: "At risk" };
}

function isRecord(value: Json | null | undefined): value is { [key: string]: Json | undefined } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeCustomerHealthProfile(row: CustomerHealthProfileRow): CustomerHealthProfile {
  const components = isRecord(row.health_score_components)
    ? {
        deal_velocity: readNumber(row.health_score_components.deal_velocity),
        service_engagement: readNumber(row.health_score_components.service_engagement),
        parts_revenue: readNumber(row.health_score_components.parts_revenue),
        financial_health: readNumber(row.health_score_components.financial_health),
      }
    : null;

  return {
    id: row.id,
    customer_name: row.customer_name,
    company_name: row.company_name,
    health_score: row.health_score,
    health_score_components: components,
    health_score_updated_at: row.health_score_updated_at,
    pricing_persona: row.pricing_persona,
    lifetime_value: row.lifetime_value,
  };
}

async function fetchAtRiskCustomers(): Promise<CustomerHealthProfile[]> {
  // Ascending order pulls lowest scores first — the list's whole point is
  // surfacing customers trending toward "at risk."
  const { data, error } = await supabase
    .from("customer_profiles_extended")
    .select(
      "id, customer_name, company_name, health_score, health_score_components, health_score_updated_at, pricing_persona, lifetime_value",
    )
    .not("health_score", "is", null)
    .order("health_score", { ascending: true })
    .limit(AT_RISK_LIMIT);
  if (error) {
    throw new Error(error.message ?? "Failed to load customer health");
  }
  return (data ?? []).map(normalizeCustomerHealthProfile);
}

async function fetchCoverage(): Promise<{
  scored: number;
  total: number;
  at_risk: number;
}> {
  const [{ count: scoredCount }, { count: totalCount }, { count: atRiskCount }] = await Promise.all([
    supabase
      .from("customer_profiles_extended")
      .select("id", { count: "exact", head: true })
      .not("health_score", "is", null),
    supabase
      .from("qrm_companies")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("customer_profiles_extended")
      .select("id", { count: "exact", head: true })
      .not("health_score", "is", null)
      .lt("health_score", AT_RISK_THRESHOLD),
  ]);
  return {
    scored: scoredCount ?? 0,
    total: totalCount ?? 0,
    at_risk: atRiskCount ?? 0,
  };
}

export function CustomerHealthListWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["floor", "customer-health-at-risk"],
    queryFn: fetchAtRiskCustomers,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const coverage = useQuery({
    queryKey: ["floor", "customer-health-coverage"],
    queryFn: fetchCoverage,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const coverageLine = (() => {
    if (!coverage.data) return null;
    const { scored, total, at_risk } = coverage.data;
    const ratio = total > 0 ? scored / total : 0;
    const base = `${scored} of ${total} customers scored · ${at_risk} at risk`;
    if (ratio >= 0.8 && at_risk === 0) return `${base} — Good shape.`;
    return `${base} — backfill pending`;
  })();

  return (
    <div
      role="figure"
      aria-label="Customer health — top 5 at risk"
      className="floor-widget-in relative flex h-full min-h-[200px] flex-col overflow-hidden rounded-xl border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-all duration-150 ease-out hover:border-[hsl(var(--qep-orange))]/40 hover:translate-y-[-1px]"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px] bg-[hsl(var(--qep-orange))]/60"
      />
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-[hsl(var(--qep-gray))]" aria-hidden="true" />
          <h3 className="font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-gray))]">
            Customer health
          </h3>
        </div>
        <Link
          to="/nervous-system"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-[hsl(var(--qep-orange))]"
        >
          Open
        </Link>
      </div>

      {/* Body */}
      <div className="mt-3 flex-1">
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}

        {isError && (
          <p className="text-xs text-rose-300">Couldn't load customer health right now.</p>
        )}

        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-center">
            <ShieldCheck className="h-5 w-5 text-emerald-400/70" aria-hidden="true" />
            <p className="text-xs font-semibold text-foreground">No scored customers</p>
            <p className="text-[11px] text-muted-foreground">
              Health scoring hasn't run yet. Check back after the nightly refresh.
            </p>
          </div>
        )}

        {!isLoading && !isError && (data?.length ?? 0) > 0 && (
          <>
            {coverageLine ? (
              <p className="mb-2 text-[11px] text-muted-foreground">{coverageLine}</p>
            ) : null}
            <ul className="space-y-1.5">
              {data!.map((row) => {
                const score = row.health_score ?? 0;
                const tone = scoreTone(score);
                const name = row.customer_name || row.company_name || "Unnamed";
                return (
                  <li key={row.id}>
                    <Link
                      to={`/qrm/companies/${row.id}`}
                      className="group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-[hsl(var(--qep-deck-rule))] hover:bg-[hsl(var(--qep-deck))]"
                    >
                      <span
                        className={`flex h-8 w-10 shrink-0 items-center justify-center rounded-md border font-kpi text-xs font-extrabold tabular-nums ${tone.border} ${tone.bg} ${tone.text}`}
                        aria-label={`Score ${score}, ${tone.label}`}
                      >
                        {score}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {name}
                      </span>
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
