import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Truck,
  Flame,
  Gauge,
  Box,
  Wrench,
  Droplet,
  Package,
  AlertTriangle,
  Copy,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { fetchMachineProfiles } from "../lib/companion-api";
import type { MachineProfile } from "../lib/types";

/* ── Design Tokens ─────────────────────────────────────────── */
const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  cardHover: "#182A44",
  border: "#1F3254",
  borderSoft: "#18263F",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  orangeDeep: "rgba(232,119,34,0.35)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  danger: "#EF4444",
  dangerBg: "rgba(239,68,68,0.12)",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.12)",
  info: "#3B82F6",
  infoBg: "rgba(59,130,246,0.12)",
  purple: "#A855F7",
  purpleBg: "rgba(168,85,247,0.14)",
} as const;

/* ── Manufacturer Colors ───────────────────────────────────── */
const MANUFACTURER_COLORS: Record<string, string> = {
  Barko: "#3B82F6",
  Bandit: "#EF4444",
  ASV: "#22C55E",
  Prinoth: "#A855F7",
  Yanmar: "#EC4899",
  Serco: "#06B6D4",
  Shearex: "#EAB308",
  Lamtrac: "#6366F1",
  CMI: "#64748B",
};

function getColor(manufacturer: string): string {
  return MANUFACTURER_COLORS[manufacturer] || "#64748B";
}

/* ── Copyable Part Number ──────────────────────────────────── */
function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText?.(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold font-mono cursor-pointer transition-all"
      style={{
        border: `1px solid ${copied ? T.success : T.border}`,
        background: copied ? T.successBg : T.bgElevated,
        color: copied ? T.success : T.text,
      }}
    >
      {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : text}
    </button>
  );
}

