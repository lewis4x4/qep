/**
 * DecisionRoomCohortFilters — three-dimension cohort selector.
 * Equipment × deal size × rep tenure. Each dimension is multi-select
 * (OR within); dimensions AND across. Empty in any dimension = all.
 *
 * The selection persists in localStorage so a manager's filter stays
 * applied across page loads.
 */
import { useEffect } from "react";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "./command-deck";
import {
  DEAL_SIZE_COHORTS,
  EQUIPMENT_COHORTS,
  REP_TENURE_COHORTS,
  type CohortFilter,
  type DealSizeCohort,
  type EquipmentCohort,
  type RepTenureCohort,
  isEmptyFilter,
  EMPTY_COHORT_FILTER,
} from "../lib/decision-room-cohorts";

const STORAGE_KEY = "qep:decision-room:analytics:cohort-filter";

interface Props {
  value: CohortFilter;
  onChange: (next: CohortFilter) => void;
}

interface ChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function Chip({ label, active, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-qep-orange/60 bg-qep-orange/15 text-qep-orange"
          : "border-white/10 bg-white/[0.03] text-foreground/80 hover:border-white/20",
      )}
    >
      {label}
    </button>
  );
}

export function loadCohortFilter(): CohortFilter {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_COHORT_FILTER;
    const parsed = JSON.parse(raw) as Partial<CohortFilter>;
    return {
      equipment: Array.isArray(parsed.equipment) ? (parsed.equipment as EquipmentCohort[]) : [],
      sizes: Array.isArray(parsed.sizes) ? (parsed.sizes as DealSizeCohort[]) : [],
      tenures: Array.isArray(parsed.tenures) ? (parsed.tenures as RepTenureCohort[]) : [],
    };
  } catch {
    return EMPTY_COHORT_FILTER;
  }
}

export function persistCohortFilter(filter: CohortFilter): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // quota / private-mode — ignore.
  }
}

export function DecisionRoomCohortFilters({ value, onChange }: Props) {
  // Persist every change so selection survives refresh.
  useEffect(() => {
    persistCohortFilter(value);
  }, [value]);

  function toggle<T extends string>(arr: T[], key: T): T[] {
    return arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key];
  }

  const empty = isEmptyFilter(value);

  return (
    <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Filter className="h-3.5 w-3.5 text-qep-orange" aria-hidden />
          Cohort filter
        </h2>
        {!empty ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(EMPTY_COHORT_FILTER)}
            className="h-7 gap-1 text-[10px] uppercase tracking-wider"
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Equipment
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EQUIPMENT_COHORTS.map((def) => (
              <Chip
                key={def.key}
                label={def.label}
                active={value.equipment.includes(def.key)}
                onClick={() =>
                  onChange({
                    ...value,
                    equipment: toggle(value.equipment, def.key),
                  })
                }
              />
            ))}
            <Chip
              label="Other / unknown"
              active={value.equipment.includes("unknown") || value.equipment.includes("other_machine")}
              onClick={() => {
                const hasAny =
                  value.equipment.includes("unknown") || value.equipment.includes("other_machine");
                const cleaned = value.equipment.filter(
                  (k) => k !== "unknown" && k !== "other_machine",
                );
                onChange({
                  ...value,
                  equipment: hasAny ? cleaned : [...cleaned, "unknown", "other_machine"],
                });
              }}
            />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Deal size
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DEAL_SIZE_COHORTS.map((def) => (
              <Chip
                key={def.key}
                label={def.label}
                active={value.sizes.includes(def.key)}
                onClick={() =>
                  onChange({
                    ...value,
                    sizes: toggle(value.sizes, def.key),
                  })
                }
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rep tenure
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REP_TENURE_COHORTS.map((def) => (
              <Chip
                key={def.key}
                label={def.label}
                active={value.tenures.includes(def.key)}
                onClick={() =>
                  onChange({
                    ...value,
                    tenures: toggle(value.tenures, def.key),
                  })
                }
              />
            ))}
          </div>
        </div>
      </div>

      {empty ? (
        <p className="mt-3 text-[11px] italic text-muted-foreground">
          No filter active — aggregates below cover every move in the window.
        </p>
      ) : null}
    </DeckSurface>
  );
}
