/**
 * BuPulseStrip — four-tile at-a-glance strip for the Owner home.
 *
 * Each tile represents one of QEP's four business units and reports
 * one primary + one secondary signal. Real data only; no placeholders.
 *
 *   Equipment:  MTD booked $, pipeline count
 *   Parts:      MTD invoice $, stockout count
 *   Service:    MTD invoice $, % on SLA
 *   Rentals:    active contract count, monthly run-rate $
 *
 * Queries pull from the already-seeded tables (customer_invoices,
 * service_jobs, service_tat_metrics, rental_contracts, qrm_deals,
 * parts_inventory, parts_catalog). Backed by migration 389+390.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Package,
  TrendingUp,
  Truck,
  Wrench,
  Loader2,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const CLOSED_WON_STAGE_NAMES = [
  "Invoice Closed",
  "Post-Sale Follow-Up",
  "Sales Order Signed",
  "Deposit Collected",
];

interface BuPulseData {
  equipment_mtd: number;
  equipment_pipeline_count: number;
  parts_mtd: number;
  parts_stockouts: number;
  service_mtd: number;
  service_sla_pct: number;
  rentals_active: number;
  rentals_monthly_rate: number;
}

async function fetchBuPulse(): Promise<BuPulseData> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartISO = monthStart.toISOString();

  // Resolve closed-won stage IDs once.
  const { data: stages, error: stagesError } = await supabase
    .from("qrm_deal_stages")
    .select("id, name")
    .in("name", CLOSED_WON_STAGE_NAMES);
  if (stagesError) throw new Error(stagesError.message);
  const closedWonIds = (stages ?? []).map((s) => s.id);

  const safeClosedWon = closedWonIds.length ? closedWonIds : ["00000000-0000-0000-0000-000000000000"];

  // Fire all queries in parallel.
  const [
    equipmentMtdRes,
    equipmentPipelineRes,
    partsMtdRes,
    partsInventoryRes,
    serviceMtdRes,
    serviceTatRes,
    rentalsRes,
  ] = await Promise.all([
    supabase
      .from("qrm_deals")
      .select("amount")
      .in("stage_id", safeClosedWon)
      .gte("closed_at", monthStartISO)
      .is("deleted_at", null),
    supabase
      .from("qrm_deals")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .is("closed_at", null),
    supabase
      .from("customer_invoices")
      .select("total")
      .not("parts_order_id", "is", null)
      .gte("created_at", monthStartISO),
    supabase
      .from("parts_inventory")
      .select("qty_on_hand, catalog:parts_catalog!parts_inventory_catalog_id_fkey ( reorder_point )")
      .is("deleted_at", null),
    supabase
      .from("service_jobs")
      .select("invoice_total")
      .gte("closed_at", monthStartISO)
      .is("deleted_at", null),
    supabase
      .from("service_tat_metrics")
      .select("target_duration_hours, actual_duration_hours"),
    supabase
      .from("rental_contracts")
      .select("status, agreed_monthly_rate")
      .eq("status", "active"),
  ]);

  // Equipment MTD
  if (equipmentMtdRes.error) throw new Error(equipmentMtdRes.error.message);
  const equipment_mtd = (equipmentMtdRes.data ?? []).reduce(
    (sum: number, row: { amount: number | null }) => sum + Number(row.amount ?? 0),
    0,
  );

  // Equipment pipeline count
  if (equipmentPipelineRes.error) throw new Error(equipmentPipelineRes.error.message);
  const equipment_pipeline_count = equipmentPipelineRes.count ?? 0;

  // Parts MTD
  if (partsMtdRes.error) throw new Error(partsMtdRes.error.message);
  const parts_mtd = (partsMtdRes.data ?? []).reduce(
    (sum: number, row: { total: number | null }) => sum + Number(row.total ?? 0),
    0,
  );

  // Parts stockouts — client-side filter on the joined inventory rows
  if (partsInventoryRes.error) throw new Error(partsInventoryRes.error.message);
  const parts_stockouts = (partsInventoryRes.data ?? []).filter((row: unknown) => {
    const r = row as {
      qty_on_hand: number;
      catalog:
        | { reorder_point: number | null }
        | { reorder_point: number | null }[]
        | null;
    };
    const cat = Array.isArray(r.catalog) ? r.catalog[0] : r.catalog;
    const reorder = Number(cat?.reorder_point ?? 0);
    return Number(r.qty_on_hand) < reorder;
  }).length;

  // Service MTD
  if (serviceMtdRes.error) throw new Error(serviceMtdRes.error.message);
  const service_mtd = (serviceMtdRes.data ?? []).reduce(
    (sum: number, row: { invoice_total: number | null }) => sum + Number(row.invoice_total ?? 0),
    0,
  );

  // Service SLA percentage
  if (serviceTatRes.error) throw new Error(serviceTatRes.error.message);
  const tatRows = (serviceTatRes.data ?? []) as Array<{
    target_duration_hours: number | null;
    actual_duration_hours: number | null;
  }>;
  const service_sla_pct =
    tatRows.length === 0
      ? 0
      : Math.round(
          (100 *
            tatRows.filter(
              (r) =>
                (r.actual_duration_hours ?? Infinity) <= (r.target_duration_hours ?? 0),
            ).length) /
            tatRows.length,
        );

  // Rentals
  if (rentalsRes.error) throw new Error(rentalsRes.error.message);
  const activeRentals = (rentalsRes.data ?? []) as Array<{ agreed_monthly_rate: number | null }>;
  const rentals_active = activeRentals.length;
  const rentals_monthly_rate = activeRentals.reduce(
    (sum, row) => sum + Number(row.agreed_monthly_rate ?? 0),
    0,
  );

  return {
    equipment_mtd,
    equipment_pipeline_count,
    parts_mtd,
    parts_stockouts,
    service_mtd,
    service_sla_pct,
    rentals_active,
    rentals_monthly_rate,
  };
}

function currency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function currencyK(n: number): string {
  return `$${(n / 1_000).toFixed(1)}K`;
}

interface TileProps {
  icon: LucideIcon;
  label: string;
  primary: string;
  secondary: string;
}

function Tile({ icon: Icon, label, primary, secondary }: TileProps) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-[#f28a07]/30">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f28a07]/10 text-[#f6a53a]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <p className="mt-0.5 whitespace-nowrap text-lg font-semibold tabular-nums leading-tight text-white">
          {primary}
        </p>
        <p className="whitespace-nowrap text-[11px] leading-tight text-slate-400">{secondary}</p>
      </div>
    </div>
  );
}

export function BuPulseStripWidget() {
  const query = useQuery({
    queryKey: ["floor", "owner", "bu-pulse"],
    queryFn: fetchBuPulse,
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="rounded-xl border border-white/10 bg-[#121927] p-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#f6a53a]">
          BU Pulse
        </p>
        <Link
          to="/executive"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-[#f28a07]"
        >
          Executive view
        </Link>
      </div>

      {query.isLoading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading cross-BU pulse…
        </div>
      ) : null}

      {query.isError ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Couldn't load business unit pulse.</span>
        </div>
      ) : null}

      {!query.isLoading && !query.isError && query.data ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            icon={TrendingUp}
            label="Equipment"
            primary={currency(query.data.equipment_mtd)}
            secondary={`${query.data.equipment_pipeline_count} in pipeline`}
          />
          <Tile
            icon={Package}
            label="Parts"
            primary={currency(query.data.parts_mtd)}
            secondary={`${query.data.parts_stockouts} below reorder`}
          />
          <Tile
            icon={Wrench}
            label="Service"
            primary={currency(query.data.service_mtd)}
            secondary={`${query.data.service_sla_pct}% on SLA`}
          />
          <Tile
            icon={Truck}
            label="Rentals"
            primary={`${query.data.rentals_active} on rent`}
            secondary={`${currencyK(query.data.rentals_monthly_rate)}/mo run rate`}
          />
        </div>
      ) : null}
    </div>
  );
}
