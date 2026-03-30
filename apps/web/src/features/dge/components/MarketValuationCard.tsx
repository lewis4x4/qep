import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MarketValuationResult } from "../types";

interface MarketValuationCardProps {
  data: MarketValuationResult | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function confidenceLabel(score: number): "High" | "Medium" | "Low" {
  if (score >= 0.8) return "High";
  if (score >= 0.5) return "Medium";
  return "Low";
}

function badgeTone(badge: string): "default" | "secondary" | "outline" {
  if (badge === "LIVE") return "default";
  if (badge === "DEMO") return "outline";
  return "secondary";
}

export function MarketValuationCard({
  data,
  loading,
  error,
  onRefresh,
}: MarketValuationCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold">Market Intelligence</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void onRefresh();
            }}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="space-y-2">
            <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
            <div className="h-8 w-1/2 rounded bg-muted animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && (
          <p className="text-sm text-muted-foreground">
            Select equipment to load a market valuation snapshot.
          </p>
        )}

        {!loading && !error && data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {data.data_badges.map((badge) => (
                <Badge key={badge} variant={badgeTone(badge)}>
                  {badge}
                </Badge>
              ))}
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated FMV</p>
              <p className="text-2xl font-semibold text-foreground">
                {formatCurrency(data.estimated_fmv)}
              </p>
              <p className="text-sm text-muted-foreground">
                Range {formatCurrency(data.low_estimate)} to {formatCurrency(data.high_estimate)}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border bg-background p-2">
                <p className="text-xs text-muted-foreground">Confidence</p>
                <p className="text-sm font-medium text-foreground">
                  {confidenceLabel(data.confidence_score)} ({Math.round(data.confidence_score * 100)}%)
                </p>
              </div>
              <div className="rounded-md border bg-background p-2">
                <p className="text-xs text-muted-foreground">Expires</p>
                <p className="text-sm font-medium text-foreground">
                  {new Date(data.expires_at).toLocaleDateString("en-US")}
                </p>
              </div>
            </div>

            {data.source_breakdown.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Source Breakdown</p>
                {data.source_breakdown.map((item) => (
                  <div key={item.source} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{item.source}</span>
                    <span className="font-medium text-foreground">
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
