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

type EquipmentSeed = Omit<InventoryPressureAsset, "openQuotes" | "latestEstimatedFmv">;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOwnership(value: unknown): InventoryPressureAsset["ownership"] | null {
  switch (value) {
    case "owned":
    case "leased":
    case "customer_owned":
    case "rental_fleet":
    case "consignment":
      return value;
    default:
      return null;
  }
}

function normalizeAvailability(value: unknown): InventoryPressureAsset["availability"] | null {
  switch (value) {
    case "available":
    case "rented":
    case "sold":
    case "in_service":
    case "in_transit":
    case "reserved":
    case "decommissioned":
      return value;
    default:
      return null;
  }
}

function normalizeCondition(value: unknown): InventoryPressureAsset["condition"] {
  switch (value) {
    case "new":
    case "excellent":
    case "good":
    case "fair":
    case "poor":
    case "salvage":
      return value;
    default:
      return null;
  }
}

function normalizePhotoUrls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeEquipmentRows(rows: unknown): EquipmentSeed[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    const ownership = normalizeOwnership(row.ownership);
    const availability = normalizeAvailability(row.availability);
    if (!ownership || !availability) return [];

    return [{
      id: row.id,
      name: requiredString(row.name, "Unnamed equipment"),
      make: nullableString(row.make),
      model: nullableString(row.model),
      year: nullableNumber(row.year),
      ownership,
      availability,
      condition: normalizeCondition(row.condition),
      createdAt: requiredString(row.created_at, new Date(0).toISOString()),
      currentMarketValue: nullableNumber(row.current_market_value),
      replacementCost: nullableNumber(row.replacement_cost),
      photoUrls: normalizePhotoUrls(row.photo_urls),
    }];
  });
}

function normalizeDealIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return [...new Set(rows.flatMap((row) => (
    isRecord(row) && typeof row.deal_id === "string" ? [row.deal_id] : []
  )))];
}

function normalizeLinkedEquipmentIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => (
    isRecord(row) && typeof row.equipment_id === "string" ? [row.equipment_id] : []
  ));
}

function normalizeValuationRows(rows: unknown): ValuationRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.make !== "string" || typeof row.model !== "string") return [];
    if (typeof row.year !== "number" || !Number.isFinite(row.year)) return [];

    return [{
      make: row.make,
      model: row.model,
      year: row.year,
      estimated_fmv: nullableNumber(row.estimated_fmv),
      created_at: requiredString(row.created_at, new Date(0).toISOString()),
    }];
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export function InventoryPressureBoardPage() {
  const [equipmentQuery, quoteQuery, valuationQuery] = useQueries({
    queries: [
      {
        queryKey: ["inventory-pressure", "equipment"],
        queryFn: async (): Promise<EquipmentSeed[]> => {
          const { data, error } = await supabase
            .from("crm_equipment")
            .select(
              "id, name, make, model, year, ownership, availability, condition, created_at, current_market_value, replacement_cost, photo_urls",
            )
            .is("deleted_at", null)
            .limit(500);
          if (error) throw new Error(error.message);
          return normalizeEquipmentRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["inventory-pressure", "quotes"],
        queryFn: async (): Promise<QuoteRow[]> => {
          // crm_deal_equipment has no direct FK to quote_packages — the only
          // path goes crm_deal_equipment.deal_id → qrm_deals.id → quote_packages.deal_id.
          // PostgREST can't traverse that transitively, so we do two sequential
          // queries: fetch open quotes (deal_ids), then fetch equipment links.
          const { data: openQuotes, error: qpErr } = await supabase
            .from("quote_packages")
            .select("deal_id")
            .in("status", ["draft", "sent", "negotiating"])
            .not("deal_id", "is", null)
            .limit(1000);
          if (qpErr) throw new Error(qpErr.message);

          const dealIds = normalizeDealIds(openQuotes);
          if (dealIds.length === 0) return [];

          const { data: links, error: linkErr } = await supabase
            .from("crm_deal_equipment")
            .select("equipment_id, deal_id")
            .in("deal_id", dealIds)
            .limit(2000);
          if (linkErr) throw new Error(linkErr.message);

          const counts = new Map<string, number>();
          for (const equipmentId of normalizeLinkedEquipmentIds(links)) {
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
          return normalizeValuationRows(data);
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

    const assets: InventoryPressureAsset[] = (equipmentQuery.data ?? []).map((asset) => ({
      ...asset,
      openQuotes: openQuotesByEquipment.get(asset.id) ?? 0,
      latestEstimatedFmv:
        asset.make && asset.model && asset.year
          ? latestValuationByKey.get(`${asset.make}:${asset.model}:${asset.year}`) ?? null
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
  const equipmentCount = equipmentQuery.data?.length ?? 0;

  const ironHeadline = (() => {
    if (isError) {
      return "Inventory pressure stream offline — one of the feeder queries failed. Check the console for the failing table; the board recovers as soon as the feed returns.";
    }
    if (equipmentCount === 0) {
      return "No equipment loaded. Add inventory to the graph to start surfacing pressure signals.";
    }
    if (totalFlagged === 0) {
      return `${equipmentCount} units tracked, all inside motion tolerance. No pressure to route.`;
    }
    const lanes = [
      { id: "hot", count: board.hot.length, label: "hot with quote activity", move: "close the deals on the front line" },
      { id: "aged", count: board.aged.length, label: "aged past 90 days", move: "run the markdown pass" },
      { id: "under", count: board.underMarketed.length, label: "under-merchandised", move: "get photos and pricing on file" },
      { id: "price", count: board.priceMisaligned.length, label: "price-misaligned vs FMV", move: "re-price against the latest valuation" },
    ]
      .filter((l) => l.count > 0)
      .sort((a, b) => b.count - a.count);
    const top = lanes[0];
    const tail =
      lanes.length > 1
        ? ` ${lanes.slice(1).map((l) => `${l.count} ${l.id}`).join(" · ")}.`
        : "";
    return `${top.count} unit${top.count === 1 ? "" : "s"} ${top.label} — biggest lever today is to ${top.move}.${tail}`;
  })();

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
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-qep-hot">
              Signal offline
            </p>
            <p className="mt-1 text-sm text-foreground/90">
              One of the feeder queries failed. The board will recover automatically once the feed
              returns.
            </p>
            <div className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {equipmentQuery.isError && (
                <p>
                  <span className="text-qep-hot">equipment</span> →{" "}
                  {errorMessage(equipmentQuery.error)}
                </p>
              )}
              {quoteQuery.isError && (
                <p>
                  <span className="text-qep-hot">quotes</span> →{" "}
                  {errorMessage(quoteQuery.error)}
                </p>
              )}
              {valuationQuery.isError && (
                <p>
                  <span className="text-qep-hot">valuations</span> →{" "}
                  {errorMessage(valuationQuery.error)}
                </p>
              )}
            </div>
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
