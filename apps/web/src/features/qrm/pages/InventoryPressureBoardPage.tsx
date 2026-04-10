import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Layers3, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { buildInventoryPressureBoard, type InventoryPressureAsset, type InventoryPressureBucketItem } from "../lib/inventory-pressure";
import { supabase } from "@/lib/supabase";

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

export function InventoryPressureBoardPage() {
  const [equipmentQuery, quoteQuery, valuationQuery] = useQueries({
    queries: [
      {
        queryKey: ["inventory-pressure", "equipment"],
        queryFn: async (): Promise<EquipmentRow[]> => {
          const { data, error } = await supabase
            .from("crm_equipment")
            .select("id, name, make, model, year, ownership, availability, condition, created_at, current_market_value, replacement_cost, photo_urls")
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
            const quoteJoin = (row as { quote_packages?: Array<{ status: string }> | { status: string } | null }).quote_packages;
            const status = Array.isArray(quoteJoin) ? quoteJoin[0]?.status : quoteJoin?.status;
            if (!equipmentId || !status || !["draft", "sent", "negotiating"].includes(status)) continue;
            counts.set(equipmentId, (counts.get(equipmentId) ?? 0) + 1);
          }
          return [...counts.entries()].map(([equipment_id, open_quotes]) => ({ equipment_id, open_quotes }));
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
    const openQuotesByEquipment = new Map((quoteQuery.data ?? []).map((row) => [row.equipment_id, row.open_quotes]));
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
      latestEstimatedFmv: row.make && row.model && row.year
        ? latestValuationByKey.get(`${row.make}:${row.model}:${row.year}`) ?? null
        : null,
    }));

    return buildInventoryPressureBoard(assets);
  }, [equipmentQuery.data, quoteQuery.data, valuationQuery.data]);

  const isLoading = equipmentQuery.isLoading || quoteQuery.isLoading || valuationQuery.isLoading;
  const isError = equipmentQuery.isError || quoteQuery.isError || valuationQuery.isError;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Inventory Pressure Board"
        subtitle="Aged, hot, under-marketed, and price-misaligned units from the live inventory graph."
      />
      <QrmSubNav />

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading inventory pressure…</Card>
      ) : isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          Inventory pressure is unavailable right now.
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <PressureColumn
            icon={Tag}
            title="Aged units"
            description="Inventory over 90 days old and still in available/reserved motion."
            items={board.aged}
          />
          <PressureColumn
            icon={Layers3}
            title="Hot units"
            description="Machines with active quote pressure or reserved commercial motion."
            items={board.hot}
          />
          <PressureColumn
            icon={AlertTriangle}
            title="Under-marketed"
            description="Units missing core merchandising inputs like photos or price."
            items={board.underMarketed}
          />
          <PressureColumn
            icon={AlertTriangle}
            title="Price-misaligned"
            description="Units with missing FMV or a large delta versus the latest market valuation."
            items={board.priceMisaligned}
          />
        </div>
      )}
    </div>
  );
}

function PressureColumn({
  icon: Icon,
  title,
  description,
  items,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  items: InventoryPressureBucketItem[];
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No units in this lane.</p>
        ) : (
          items.slice(0, 12).map((item) => (
            <div key={item.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[item.year, item.make, item.model].filter(Boolean).join(" ")}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">{item.pressureReasons.join(" · ")}</p>
                </div>
                <Link to={`/equipment/${item.id}`} className="text-qep-orange hover:text-qep-orange/80">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
