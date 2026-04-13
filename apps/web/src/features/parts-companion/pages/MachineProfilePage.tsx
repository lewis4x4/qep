import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Shield,
  Star,
} from "lucide-react";
import { fetchMachineProfile } from "../lib/companion-api";
import type { MachineProfile } from "../lib/types";

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#718096]">
        <p className="text-sm font-semibold">Machine profile not found</p>
        <button
          onClick={() => navigate("/parts/companion/machines")}
          className="mt-3 text-sm text-qep-orange cursor-pointer border-none bg-transparent hover:underline"
        >
          ← Back to Machines
        </button>
      </div>
    );
  }

  const p = profile;
  const yearRange = p.year_range_start
    ? `${p.year_range_start}–${p.year_range_end || "present"}`
    : "";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex-shrink-0 bg-white"
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        <button
          onClick={() => navigate("/parts/companion/machines")}
          className="flex items-center gap-1 border-none bg-transparent cursor-pointer text-[13px] text-qep-orange font-semibold mb-2 hover:underline"
        >
          <ChevronLeft size={16} /> Back to Machines
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[22px] font-extrabold text-[#2D3748]">
              {p.manufacturer} {p.model}
            </div>
            <div className="text-[13px] text-[#718096]">
              {p.category}
              {yearRange ? ` · ${yearRange}` : ""}
            </div>
          </div>
          <div className="flex gap-3">
            {Object.entries(p.specs)
              .slice(0, 4)
              .map(([key, val]) => (
                <div
                  key={key}
                  className="text-center px-3.5 py-1.5 rounded-lg bg-[#F7F8FA] border border-[#E2E8F0]"
                >
                  <div className="text-[15px] font-bold text-[#2D3748]">
                    {String(val)}
                  </div>
                  <div className="text-[10px] text-[#718096] uppercase tracking-wider">
                    {key.replace(/_/g, " ")}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto" style={{ padding: "16px 24px" }}>
        {/* Maintenance Schedule */}
        {p.maintenance_schedule.length > 0 && (
          <div className="bg-white rounded-xl border border-[#E2E8F0] mb-3 overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFBFC] border-b border-[#E2E8F0]">
              <span className="text-[13px] font-bold text-[#2D3748] uppercase tracking-wide">
                Maintenance Schedule
              </span>
            </div>
            <div
              className="grid text-xs font-semibold text-[#718096] uppercase tracking-wider border-b border-[#E2E8F0]"
              style={{
                gridTemplateColumns: "100px 1fr 1fr",
                padding: "8px 16px",
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
                      ? "1px solid #E2E8F0"
                      : "none",
                }}
              >
                <span className="font-bold text-qep-orange">
                  {m.interval_hours} hrs
                </span>
                <div className="text-[#2D3748]">
                  {m.tasks.map((t, j) => (
                    <div key={j} className="mb-0.5">
                      {t}
                    </div>
                  ))}
                </div>
                <div>
                  {(m.parts || []).map((pt, j) => (
                    <div
                      key={j}
                      className="font-mono text-xs text-[#3182CE] mb-0.5"
                    >
                      {pt}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fluid Capacities */}
        {Object.keys(p.fluid_capacities).length > 0 && (
          <div className="bg-white rounded-xl border border-[#E2E8F0] mb-3 overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFBFC] border-b border-[#E2E8F0]">
              <span className="text-[13px] font-bold text-[#2D3748] uppercase tracking-wide">
                Fluid Capacities & Specs
              </span>
            </div>
            {Object.entries(p.fluid_capacities).map(([system, info], i, arr) => (
              <div
                key={system}
                className="grid text-[13px] items-center"
                style={{
                  gridTemplateColumns: "140px 100px 1fr",
                  padding: "10px 16px",
                  borderBottom:
                    i < arr.length - 1 ? "1px solid #E2E8F0" : "none",
                }}
              >
                <span className="font-semibold text-[#2D3748] capitalize">
                  {system.replace(/_/g, " ")}
                </span>
                <span className="font-bold text-qep-orange">
                  {info.capacity}
                </span>
                <span className="font-mono text-xs text-[#4A5568]">
                  {info.spec}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Wear Parts by System */}
        {Object.keys(p.common_wear_parts).length > 0 && (
          <div className="bg-white rounded-xl border border-[#E2E8F0] mb-3 overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFBFC] border-b border-[#E2E8F0]">
              <span className="text-[13px] font-bold text-[#2D3748] uppercase tracking-wide">
                Common Wear Parts
              </span>
            </div>
            {Object.entries(p.common_wear_parts).map(([system, parts]) => (
              <div key={system}>
                <button
                  onClick={() => toggle(system)}
                  className="flex items-center gap-2 w-full px-4 py-2.5 border-none border-b border-[#E2E8F0] cursor-pointer text-left"
                  style={{
                    background: openSections.includes(system)
                      ? "#FFF3E8"
                      : "transparent",
                    borderBottom: "1px solid #E2E8F0",
                  }}
                >
                  {openSections.includes(system) ? (
                    <ChevronDown size={14} className="text-qep-orange" />
                  ) : (
                    <ChevronRight size={14} className="text-[#718096]" />
                  )}
                  <span
                    className="text-[13px] font-bold capitalize"
                    style={{
                      color: openSections.includes(system)
                        ? "#E87722"
                        : "#2D3748",
                    }}
                  >
                    {system.replace(/_/g, " ")}
                  </span>
                  <span className="text-[11px] text-[#718096]">
                    ({parts.length} parts)
                  </span>
                </button>
                {openSections.includes(system) && (
                  <div>
                    {parts.map((pt, i) => (
                      <div
                        key={i}
                        className="grid text-xs items-center"
                        style={{
                          gridTemplateColumns: "160px 1fr 120px 60px",
                          padding: "8px 16px 8px 40px",
                          borderBottom: "1px solid #E2E8F0",
                        }}
                      >
                        <span className="font-mono font-semibold text-[#3182CE] cursor-pointer hover:underline">
                          {pt.part_number}
                        </span>
                        <span className="text-[#2D3748]">
                          {pt.description}
                        </span>
                        <span className="text-[#718096]">
                          {pt.avg_replace_hours
                            ? `${pt.avg_replace_hours} hrs`
                            : "As needed"}
                        </span>
                        <button className="px-2 py-0.5 rounded border border-[#E2E8F0] bg-white text-[11px] text-[#4A5568] cursor-pointer hover:bg-[#F7F8FA]">
                          Look up
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Confidence footer */}
        <div className="flex items-center gap-2 p-4 bg-white rounded-xl border border-[#E2E8F0]">
          <Shield size={14} className="text-green-500" />
          <span className="text-xs text-[#718096]">
            Confidence:{" "}
            <strong className="text-[#2D3748]">
              {Math.round(p.extraction_confidence * 100)}%
            </strong>
            {p.manually_verified && (
              <span className="text-green-600 ml-2">✓ Manually verified</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
