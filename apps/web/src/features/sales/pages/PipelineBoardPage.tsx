import { useSalesPipeline } from "../hooks/useSalesPipeline";
import { StageFilterTabs } from "../components/StageFilterTabs";
import { SalesDealCard } from "../components/SalesDealCard";

export function PipelineBoardPage() {
  const { deals, activeFilter, setActiveFilter, stageCounts, stages, isLoading } =
    useSalesPipeline();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Build filter options from stages + an "all" option
  const filterOptions = [
    { key: "all", label: "All", count: stageCounts.all ?? 0 },
    ...stages.map((s) => ({
      key: s.name.toLowerCase().replace(/\s+/g, "_"),
      label: s.name,
      count: stageCounts[s.name.toLowerCase().replace(/\s+/g, "_")] ?? 0,
    })),
  ];

  return (
    <div className="max-w-lg mx-auto">
      {/* Stage filter tabs */}
      <StageFilterTabs
        options={filterOptions}
        active={activeFilter}
        onChange={setActiveFilter}
      />

      {/* Deal cards */}
      <div className="px-4 py-3 space-y-3">
        {deals.map((deal) => (
          <SalesDealCard key={deal.deal_id} deal={deal} stages={stages} />
        ))}

        {deals.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500 text-sm">
              {activeFilter === "all"
                ? "No active deals in your pipeline."
                : `No deals in ${activeFilter.replace(/_/g, " ")}. Looking good \u2014 or time to prospect?`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
