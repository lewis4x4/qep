import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Sparkles } from "lucide-react";
import { searchCatalog, getAiEquipmentRecommendation } from "../lib/quote-api";

type AvailabilityStatus = "in_stock" | "in_transit" | "source_required";

interface CatalogEntry {
  id: string;
  sourceCatalog?: "qb_equipment_models" | "qb_attachments" | "catalog_entries" | "manual";
  sourceId?: string | null;
  dealerCost?: number | null;
  make: string;
  model: string;
  year: number | null;
  category: string | null;
  list_price: number | null;
  stock_number: string | null;
  condition: string | null;
  availabilityStatus?: AvailabilityStatus;
  availability_status?: AvailabilityStatus;
  attachments: Array<{ id: string; name: string; price: number }>;
}

function availabilityStatus(entry: CatalogEntry): AvailabilityStatus {
  if (entry.availabilityStatus) return entry.availabilityStatus;
  if (entry.availability_status) return entry.availability_status;
  const condition = entry.condition?.toLowerCase() ?? "";
  if (condition.includes("transit")) return "in_transit";
  if (entry.stock_number) return "in_stock";
  return "source_required";
}

function availabilityCopy(status: AvailabilityStatus): { label: string; className: string } {
  if (status === "in_stock") {
    return { label: "In stock", className: "bg-emerald-500/10 text-emerald-400" };
  }
  if (status === "in_transit") {
    return { label: "In transit", className: "bg-blue-500/10 text-blue-300" };
  }
  return { label: "Source required", className: "bg-amber-500/10 text-amber-300" };
}

interface EquipmentSelectorProps {
  onSelect: (entry: CatalogEntry) => void;
  onRecommendation: (rec: { machine: string; attachments: string[]; reasoning: string }) => void;
}

export function EquipmentSelector({ onSelect, onRecommendation }: EquipmentSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [results, setResults] = useState<CatalogEntry[]>([]);
  const [mode, setMode] = useState<"search" | "ai">("search");

  const searchMutation = useMutation({
    mutationFn: async () => {
      const data = await searchCatalog(searchQuery);
      setResults(data);
    },
  });

  const aiMutation = useMutation({
    mutationFn: async () => {
      const data = await getAiEquipmentRecommendation(jobDescription);
      onRecommendation(data);
    },
  });

  return (
    <Card className="p-4 space-y-4">
      <div className="flex gap-2">
        <Button
          size="sm" variant={mode === "search" ? "default" : "outline"}
          onClick={() => setMode("search")}
        >
          <Search className="mr-1 h-3.5 w-3.5" /> Search Catalog
        </Button>
        <Button
          size="sm" variant={mode === "ai" ? "default" : "outline"}
          onClick={() => setMode("ai")}
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" /> AI Recommend
        </Button>
      </div>

      {mode === "search" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by make, model, or category..."
              className="flex-1 rounded border border-input bg-card px-3 py-2 text-sm"
              onKeyDown={(e) => e.key === "Enter" && searchMutation.mutate()}
            />
            <Button size="sm" onClick={() => searchMutation.mutate()} disabled={searchMutation.isPending}>
              Search
            </Button>
          </div>

          {results.length > 0 && (
            <div className="max-h-60 overflow-y-auto space-y-2">
              {results.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onSelect(entry)}
                  className="w-full rounded border border-border bg-card p-3 text-left text-sm hover:border-primary transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold">{entry.make} {entry.model} {entry.year && `(${entry.year})`}</div>
                    {(() => {
                      const copy = availabilityCopy(availabilityStatus(entry));
                      return (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${copy.className}`}>
                          {copy.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {entry.category} {entry.condition && `• ${entry.condition}`}
                    {entry.stock_number && ` • Stock #${entry.stock_number}`}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {entry.attachments.length} compatible option{entry.attachments.length === 1 ? "" : "s"}
                  </div>
                  {entry.list_price && (
                    <div className="mt-1 font-medium text-qep-orange">
                      ${entry.list_price.toLocaleString()}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {results.length === 0 && searchQuery && !searchMutation.isPending && (
            <p className="text-xs text-muted-foreground">No equipment found. Try a different search or use AI recommendation.</p>
          )}
        </div>
      )}

      {mode === "ai" && (
        <div className="space-y-3">
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Describe the job: e.g., 'Land clearing and tree service on rocky terrain, need to handle 12-inch trees...'"
            className="w-full rounded border border-input bg-card px-3 py-2 text-sm min-h-[80px]"
          />
          <Button size="sm" onClick={() => aiMutation.mutate()} disabled={aiMutation.isPending || !jobDescription.trim()}>
            {aiMutation.isPending ? "Analyzing..." : "Get AI Recommendation"}
          </Button>
        </div>
      )}
    </Card>
  );
}
