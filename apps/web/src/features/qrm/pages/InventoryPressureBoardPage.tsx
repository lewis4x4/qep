import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CameraOff,
  Clock,
  DollarSign,
  Flame,
  Tag,
  Zap,
} from "lucide-react";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  DeckSurface,
  SignalChip,
  StatusDot,
  type StatusTone,
} from "../components/command-deck";
import {
  buildInventoryPressureBoard,
  type InventoryPressureAsset,
  type InventoryPressureBucketItem,
} from "../lib/inventory-pressure";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface EquipmentRow {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  ownership: InventoryPressureAsset["ownership"];
  availability: InventoryPressureAsset["availability"];
  condition: InventoryPressureAsset["condition"];
  created_at: string;
  current_market_value: number | null;
  replacement_cost: number | null;
  photo_urls: string[] | null;
}

interface QuoteRow {
  equipment_id: string;
  open_quotes: number;
}

interface ValuationRow {
  make: string;
  model: string;
  year: number;
  estimated_fmv: number | null;
  created_at: string;
}

type LaneId = "aged" | "hot" | "under" | "price";

interface LaneDef {
  id: LaneId;
  title: string;
  code: string;
  description: string;
  tone: StatusTone;
  icon: React.ComponentType<{ className?: string }>;
}

const LANES: Record<LaneId, LaneDef> = {
  aged: {
    id: "aged",
    title: "Aged units",
    code: "01 · AGED",
    description: "Over 90 days and still in motion.",
    tone: "warm",
    icon: Clock,
  },
  hot: {
    id: "hot",
    title: "Hot units",
    code: "02 · HOT",
    description: "Active quote or reserved pressure.",
    tone: "hot",
    icon: Flame,
  },
  under: {
    id: "under",
    title: "Under-marketed",
    code: "03 · UNDER-MKT",
    description: "Missing photos, price, or merchandising.",
    tone: "active",
    icon: CameraOff,
  },
  price: {
    id: "price",
    title: "Price-misaligned",
    code: "04 · PRICE",
    description: "Ask drifts from latest FMV.",
    tone: "live",
    icon: AlertTriangle,
  },
};

/**
 * Pick the primary AI-style "next move" for a unit, based on its pressure
 * reasons. This is the drafted-move line that turns each card from a static
 * record into a decision surface.
 */
function draftedMove(item: InventoryPressureBucketItem): string {
  const reasons = item.pressureReasons.map((r) => r.toLowerCase());
  if (reasons.some((r) => r.includes("photo"))) return "Re-shoot + publish";
  if (reasons.some((r) => r.includes("price") || r.includes("fmv"))) return "Re-price vs FMV";
  if (reasons.some((r) => r.includes("quote"))) return "Accelerate close";
  if (reasons.some((r) => r.includes("aged") || r.includes("90"))) return "Run markdown";
  if (reasons.some((r) => r.includes("reserved"))) return "Re-engage buyer";
  return "Review unit";
}

