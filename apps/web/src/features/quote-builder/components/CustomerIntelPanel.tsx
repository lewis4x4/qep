/**
 * CustomerIntelPanel — Slice 20a.
 *
 * Rendered on the Quote Builder Customer step once a customer is
 * selected. Surfaces the signals already collected by the CustomerPicker
 * search (warmth, open deals, past quote value, last-contact age) plus
 * a freshly-fetched top-5 past equipment fleet so the rep knows what
 * this customer has bought / quoted before they pick equipment.
 *
 * This is the first surface of the Customer Digital Twin vision (Move 4
 * in the moonshot roadmap). Deliberately lightweight: everything shown
 * here comes from data we already have — no new tables, no agents.
 * Later slices layer on credit tier, preferred finance products, site
 * type inference, and counterfactual win probability.
 */

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Flame,
  Snowflake,
  Sparkles,
  DollarSign,
  History,
  Wrench,
  Clock,
} from "lucide-react";
import {
  fetchCustomerPastEquipment,
  type CompanySignals,
  type CustomerWarmth,
} from "../lib/customer-search-api";

export interface CustomerIntelPanelProps {
  customerCompany: string;
  companyId: string | null;
  signals: CompanySignals | null;
  warmth: CustomerWarmth | null;
}

export function CustomerIntelPanel({
  customerCompany,
  companyId,
  signals,
  warmth,
}: CustomerIntelPanelProps) {
  const pastEquipmentQuery = useQuery({
    queryKey: ["quote-builder", "past-equipment", customerCompany || companyId],
    queryFn: () => fetchCustomerPastEquipment(customerCompany),
    enabled: customerCompany.trim().length > 0,
    staleTime: 60_000,
  });

  // Nothing useful to show for a brand-new customer with no CRM match.
  if (!signals && !customerCompany.trim()) return null;

  const s = signals ?? {
    openDeals: 0,
    openDealValueCents: 0,
    lastContactDaysAgo: null,
    pastQuoteCount: 0,
    pastQuoteValueCents: 0,
  };

  const pastEquipment = pastEquipmentQuery.data ?? [];

  return (
    <Card className="border-qep-orange/20 bg-qep-orange/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-qep-orange" />
          <p className="text-xs font-bold uppercase tracking-wider text-qep-orange">
            Customer Digital Twin
          </p>
        </div>
        <WarmthBadge warmth={warmth} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <SignalTile
          icon={History}
          label="Open deals"
          primary={s.openDeals > 0 ? String(s.openDeals) : "—"}
          secondary={s.openDealValueCents > 0 ? fmtCompactCents(s.openDealValueCents) : "none in flight"}
        />
        <SignalTile
          icon={DollarSign}
          label="Past quotes"
          primary={s.pastQuoteCount > 0 ? String(s.pastQuoteCount) : "—"}
          secondary={s.pastQuoteValueCents > 0 ? fmtCompactCents(s.pastQuoteValueCents) : "first quote"}
        />
        <SignalTile
          icon={Clock}
          label="Last touch"
          primary={
            s.lastContactDaysAgo == null
              ? "—"
              : s.lastContactDaysAgo === 0
                ? "today"
                : `${s.lastContactDaysAgo}d ago`
          }
          secondary={warmthCopy(warmth)}
        />
        <SignalTile
          icon={Wrench}
          label="Fleet history"
          primary={pastEquipment.length > 0 ? `${pastEquipment.length} model${pastEquipment.length === 1 ? "" : "s"}` : "—"}
          secondary={
            pastEquipmentQuery.isLoading
              ? "loading…"
              : pastEquipment.length > 0
                ? "pre-seeded below"
                : "no prior equipment"
          }
        />
      </div>

      {pastEquipment.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-background/60 p-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Most-quoted equipment for this customer
          </p>
          <ul className="mt-2 space-y-1.5">
            {pastEquipment.map((item) => (
              <li
                key={`${item.make}-${item.model}`}
                className="flex items-center justify-between text-sm"
              >
                <span className="truncate text-foreground">
                  {[item.make, item.model].filter(Boolean).join(" ") || "(unnamed)"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  ×{item.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SignalTile({
  icon: Icon,
  label,
  primary,
  secondary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">{primary}</p>
      <p className="text-[11px] text-muted-foreground">{secondary}</p>
    </div>
  );
}

function WarmthBadge({ warmth }: { warmth: CustomerWarmth | null }) {
  if (warmth === "warm") {
    return (
      <Badge variant="default" className="gap-1 text-[10px]">
        <Flame className="h-3 w-3" /> Warm lead
      </Badge>
    );
  }
  if (warmth === "cool") {
    return <Badge variant="secondary" className="text-[10px]">Cool</Badge>;
  }
  if (warmth === "dormant") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Snowflake className="h-3 w-3" /> Dormant
      </Badge>
    );
  }
  if (warmth === "new") {
    return <Badge variant="outline" className="text-[10px]">New relationship</Badge>;
  }
  return null;
}

function warmthCopy(warmth: CustomerWarmth | null): string {
  if (warmth === "warm") return "actively engaged";
  if (warmth === "cool") return "re-engage soon";
  if (warmth === "dormant") return "needs a warm-up";
  if (warmth === "new") return "fresh relationship";
  return "";
}

function fmtCompactCents(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000)     return `$${Math.round(dollars / 1_000)}k`;
  return `$${dollars.toLocaleString("en-US")}`;
}
