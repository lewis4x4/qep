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
 * Data comes from the floor_pulse_kpis RPC (m804) — server-side sums
 * over customer_invoices, service_jobs, service_tat_metrics,
 * rental_contracts, qrm_deals, parts_inventory/parts_catalog.
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

/**
 * N7.1: one floor_pulse_kpis RPC replaces the 7 whole-table pulls this
 * widget used to fire (deals/invoices/inventory/TAT/rentals summed in JS).
 * The RPC is role-gated server-side (admin/manager/owner) and returns a
 * single row of scalars shared with ExecRevenuePace.
 */
async function fetchBuPulse(): Promise<BuPulseData> {
  const { data, error } = await supabase.rpc("floor_pulse_kpis");
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Pulse KPIs unavailable for this role.");
  return {
    equipment_mtd: Number(row.equipment_mtd ?? 0),
    equipment_pipeline_count: Number(row.equipment_pipeline_count ?? 0),
    parts_mtd: Number(row.parts_mtd ?? 0),
    parts_stockouts: Number(row.parts_stockouts ?? 0),
    service_mtd: Number(row.service_mtd ?? 0),
    service_sla_pct: Number(row.service_sla_pct ?? 0),
    rentals_active: Number(row.rentals_active ?? 0),
    rentals_monthly_rate: Number(row.rentals_monthly_rate ?? 0),
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

type EquipmentTileCopy = {
  primary: string;
  secondary: string;
};

function pipelineDealLabel(count: number): string {
  return `${count} pipeline ${count === 1 ? "deal" : "deals"}`;
}

function getEquipmentTileCopy(data: Pick<BuPulseData, "equipment_mtd" | "equipment_pipeline_count">): EquipmentTileCopy {
  if (data.equipment_mtd > 0) {
    return {
      primary: currency(data.equipment_mtd),
      secondary: pipelineDealLabel(data.equipment_pipeline_count),
    };
  }

  if (data.equipment_pipeline_count > 0) {
    return {
      primary: pipelineDealLabel(data.equipment_pipeline_count),
      secondary: "No booked revenue MTD",
    };
  }

  return {
    primary: "No active pipeline",
    secondary: "No booked revenue MTD",
  };
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

  const equipmentCopy = query.data ? getEquipmentTileCopy(query.data) : null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#121927] p-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#f6a53a]" title="Business Unit Pulse">
          Business Unit Pulse
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
          Loading cross-business-unit pulse…
        </div>
      ) : null}

      {query.isError ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Couldn't load business unit pulse.</span>
        </div>
      ) : null}

      {!query.isLoading && !query.isError && query.data && equipmentCopy ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            icon={TrendingUp}
            label="Equipment"
            primary={equipmentCopy.primary}
            secondary={equipmentCopy.secondary}
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
