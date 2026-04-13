import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRepPipeline, fetchDealStages } from "../lib/sales-api";

export function useSalesPipeline() {
  const [activeFilter, setActiveFilter] = useState("all");

  const pipelineQuery = useQuery({
    queryKey: ["sales", "pipeline"],
    queryFn: fetchRepPipeline,
    staleTime: 5 * 60 * 1000,
  });

  const stagesQuery = useQuery({
    queryKey: ["sales", "deal-stages"],
    queryFn: fetchDealStages,
    staleTime: 60 * 60 * 1000, // Stages rarely change
  });

  const allDeals = pipelineQuery.data ?? [];
  const stages = stagesQuery.data ?? [];

  const filteredDeals =
    activeFilter === "all"
      ? allDeals
      : allDeals.filter(
          (d) => d.stage.toLowerCase().replace(/\s+/g, "_") === activeFilter,
        );

  // Compute stage counts for filter badges
  const stageCounts: Record<string, number> = { all: allDeals.length };
  for (const deal of allDeals) {
    const key = deal.stage.toLowerCase().replace(/\s+/g, "_");
    stageCounts[key] = (stageCounts[key] ?? 0) + 1;
  }

  return {
    deals: filteredDeals,
    allDeals,
    stages,
    activeFilter,
    setActiveFilter,
    stageCounts,
    isLoading: pipelineQuery.isLoading,
    error: pipelineQuery.error,
  };
}
