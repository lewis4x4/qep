import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Cpu, ChevronRight, Filter } from "lucide-react";
import { fetchMachineProfiles } from "../lib/companion-api";
import type { MachineProfile } from "../lib/types";

// Color map for manufacturers
const MANUFACTURER_COLORS: Record<string, string> = {
  Barko: "#2563EB",
  Bandit: "#DC2626",
  ASV: "#059669",
  Prinoth: "#7C3AED",
  Yanmar: "#DB2777",
  Serco: "#0891B2",
  Shearex: "#CA8A04",
  Lamtrac: "#4F46E5",
  CMI: "#64748B",
};

function getColor(manufacturer: string): string {
  return MANUFACTURER_COLORS[manufacturer] || "#4A5568";
}

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
    staleTime: 60 * 60 * 1000, // 1 hour — machine profiles rarely change
  });

  // Group by manufacturer
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

  // If a manufacturer is selected, show its models
  const selectedModels = selectedManufacturer
    ? manufacturers.find((m) => m.name === selectedManufacturer)?.models || []
    : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between flex-shrink-0 bg-white"
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-qep-orange" />
          <span className="text-sm font-bold text-[#2D3748]">
            Machine Reference Library
          </span>
          <span className="text-xs text-[#718096]">
            — {manufacturers.length} manufacturers · {profiles.length} models
          </span>
        </div>
        {selectedManufacturer && (
          <button
            onClick={() => setSelectedManufacturer(null)}
            className="text-xs font-semibold text-qep-orange cursor-pointer border-none bg-transparent hover:underline"
          >
            ← All Manufacturers
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        {error && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            Failed to load machines. {(error as Error).message}
          </div>
        )}

        {profiles.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-[#718096]">
            <Cpu size={40} className="mb-3 text-[#E2E8F0]" />
            <p className="text-sm font-semibold">No machine profiles yet</p>
            <p className="text-xs mt-1">
              Machine profiles are created when manufacturer documentation is
              processed.
            </p>
          </div>
        )}

        {/* Manufacturer grid */}
        {!selectedManufacturer && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {manufacturers.map((m) => {
              const color = getColor(m.name);
              return (
                <div
                  key={m.name}
                  onClick={() => setSelectedManufacturer(m.name)}
                  className="bg-white rounded-xl p-5 cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
                  style={{
                    border: "1px solid #E2E8F0",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-lg"
                      style={{ background: `${color}15` }}
                    >
                      <span
                        className="text-base font-extrabold"
                        style={{ color }}
                      >
                        {m.name.slice(0, 2)}
                      </span>
                    </div>
                    <ChevronRight size={16} className="text-[#718096]" />
                  </div>
                  <div className="text-base font-bold text-[#2D3748] mb-1">
                    {m.name}
                  </div>
                  <div className="text-xs text-[#718096] mb-1.5">
                    {Array.from(m.categories).join(" · ")}
                  </div>
                  <div className="text-[13px] font-semibold" style={{ color }}>
                    {m.models.length} model{m.models.length !== 1 ? "s" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Model list for selected manufacturer */}
        {selectedManufacturer && (
          <div className="flex flex-col gap-2">
            {selectedModels.map((model) => {
              const color = getColor(model.manufacturer);
              const yearRange = model.year_range_start
                ? `${model.year_range_start}–${model.year_range_end || "present"}`
                : "";
              return (
                <div
                  key={model.id}
                  onClick={() =>
                    navigate(`/parts/companion/machines/${model.id}`)
                  }
                  className="flex items-center bg-white rounded-xl p-4 cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-px"
                  style={{
                    border: "1px solid #E2E8F0",
                    borderLeft: `4px solid ${color}`,
                  }}
                >
                  <div className="flex-1">
                    <div className="text-base font-bold text-[#2D3748]">
                      {model.manufacturer} {model.model}
                    </div>
                    <div className="text-xs text-[#718096]">
                      {model.category}
                      {yearRange ? ` · ${yearRange}` : ""}
                      {model.model_family ? ` · ${model.model_family}` : ""}
                    </div>
                  </div>

                  {/* Quick specs */}
                  <div className="flex gap-3 mr-4">
                    {model.specs.horsepower != null && (
                      <div className="text-center px-3 py-1 rounded-md bg-[#F7F8FA] border border-[#E2E8F0]">
                        <div className="text-sm font-bold text-[#2D3748]">
                          {String(model.specs.horsepower as number)}
                        </div>
                        <div className="text-[10px] text-[#718096] uppercase tracking-wider">
                          HP
                        </div>
                      </div>
                    )}
                    {model.specs.weight_lbs != null && (
                      <div className="text-center px-3 py-1 rounded-md bg-[#F7F8FA] border border-[#E2E8F0]">
                        <div className="text-sm font-bold text-[#2D3748]">
                          {Number(model.specs.weight_lbs as number).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-[#718096] uppercase tracking-wider">
                          lbs
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confidence / verified badge */}
                  <div className="flex items-center gap-2">
                    {model.manually_verified ? (
                      <span className="text-[11px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded">
                        ✓ Verified
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#718096] bg-[#F3F4F6] px-2 py-0.5 rounded">
                        {Math.round(model.extraction_confidence * 100)}% AI
                      </span>
                    )}
                    <ChevronRight size={16} className="text-[#718096]" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
