import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { EmptyState, RetryState, RowSkeleton } from "../components/command-deck";
import { fetchAllEquipment } from "../lib/qrm-router-api";
import type { QrmEquipment } from "../lib/types";

type AvailabilityFilter = "all" | "available" | "rented" | "sold";

function availabilityTone(availability: string): string {
  switch (availability) {
    case "available":
      return "text-emerald-400 border-emerald-400/40";
    case "rented":
    case "reserved":
      return "text-amber-400 border-amber-400/40";
    case "sold":
    case "invoiced":
      return "text-sky-400 border-sky-400/40";
    default:
      return "text-muted-foreground border-border/70";
  }
}

function matchesSearch(unit: QrmEquipment, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    unit.name,
    unit.serialNumber,
    unit.stockNumber,
    unit.make,
    unit.model,
    unit.assetTag,
    unit.vinPin,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * N6.1: workspace-wide equipment list on the existing qrm-router
 * `GET /qrm/equipment` contract. Floor "All machines" links land here
 * (they previously pointed at the /fleet map as a 404 stopgap).
 */
export function QrmEquipmentListPage() {
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");

  const equipmentQuery = useQuery({
    queryKey: ["qrm", "equipment", "all"],
    queryFn: fetchAllEquipment,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (equipmentQuery.data ?? []).filter((unit) => {
      if (availability !== "all" && unit.availability !== availability) return false;
      return matchesSearch(unit, needle);
    });
  }, [equipmentQuery.data, search, availability]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <QrmSubNav />
      <QrmPageHeader
        title="Equipment"
        subtitle="Every unit in the workspace — stock, rental fleet, and customer machines."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, serial, stock #, make, model…"
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-qep-orange"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "available", "rented", "sold"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAvailability(value)}
              className={
                "rounded-md border px-2.5 py-1.5 text-xs font-medium capitalize transition-colors " +
                (availability === value
                  ? "border-qep-orange text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground")
              }
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {equipmentQuery.isLoading ? (
        <RowSkeleton rows={6} />
      ) : equipmentQuery.isError ? (
        <RetryState
          message="Couldn't load equipment."
          onRetry={() => void equipmentQuery.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          headline={search || availability !== "all" ? "No machines match" : "No equipment yet"}
          body={
            search || availability !== "all"
              ? "Try a different search or clear the availability filter."
              : "Units appear here as they are created from intake, trades, or QRM."
          }
        />
      ) : (
        <Card className="divide-y divide-border/60 p-0">
          {filtered.map((unit) => (
            <Link
              key={unit.id}
              to={`/qrm/equipment/${unit.id}`}
              className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/20"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{unit.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[
                    unit.stockNumber ? `Stock ${unit.stockNumber}` : null,
                    unit.serialNumber ? `SN ${unit.serialNumber}` : null,
                    [unit.year, unit.make, unit.model].filter(Boolean).join(" ") || null,
                    unit.engineHours != null ? `${unit.engineHours.toLocaleString()} hrs` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {unit.ownership.replace(/_/g, " ")}
                </span>
                <span
                  className={
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                    availabilityTone(unit.availability)
                  }
                >
                  {unit.availability.replace(/_/g, " ")}
                </span>
              </div>
            </Link>
          ))}
        </Card>
      )}

      {!equipmentQuery.isLoading && !equipmentQuery.isError && (equipmentQuery.data?.length ?? 0) >= 200 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing the 200 most recently updated units. Use search to narrow further.
        </p>
      )}
    </div>
  );
}