function fmt$(value: number | null | undefined): string {
  if (value == null) return "—";
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value.toLocaleString()}`;
}

function ageDays(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null;
  const d = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  return Number.isFinite(d) ? d : null;
}

export function InventoryPressureBoardPage() {
  const [equipmentQuery, quoteQuery, valuationQuery] = useQueries({
    queries: [
      {
        queryKey: ["inventory-pressure", "equipment"],
        queryFn: async (): Promise<EquipmentRow[]> => {
          const { data, error } = await supabase
            .from("crm_equipment")
            .select(
              "id, name, make, model, year, ownership, availability, condition, created_at, current_market_value, replacement_cost, photo_urls",
            )
            .is("deleted_at", null)
            .limit(500);
          if (error) throw new Error(error.message);
          return (data ?? []) as EquipmentRow[];
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["inventory-pressure", "quotes"],
        queryFn: async (): Promise<QuoteRow[]> => {
          const { data, error } = await supabase
            .from("crm_deal_equipment")
            .select("equipment_id, quote_packages!inner(status)")
            .limit(1000);
          if (error) throw new Error(error.message);
          const counts = new Map<string, number>();
          for (const row of data ?? []) {
            const equipmentId = (row as { equipment_id?: string }).equipment_id;
            const quoteJoin = (
              row as { quote_packages?: Array<{ status: string }> | { status: string } | null }
            ).quote_packages;
            const status = Array.isArray(quoteJoin) ? quoteJoin[0]?.status : quoteJoin?.status;
            if (!equipmentId || !status || !["draft", "sent", "negotiating"].includes(status))
              continue;
            counts.set(equipmentId, (counts.get(equipmentId) ?? 0) + 1);
          }
          return [...counts.entries()].map(([equipment_id, open_quotes]) => ({
            equipment_id,
            open_quotes,
          }));
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["inventory-pressure", "valuations"],
        queryFn: async (): Promise<ValuationRow[]> => {
          const { data, error } = await supabase
            .from("market_valuations")
            .select("make, model, year, estimated_fmv, created_at")
            .order("created_at", { ascending: false })
            .limit(500);
          if (error) throw new Error(error.message);
          return (data ?? []) as ValuationRow[];
        },
        staleTime: 60_000,
      },
    ],
  });

  const board = useMemo(() => {
    const openQuotesByEquipment = new Map(
      (quoteQuery.data ?? []).map((row) => [row.equipment_id, row.open_quotes]),
    );
    const latestValuationByKey = new Map<string, number | null>();
    for (const row of valuationQuery.data ?? []) {
      const key = `${row.make}:${row.model}:${row.year}`;
      if (!latestValuationByKey.has(key)) {
        latestValuationByKey.set(key, row.estimated_fmv);
      }
    }

    const assets: InventoryPressureAsset[] = (equipmentQuery.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      make: row.make,
      model: row.model,
      year: row.year,
      ownership: row.ownership,
      availability: row.availability,
      condition: row.condition,
      createdAt: row.created_at,
      currentMarketValue: row.current_market_value,
      replacementCost: row.replacement_cost,
      photoUrls: row.photo_urls ?? [],
      openQuotes: openQuotesByEquipment.get(row.id) ?? 0,
      latestEstimatedFmv:
        row.make && row.model && row.year
          ? latestValuationByKey.get(`${row.make}:${row.model}:${row.year}`) ?? null
          : null,
    }));

    return buildInventoryPressureBoard(assets);
  }, [equipmentQuery.data, quoteQuery.data, valuationQuery.data]);

  const isLoading = equipmentQuery.isLoading || quoteQuery.isLoading || valuationQuery.isLoading;
  const isError = equipmentQuery.isError || quoteQuery.isError || valuationQuery.isError;

  const totalFlagged =
    board.aged.length +
    board.hot.length +
    board.underMarketed.length +
    board.priceMisaligned.length;

  const ironHeadline = isError
    ? "Inventory pressure stream offline — last-known state unavailable. Surface recovers automatically when the graph reconnects."
    : totalFlagged === 0
      ? "No pressure detected across the fleet. All units within motion tolerance."
      : `${totalFlagged} unit${totalFlagged === 1 ? "" : "s"} under pressure — ${board.hot.length} hot, ${board.aged.length} aged, ${board.underMarketed.length} under-marketed, ${board.priceMisaligned.length} price-misaligned.`;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Inventory Pressure"
        subtitle="Aged, hot, under-marketed, and price-misaligned units — scanned from the live inventory graph."
        crumb={{ surface: "GRAPH", lens: "INVENTORY", count: totalFlagged }}
        metrics={[
          {
            label: "Flagged",
            value: totalFlagged,
            tone: totalFlagged > 0 ? "hot" : undefined,
          },
          { label: "Hot", value: board.hot.length, tone: "hot" },
          { label: "Aged", value: board.aged.length, tone: "warm" },
          { label: "Under-mkt", value: board.underMarketed.length, tone: "active" },
          { label: "Price-mis", value: board.priceMisaligned.length, tone: "live" },
        ]}
        ironBriefing={{
          headline: ironHeadline,
          actions:
            totalFlagged > 0
              ? [{ label: "Draft moves →", href: "/qrm/operations-copilot" }]
              : undefined,
        }}
      />
      <QrmSubNav />

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <DeckSurface key={i} className="h-[420px] animate-pulse bg-qep-deck-elevated/40">
              <span className="sr-only">Loading lane…</span>
            </DeckSurface>
          ))}
        </div>
      ) : isError ? (
        <DeckSurface className="flex items-start gap-3 border-qep-hot/40 bg-qep-hot/5 p-5">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-qep-hot" />
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-qep-hot">
              Signal offline
            </p>
            <p className="mt-1 text-sm text-foreground/90">
              Inventory pressure stream is unavailable right now. The surface will recover
              automatically when the graph reconnects — no action needed.
            </p>
          </div>
        </DeckSurface>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PressureLane lane={LANES.aged} items={board.aged} />
          <PressureLane lane={LANES.hot} items={board.hot} />
          <PressureLane lane={LANES.under} items={board.underMarketed} />
          <PressureLane lane={LANES.price} items={board.priceMisaligned} />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  PressureLane — one column in the 4-lane pressure board                      */
/* -------------------------------------------------------------------------- */

function PressureLane({ lane, items }: { lane: LaneDef; items: InventoryPressureBucketItem[] }) {
  const Icon = lane.icon;
  const hasItems = items.length > 0;

  return (
    <DeckSurface
      tone={hasItems && lane.tone === "live" ? "live" : "default"}
      className="flex min-h-[420px] flex-col overflow-hidden"
    >
      {/* Lane header */}
      <div className="flex items-start justify-between gap-2 border-b border-qep-deck-rule/60 bg-qep-deck-elevated/60 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border",
              lane.tone === "hot"
                ? "border-qep-hot/40 bg-qep-hot/10 text-qep-hot"
                : lane.tone === "warm"
                  ? "border-qep-warm/40 bg-qep-warm/10 text-qep-warm"
                  : lane.tone === "active"
                    ? "border-qep-orange/40 bg-qep-orange/10 text-qep-orange"
                    : lane.tone === "live"
                      ? "border-qep-live/40 bg-qep-live/10 text-qep-live"
                      : "border-qep-deck-rule bg-muted/30 text-muted-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {lane.code}
            </p>
            <h2 className="text-[13px] font-semibold leading-tight text-foreground">
              {lane.title}
            </h2>
            <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
              {lane.description}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex min-w-[2rem] items-center justify-center rounded-sm border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
            hasItems
              ? lane.tone === "hot"
                ? "border-qep-hot/40 bg-qep-hot/10 text-qep-hot"
                : lane.tone === "warm"
                  ? "border-qep-warm/40 bg-qep-warm/10 text-qep-warm"
                  : lane.tone === "active"
                    ? "border-qep-orange/40 bg-qep-orange/10 text-qep-orange"
                    : "border-qep-live/40 bg-qep-live/10 text-qep-live"
              : "border-qep-deck-rule text-muted-foreground/60",
          )}
        >
          {items.length}
        </span>
      </div>

      {/* Lane body */}
      <div className="flex-1 overflow-y-auto p-2">
        {!hasItems ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <StatusDot tone="cool" />
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              no units in this lane
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {items.slice(0, 12).map((item) => (
              <PressureCard key={item.id} item={item} tone={lane.tone} />
            ))}
            {items.length > 12 && (
              <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                +{items.length - 12} more
              </p>
            )}
          </div>
        )}
      </div>
    </DeckSurface>
  );
}

/* -------------------------------------------------------------------------- */
/*  PressureCard — one unit card inside a lane                                  */
/* -------------------------------------------------------------------------- */

function PressureCard({
  item,
  tone,
}: {
  item: InventoryPressureBucketItem;
  tone: StatusTone;
}) {
  const age = ageDays(item.createdAt);
  const code = [item.year, item.make, item.model].filter(Boolean).join(" · ") || item.name;
  const move = draftedMove(item);
  const ask = item.currentMarketValue;
  const fmv = item.latestEstimatedFmv;
  const delta = ask != null && fmv != null ? ask - fmv : null;
  const deltaPct = delta != null && fmv ? Math.round((delta / fmv) * 100) : null;

  return (
    <Link
      to={`/equipment/${item.id}`}
      className="group block rounded-sm border border-qep-deck-rule/50 bg-qep-deck-elevated/30 p-2.5 transition-all hover:border-qep-orange/50 hover:bg-qep-orange/[0.04]"
    >
      {/* Line 1 — mono code + age + open quotes */}
      <div className="flex items-center gap-2 text-[10.5px]">
        <StatusDot tone={tone} pulse={tone === "hot" && item.openQuotes > 0} />
        <span className="font-mono font-semibold uppercase tracking-[0.08em] text-foreground/90">
          {code}
        </span>
        <span className="flex-1" />
        {item.openQuotes > 0 && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-qep-orange">
            <Tag className="h-2.5 w-2.5" />
            {item.openQuotes}q
          </span>
        )}
        {age != null && (
          <span className="font-mono tabular-nums text-muted-foreground">{age}d</span>
        )}
      </div>

      {/* Line 2 — name */}
      <p className="mt-1 truncate text-[13px] font-medium text-foreground">{item.name}</p>

      {/* Line 3 — FMV / Ask delta */}
      {(ask != null || fmv != null) && (
        <div className="mt-1.5 flex items-center gap-2 font-mono text-[10.5px] tabular-nums">
          <span className="text-muted-foreground">
            Ask <span className="text-foreground/90">{fmt$(ask)}</span>
          </span>
          <span className="text-qep-deck-rule">·</span>
          <span className="text-muted-foreground">
            FMV <span className="text-foreground/90">{fmt$(fmv)}</span>
          </span>
          {deltaPct != null && Math.abs(deltaPct) > 1 && (
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-0.5 rounded-sm px-1",
                deltaPct > 0 ? "bg-qep-hot/10 text-qep-hot" : "bg-success/10 text-success",
              )}
            >
              <DollarSign className="h-2.5 w-2.5" />
              {deltaPct > 0 ? "+" : ""}
              {deltaPct}%
            </span>
          )}
        </div>
      )}

      {/* Line 4 — diagnostic chips */}
      {item.pressureReasons.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.pressureReasons.slice(0, 3).map((reason) => (
            <SignalChip key={reason} label={reason} tone={tone} />
          ))}
        </div>
      )}

      {/* Line 5 — drafted move */}
      <div className="mt-2 flex items-center justify-between border-t border-qep-deck-rule/40 pt-1.5">
        <span className="font-mono text-[10px] text-qep-live">
          <span className="mr-1 text-muted-foreground">next →</span>
          {move}
        </span>
        <ArrowRight className="h-3 w-3 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-qep-orange" />
      </div>
    </Link>
  );
}
