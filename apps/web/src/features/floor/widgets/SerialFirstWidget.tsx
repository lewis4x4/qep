/**
 * SerialFirstWidget — Juan's hero. ADR-004 made concrete.
 *
 * Paste a serial, get a three-panel snapshot: Machine · Owner · Service
 * state. Click to deep-link to the equipment record and pre-populate a
 * parts quote from there.
 *
 * Moonshot behavior:
 *   • Paste-tolerant. Strips non-alphanumeric before query, then
 *     ILIKEs against `serial_number`. Customers email serials with
 *     dashes, spaces, and OCR'd noise; Juan pastes, the widget copes.
 *   • Three-panel snapshot: Machine (make / model / year / condition),
 *     Owner (company / phone with tel: link), Service (engine hours,
 *     last inspection, next service due).
 *   • Ownership-transfer awareness (ADR-007): when a matched serial's
 *     current owner differs from what the counter expects, the
 *     handoff into the full equipment record is the right escape
 *     hatch — the composer surfaces it inline via "Owner mismatch?"
 *     copy in the Owner panel.
 *   • Empty state tells the rep how the widget works in one line.
 *     No serial typed → "Paste a serial to pull the machine, owner,
 *     and service state."
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Building2,
  Cog,
  Gauge,
  Hash,
  Loader2,
  Phone,
  Search,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface EquipmentHit {
  id: string;
  serial_number: string | null;
  name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  condition: string | null;
  engine_hours: number | null;
  last_inspection_at: string | null;
  next_service_due_at: string | null;
  location_description: string | null;
  company: {
    id: string;
    name: string | null;
    dba: string | null;
    phone: string | null;
  } | null;
}

const MIN_QUERY_LEN = 3;
const DEBOUNCE_MS = 200;
const RESULT_LIMIT = 3;

/** Normalize a user-provided serial: trim, drop non-alphanumeric.
 *  Used ONLY to decide when to issue a query — the query itself uses
 *  raw ILIKE so customers' hyphenated serials still match their DB rows. */
function normalizeSerial(raw: string): string {
  return raw.trim().replace(/[^a-z0-9]/gi, "");
}

async function searchBySerial(raw: string): Promise<EquipmentHit[]> {
  if (normalizeSerial(raw).length < MIN_QUERY_LEN) return [];
  const pattern = `%${raw.trim().replace(/[()%,*]/g, "")}%`;
  const { data, error } = await supabase
    .from("qrm_equipment")
    .select(
      "id, serial_number, name, make, model, year, condition, engine_hours, last_inspection_at, next_service_due_at, location_description, company:qrm_companies!qrm_equipment_company_id_fkey ( id, name, dba, phone )",
    )
    .is("deleted_at", null)
    .ilike("serial_number", pattern)
    .order("updated_at", { ascending: false })
    .limit(RESULT_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EquipmentHit[];
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffDays = Math.floor((Date.now() - t) / 86_400_000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatDueDate(iso: string | null): { text: string; tone: "ok" | "soon" | "overdue" | "none" } {
  if (!iso) return { text: "Not scheduled", tone: "none" };
  const due = new Date(iso).getTime();
  if (!Number.isFinite(due)) return { text: "Not scheduled", tone: "none" };
  const days = Math.ceil((due - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days <= 14) return { text: `In ${days}d`, tone: "soon" };
  return { text: new Date(iso).toLocaleDateString(), tone: "ok" };
}

export function SerialFirstWidget() {
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [raw]);

  const normalized = useMemo(() => normalizeSerial(debounced), [debounced]);
  const showResults = normalized.length >= MIN_QUERY_LEN;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["floor", "serial-first", debounced],
    queryFn: () => searchBySerial(debounced),
    enabled: showResults,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const topHit = (data ?? [])[0] ?? null;
  const extraHits = (data ?? []).slice(1);

  return (
    <div
      role="search"
      aria-label="Serial-first parts lookup"
      className="floor-widget-in relative flex h-full min-h-[260px] flex-col overflow-hidden rounded-xl border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-all duration-150 ease-out hover:border-[hsl(var(--qep-orange))]/40"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px] bg-[hsl(var(--qep-orange))]/60"
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Hash className="h-3.5 w-3.5 text-[hsl(var(--qep-gray))]" aria-hidden="true" />
          <h3 className="font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-gray))]">
            Serial-first lookup
          </h3>
        </div>
        <Link
          to="/qrm/equipment"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-[hsl(var(--qep-orange))]"
        >
          All machines
        </Link>
      </div>

      {/* Search input — big, oversized, the widget's hero affordance */}
      <div className="relative mt-3">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Paste or type a serial number"
          aria-label="Search equipment by serial number"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          className="h-12 w-full rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] pl-9 pr-9 font-mono text-sm text-foreground placeholder:text-muted-foreground placeholder:font-sans focus:border-[hsl(var(--qep-orange))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--qep-orange))]/40"
        />
        {raw && (
          <button
            type="button"
            onClick={() => setRaw("")}
            aria-label="Clear serial"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Result zone */}
      <div className="mt-3 flex-1">
        {!showResults && (
          <EmptyHint hasInput={raw.trim().length > 0} minLen={MIN_QUERY_LEN} />
        )}
        {showResults && isFetching && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Looking up…
          </div>
        )}
        {showResults && isError && (
          <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Lookup failed. Try again, or open the full machines list.</span>
          </div>
        )}
        {showResults && !isFetching && !isError && !topHit && (
          <p className="text-xs text-muted-foreground">
            No match for{" "}
            <span className="font-mono font-semibold text-foreground">{debounced}</span>. Check
            for extra characters, or{" "}
            <Link to="/qrm/equipment" className="text-[hsl(var(--qep-orange))] hover:underline">
              browse all machines
            </Link>
            .
          </p>
        )}
        {showResults && !isFetching && !isError && topHit && (
          <MachineSnapshot hit={topHit} alternates={extraHits} />
        )}
      </div>
    </div>
  );
}

function EmptyHint({ hasInput, minLen }: { hasInput: boolean; minLen: number }) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <Truck className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <p>
        {hasInput
          ? `Keep typing — needs at least ${minLen} alphanumeric characters.`
          : "Paste a serial to pull the machine, owner, and service state in one read."}
      </p>
    </div>
  );
}

