import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Shield,
  Gauge,
  Box,
  Droplet,
  Wrench,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { fetchMachineProfile } from "../lib/companion-api";
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

/* ── Copyable Component ────────────────────────────────────── */
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

/* ── Machine Profile Page ──────────────────────────────────── */
export function MachineProfilePage() {
  const { machineId } = useParams<{ machineId: string }>();
  const navigate = useNavigate();
  const [openSections, setOpenSections] = useState<string[]>([
    "Engine",
    "Hydraulic",
  ]);

  const {
    data: profile,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["machine-profile", machineId],
    queryFn: () => fetchMachineProfile(machineId!),
    enabled: !!machineId,
    staleTime: 60 * 60 * 1000,
  });

  const toggle = (section: string) =>
    setOpenSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section],
    );

  /* ── Loading ─── */
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

  /* ── Error / Not Found ─── */
  if (error || !profile) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full"
        style={{ background: T.bg, color: T.textMuted }}
      >
        <p className="text-sm font-semibold">Machine profile not found</p>
        <button
          onClick={() => navigate("/parts/companion/machines")}
          className="mt-3 text-sm cursor-pointer border-none bg-transparent font-semibold hover:underline"
          style={{ color: T.orange }}
        >
          Back to Machines
        </button>
      </div>
    );
  }

  const p = profile;
  const accent = getColor(p.manufacturer);
  const yearRange = p.year_range_start
    ? `${p.year_range_start}--${p.year_range_end || "present"}`
    : "";

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: T.bg }}
    >
      {/* ── Header ─── */}
      <div
        className="flex-shrink-0"
        style={{
          background: `linear-gradient(180deg, ${T.orangeGlow} 0%, ${T.bg} 100%)`,
          borderBottom: `1px solid ${T.border}`,
          padding: "16px 24px 18px",
        }}
      >
        <button
          onClick={() => navigate("/parts/companion/machines")}
          className="flex items-center gap-1 border-none bg-transparent cursor-pointer text-[13px] font-semibold mb-3 hover:underline"
          style={{ color: T.orange }}
        >
          <ChevronLeft size={16} /> Back to Machines
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div
              className="text-[11px] font-semibold uppercase tracking-wider mb-0.5"
              style={{ color: T.textMuted }}
            >
              {p.manufacturer}
            </div>
            <h1
              className="m-0"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: T.text,
                lineHeight: 1.2,
              }}
            >
              {p.model}
            </h1>
            <div
              className="text-[13px] mt-1"
              style={{ color: T.textMuted }}
            >
              {p.category}
              {yearRange ? ` \u00B7 ${yearRange}` : ""}
              {p.model_family ? ` \u00B7 ${p.model_family}` : ""}
            </div>
          </div>

          {/* Spec badges */}
          <div className="flex gap-2 flex-wrap justify-end">
            {Object.entries(p.specs)
              .slice(0, 4)
              .map(([key, val]) => (
                <div
                  key={key}
                  className="text-center px-3.5 py-2 rounded-lg"
                  style={{
                    background: T.card,
                    border: `1px solid ${T.border}`,
                  }}
                >
                  <div
                    className="text-[15px] font-bold"
                    style={{ color: T.text }}
                  >
                    {String(val)}
                  </div>
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: T.textDim }}
                  >
                    {key.replace(/_/g, " ")}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Content ─── */}
      <div
        className="flex-1 overflow-auto"
        style={{ padding: "20px 24px 32px" }}
      >
        {/* ── Maintenance Schedule ─── */}
        {p.maintenance_schedule.length > 0 && (
          <div
            className="rounded-xl overflow-hidden mb-4"
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
            }}
          >
            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{
                background: T.bgElevated,
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <Wrench size={14} style={{ color: T.orange }} />
              <span
                className="text-[13px] font-bold uppercase tracking-wide"
                style={{ color: T.text }}
              >
                Maintenance Schedule
              </span>
            </div>

            {/* Table header */}
            <div
              className="grid text-xs font-semibold uppercase tracking-wider"
              style={{
                gridTemplateColumns: "100px 1fr 1fr",
                padding: "8px 16px",
                borderBottom: `1px solid ${T.borderSoft}`,
                color: T.textDim,
              }}
            >
              <span>Interval</span>
              <span>Tasks</span>
              <span>Parts Needed</span>
            </div>

            {p.maintenance_schedule.map((m, i) => (
              <div
                key={i}
                className="grid text-[13px]"
                style={{
                  gridTemplateColumns: "100px 1fr 1fr",
                  padding: "10px 16px",
                  borderBottom:
                    i < p.maintenance_schedule.length - 1
                      ? `1px solid ${T.borderSoft}`
                      : "none",
                }}
              >
                <span style={{ fontWeight: 700, color: T.orange }}>
                  {m.interval_hours} hrs
                </span>
                <div style={{ color: T.text }}>
                  {m.tasks.map((t, j) => (
                    <div key={j} className="mb-0.5">
                      {t}
                    </div>
                  ))}
                </div>
                <div>
                  {(m.parts || []).map((pt, j) => (
                    <div key={j} className="mb-0.5">
                      <Copyable text={pt} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Fluid Capacities ─── */}
        {Object.keys(p.fluid_capacities).length > 0 && (
          <div
            className="rounded-xl overflow-hidden mb-4"
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
            }}
          >
            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{
                background: T.bgElevated,
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <Droplet size={14} style={{ color: T.info }} />
              <span
                className="text-[13px] font-bold uppercase tracking-wide"
                style={{ color: T.text }}
              >
                Fluid Capacities & Specs
              </span>
            </div>

            {Object.entries(p.fluid_capacities).map(
              ([system, info], i, arr) => (
                <div
                  key={system}
                  className="grid text-[13px] items-center"
                  style={{
                    gridTemplateColumns: "160px 100px 1fr",
                    padding: "10px 16px",
                    borderBottom:
                      i < arr.length - 1
                        ? `1px solid ${T.borderSoft}`
                        : "none",
                  }}
                >
                  <span
                    className="font-semibold capitalize"
                    style={{ color: T.text }}
                  >
                    {system.replace(/_/g, " ")}
                  </span>
                  <span style={{ fontWeight: 700, color: T.orange }}>
                    {info.capacity}
                  </span>
                  <span
                    className="font-mono text-xs"
                    style={{ color: T.textMuted }}
                  >
                    {info.spec}
                  </span>
                </div>
              ),
            )}
          </div>
        )}

        {/* ── Wear Parts by System ─── */}
        {Object.keys(p.common_wear_parts).length > 0 && (
          <div
            className="rounded-xl overflow-hidden mb-4"
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
            }}
          >
            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{
                background: T.bgElevated,
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <Gauge size={14} style={{ color: T.purple }} />
              <span
                className="text-[13px] font-bold uppercase tracking-wide"
                style={{ color: T.text }}
              >
                Common Wear Parts
              </span>
            </div>

            {Object.entries(p.common_wear_parts).map(([system, parts]) => {
              const isOpen = openSections.includes(system);
              return (
                <div key={system}>
                  <button
                    onClick={() => toggle(system)}
                    className="flex items-center gap-2 w-full px-4 py-2.5 border-none cursor-pointer text-left transition-colors"
                    style={{
                      background: isOpen ? T.orangeGlow : "transparent",
                      borderBottom: `1px solid ${T.borderSoft}`,
                    }}
                  >
                    {isOpen ? (
                      <ChevronDown
                        size={14}
                        style={{ color: T.orange }}
                      />
                    ) : (
                      <ChevronRight
                        size={14}
                        style={{ color: T.textDim }}
                      />
                    )}
                    <span
                      className="text-[13px] font-bold capitalize"
                      style={{
                        color: isOpen ? T.orange : T.text,
                      }}
                    >
                      {system.replace(/_/g, " ")}
                    </span>
                    <span
                      className="text-[11px]"
                      style={{ color: T.textMuted }}
                    >
                      ({parts.length} parts)
                    </span>
                  </button>

                  {isOpen && (
                    <div>
                      {parts.map((pt, i) => (
                        <div
                          key={i}
                          className="grid text-xs items-center"
                          style={{
                            gridTemplateColumns: "180px 1fr 120px 70px",
                            padding: "8px 16px 8px 40px",
                            borderBottom: `1px solid ${T.borderSoft}`,
                          }}
                        >
                          <Copyable text={pt.part_number} />
                          <span style={{ color: T.text }}>
                            {pt.description}
                          </span>
                          <span style={{ color: T.textMuted }}>
                            {pt.avg_replace_hours
                              ? `${pt.avg_replace_hours} hrs`
                              : "As needed"}
                          </span>
                          <button
                            className="px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition-colors"
                            style={{
                              background: T.bgElevated,
                              border: `1px solid ${T.border}`,
                              color: T.text,
                            }}
                          >
                            Look up
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Confidence Footer ─── */}
        <div
          className="flex items-center gap-2 p-4 rounded-xl"
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
          }}
        >
          <Shield size={14} style={{ color: T.success }} />
          <span className="text-xs" style={{ color: T.textMuted }}>
            Confidence:{" "}
            <strong style={{ color: T.text }}>
              {Math.round(p.extraction_confidence * 100)}%
            </strong>
            {p.manually_verified && (
              <span className="ml-2" style={{ color: T.success }}>
                Manually verified
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