/* ── Machine Card ──────────────────────────────────────────── */
function MachineCard({
  profile,
  onClick,
}: {
  profile: MachineProfile;
  onClick: () => void;
}) {
  const accent = getColor(profile.manufacturer);
  const yearRange = profile.year_range_start
    ? `${profile.year_range_start}--${profile.year_range_end || "present"}`
    : "";

  // Find a "top part" from the first wear-part system if available
  const allWearParts = Object.values(profile.common_wear_parts).flat();
  const topPart = allWearParts[0] ?? null;

  // Intervals due count (maintenance intervals defined)
  const intervalsDue = profile.maintenance_schedule.length;

  return (
    <div
      onClick={onClick}
      className="rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = accent;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = T.border;
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Header band */}
      <div
        style={{
          background: `linear-gradient(135deg, ${accent}38 0%, transparent 100%)`,
          borderBottom: `1px solid ${T.borderSoft}`,
          padding: "14px 16px 12px",
        }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center rounded-lg shrink-0"
              style={{
                width: 32,
                height: 32,
                background: accent,
              }}
            >
              <span className="text-xs font-extrabold text-white leading-none">
                {profile.manufacturer.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: T.textMuted }}
              >
                {profile.manufacturer}
              </div>
              <div
                className="text-[17px] leading-tight"
                style={{ fontWeight: 800, color: T.text }}
              >
                {profile.model}
              </div>
            </div>
          </div>
          {intervalsDue > 0 && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
              style={{
                background: T.warningBg,
                color: T.warning,
              }}
            >
              <AlertTriangle size={11} />
              {intervalsDue}
            </div>
          )}
        </div>
        <div
          className="mt-1.5 text-[12px]"
          style={{ color: T.textMuted }}
        >
          {profile.category}
          {yearRange ? ` \u00B7 ${yearRange}` : ""}
        </div>
      </div>

      {/* Specs grid */}
      <div
        className="grid grid-cols-2 gap-3"
        style={{ padding: "12px 16px" }}
      >
        {profile.specs.horsepower != null && (
          <div className="flex items-center gap-2">
            <Gauge size={14} style={{ color: T.textDim }} />
            <div>
              <div
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: T.textDim }}
              >
                HP
              </div>
              <div
                className="text-[13px] font-bold"
                style={{ color: T.text }}
              >
                {String(profile.specs.horsepower as number)}
              </div>
            </div>
          </div>
        )}
        {profile.specs.weight_lbs != null && (
          <div className="flex items-center gap-2">
            <Box size={14} style={{ color: T.textDim }} />
            <div>
              <div
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: T.textDim }}
              >
                Weight
              </div>
              <div
                className="text-[13px] font-bold"
                style={{ color: T.text }}
              >
                {Number(
                  profile.specs.weight_lbs as number,
                ).toLocaleString()}{" "}
                lbs
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top Part row */}
      {topPart && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: "8px 16px",
            borderTop: `1px solid ${T.borderSoft}`,
          }}
        >
          <Flame size={13} style={{ color: T.orange }} />
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: T.textMuted }}
          >
            Top Part
          </span>
          <Copyable text={topPart.part_number} />
        </div>
      )}

      {/* Action buttons row */}
      <div
        className="flex gap-2"
        style={{
          padding: "10px 16px 14px",
          borderTop: `1px solid ${T.borderSoft}`,
        }}
      >
        {[
          { icon: Wrench, label: "Service" },
          { icon: Droplet, label: "Fluids" },
          { icon: Package, label: "Wear" },
        ].map(({ icon: Icon, label }) => (
          <button
            key={label}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors"
            style={{
              background: T.bgElevated,
              border: `1px solid ${T.border}`,
              color: T.text,
            }}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Machines Page ─────────────────────────────────────────── */
export function MachinesPage() {
  const navigate = useNavigate();
  const [selectedManufacturer, setSelectedManufacturer] = useState<
    string | null
  >(null);

  const {
    data: profiles = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["machine-profiles"],
    queryFn: () => fetchMachineProfiles(),
    staleTime: 60 * 60 * 1000,
  });

  /* Group by manufacturer */
  const manufacturers = useMemo(() => {
    const grouped: Record<
      string,
      { name: string; models: MachineProfile[]; categories: Set<string> }
    > = {};
    for (const p of profiles) {
      if (!grouped[p.manufacturer]) {
        grouped[p.manufacturer] = {
          name: p.manufacturer,
          models: [],
          categories: new Set(),
        };
      }
      grouped[p.manufacturer].models.push(p);
      grouped[p.manufacturer].categories.add(p.category);
    }
    return Object.values(grouped).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [profiles]);

  /* Filtered models */
  const filteredProfiles = selectedManufacturer
    ? profiles.filter((p) => p.manufacturer === selectedManufacturer)
    : profiles;

  /* ── Loading state ─── */
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ background: T.bg }}
      >
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: `3px solid ${T.border}`,
            borderTopColor: T.orange,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: T.bg }}
    >
      {/* Hero Section */}
      <div
        className="flex-shrink-0"
        style={{
          background: `linear-gradient(180deg, ${T.orangeGlow} 0%, ${T.bg} 100%)`,
          borderBottom: `1px solid ${T.border}`,
          padding: "20px 24px 16px",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck size={22} style={{ color: T.orange }} />
            <h1
              className="m-0"
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: T.text,
                lineHeight: 1.2,
              }}
            >
              Machine Reference
            </h1>
            <span
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
              style={{
                background: T.card,
                color: T.textMuted,
              }}
            >
              {profiles.length}
            </span>
          </div>
          <button
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors"
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              color: T.text,
            }}
          >
            <Plus size={14} />
            Add Profile
          </button>
        </div>
      </div>

      {/* Brand Filter Chips */}
      <div
        className="flex-shrink-0 overflow-x-auto"
        style={{
          padding: "12px 24px",
          borderBottom: `1px solid ${T.borderSoft}`,
        }}
      >
        <div className="flex gap-2 min-w-max">
          {/* All chip */}
          <button
            onClick={() => setSelectedManufacturer(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-all"
            style={{
              border: `1px solid ${
                !selectedManufacturer ? T.orange : T.border
              }`,
              background: !selectedManufacturer
                ? T.orangeGlow
                : "transparent",
              color: !selectedManufacturer ? T.orange : T.textMuted,
            }}
          >
            All
          </button>

          {manufacturers.map((m) => {
            const color = getColor(m.name);
            const active = selectedManufacturer === m.name;
            // Count models with maintenance intervals for "hot" badge
            const hotCount = m.models.filter(
              (mdl) => mdl.maintenance_schedule.length > 0,
            ).length;
            return (
              <button
                key={m.name}
                onClick={() =>
                  setSelectedManufacturer(active ? null : m.name)
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-all"
                style={{
                  border: `1px solid ${active ? color : T.border}`,
                  background: active ? `${color}38` : "transparent",
                  color: active ? color : T.textMuted,
                }}
              >
                <span
                  className="inline-block rounded-full shrink-0"
                  style={{
                    width: 8,
                    height: 8,
                    background: color,
                  }}
                />
                {m.name}
                <span
                  className="text-[11px]"
                  style={{ color: T.textDim }}
                >
                  {m.models.length}
                </span>
                {hotCount > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[10px] font-bold"
                    style={{
                      background: T.orangeGlow,
                      color: T.orange,
                    }}
                  >
                    <Flame size={9} />
                    {hotCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-auto"
        style={{ padding: "16px 24px 24px" }}
      >
        {error && (
          <div
            className="p-4 rounded-lg text-sm mb-4"
            style={{
              background: T.dangerBg,
              border: `1px solid ${T.danger}40`,
              color: T.danger,
            }}
          >
            Failed to load machines. {(error as Error).message}
          </div>
        )}

        {profiles.length === 0 && !error && (
          <div
            className="flex flex-col items-center justify-center py-16"
            style={{ color: T.textMuted }}
          >
            <Truck size={40} style={{ color: T.border }} className="mb-3" />
            <p className="text-sm font-semibold">No machine profiles yet</p>
            <p className="text-xs mt-1" style={{ color: T.textDim }}>
              Machine profiles are created when manufacturer documentation is
              processed.
            </p>
          </div>
        )}

        {/* Machine cards grid */}
        <div
          className="grid gap-[14px]"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          }}
        >
          {filteredProfiles.map((profile) => (
            <MachineCard
              key={profile.id}
              profile={profile}
              onClick={() =>
                navigate(`/parts/companion/machines/${profile.id}`)
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