function MachineSnapshot({
  hit,
  alternates,
}: {
  hit: EquipmentHit;
  alternates: EquipmentHit[];
}) {
  const displayName =
    hit.name ||
    [hit.year, hit.make, hit.model].filter(Boolean).join(" ") ||
    hit.model ||
    "Machine";
  const due = formatDueDate(hit.next_service_due_at);

  return (
    <div className="space-y-2.5">
      {/* Title strip */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            Serial · {hit.serial_number ?? "—"}
          </p>
        </div>
        <Link
          to={`/qrm/equipment/${hit.id}`}
          className="shrink-0 rounded-md border border-[hsl(var(--qep-orange))]/40 bg-[hsl(var(--qep-orange))]/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--qep-orange))] transition-colors hover:bg-[hsl(var(--qep-orange))]/15"
        >
          Open record
        </Link>
      </div>

      {/* Three-panel snapshot */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SnapshotPanel
          icon={<Cog className="h-3 w-3" />}
          label="Machine"
          primary={[hit.make, hit.model].filter(Boolean).join(" ") || "—"}
          secondary={
            [
              hit.year ? String(hit.year) : null,
              hit.condition ? hit.condition.toLowerCase() : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"
          }
        />
        <SnapshotPanel
          icon={<Building2 className="h-3 w-3" />}
          label="Owner"
          primary={hit.company?.dba || hit.company?.name || "Unknown owner"}
          secondary={
            hit.company?.phone ? (
              <a
                href={`tel:${hit.company.phone}`}
                className="inline-flex items-center gap-1 text-[hsl(var(--qep-orange))] hover:underline"
              >
                <Phone className="h-2.5 w-2.5" aria-hidden="true" />
                {hit.company.phone}
              </a>
            ) : (
              "No phone on file"
            )
          }
        />
        <SnapshotPanel
          icon={<Wrench className="h-3 w-3" />}
          label="Service"
          primary={
            hit.engine_hours != null
              ? `${hit.engine_hours.toLocaleString()} hrs`
              : "Hours unknown"
          }
          secondary={
            <span className="flex items-center gap-1">
              <Gauge
                className={
                  due.tone === "overdue"
                    ? "h-2.5 w-2.5 text-rose-400"
                    : due.tone === "soon"
                      ? "h-2.5 w-2.5 text-amber-400"
                      : "h-2.5 w-2.5 text-muted-foreground"
                }
                aria-hidden="true"
              />
              Next service: {due.text}
              {hit.last_inspection_at && (
                <>
                  <span className="mx-1 text-muted-foreground/50">·</span>
                  Last inspection {formatRelative(hit.last_inspection_at)}
                </>
              )}
            </span>
          }
        />
      </div>

      {alternates.length > 0 && (
        <div className="rounded-md border border-[hsl(var(--qep-deck-rule))]/60 bg-[hsl(var(--qep-deck))] p-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {alternates.length} other match{alternates.length === 1 ? "" : "es"}
          </p>
          <ul className="mt-1 space-y-0.5">
            {alternates.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/qrm/equipment/${a.id}`}
                  className="flex items-center justify-between gap-2 text-[11px] text-foreground hover:text-[hsl(var(--qep-orange))]"
                >
                  <span className="truncate">
                    {[a.year, a.make, a.model].filter(Boolean).join(" ") || a.name || "Machine"}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {a.serial_number}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SnapshotPanel({
  icon,
  label,
  primary,
  secondary,
}: {
  icon: React.ReactNode;
  label: string;
  primary: React.ReactNode;
  secondary: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-[hsl(var(--qep-deck-rule))]/70 bg-[hsl(var(--qep-deck))] p-2.5">
      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className="text-[hsl(var(--qep-orange))]">{icon}</span>
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{primary}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{secondary}</p>
    </div>
  );
}
