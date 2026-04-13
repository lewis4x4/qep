import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Swords, ExternalLink } from "lucide-react";
import { getCompetitorListings } from "../lib/quote-api";

interface CompetitiveBattleCardProps {
  make: string;
  model?: string;
}

export function CompetitiveBattleCard({ make, model }: CompetitiveBattleCardProps) {
  const query = useQuery({
    queryKey: ["quote-builder", "competitors", make, model],
    queryFn: () => getCompetitorListings(make, model),
    enabled: Boolean(make),
    staleTime: 60_000,
  });

  const listings = query.data?.listings ?? [];

  if (!make) return null;
  if (query.isLoading) {
    return (
      <Card className="p-4 animate-pulse">
        <div className="h-4 w-32 rounded bg-muted" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Competitor intel unavailable</p>
      </Card>
    );
  }
  if (listings.length === 0) return null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Swords className="h-4 w-4 text-qep-orange" />
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Competitor Intel</p>
      </div>

      <div className="space-y-2">
        {listings.slice(0, 4).map((l) => (
          <div key={l.id} className="flex items-start justify-between gap-2 border-b border-border/40 pb-2 last:border-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">
                {l.make} {l.model} {l.year ? `(${l.year})` : ""}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">{l.dealer_name}</p>
            </div>
            <div className="text-right shrink-0 flex items-center gap-1">
              <span className="text-xs font-semibold text-foreground">
                {l.asking_price != null ? `$${l.asking_price.toLocaleString()}` : "—"}
              </span>
              {l.listing_url && (
                <a
                  href={l.listing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
