import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Sparkles } from "lucide-react";
import { searchCatalog, getAiEquipmentRecommendation } from "../lib/quote-api";

interface CatalogEntry {
  id: string;
  make: string;
  model: string;
  year: number | null;
  category: string | null;
  list_price: number | null;
  stock_number: string | null;
  condition: string | null;
  attachments: Array<{ name: string; price: number }>;
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
                  <div className="font-semibold">{entry.make} {entry.model} {entry.year && `(${entry.year})`}</div>
                  <div className="text-xs text-muted-foreground">
                    {entry.category} {entry.condition && `• ${entry.condition}`}
                    {entry.stock_number && ` • Stock #${entry.stock_number}`}
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
