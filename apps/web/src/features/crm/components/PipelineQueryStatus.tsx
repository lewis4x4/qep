import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface PipelineQueryStatusProps {
  isLoading: boolean;
  hasError: boolean;
  isHydratingRemainingDeals: boolean;
  dealHydrationWarning: string | null;
  onRetryHydration: () => void;
  showCacheBanner: boolean;
  showEmptyFilter: boolean;
}

export function PipelineQueryStatus({
  isLoading,
  hasError,
  isHydratingRemainingDeals,
  dealHydrationWarning,
  onRetryHydration,
  showCacheBanner,
  showEmptyFilter,
}: PipelineQueryStatusProps) {
  return (
    <>
      {isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading deals table">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      )}

      {hasError && !isLoading && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Unable to load deals right now. Refresh and try again.</p>
        </Card>
      )}

      {!isLoading && !hasError && isHydratingRemainingDeals && (
        <Card className="border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">Loading additional open deals in the background.</p>
        </Card>
      )}

      {!isLoading && !hasError && dealHydrationWarning && (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-amber-900">{dealHydrationWarning}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetryHydration}>
              Retry full load
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && !hasError && showCacheBanner && (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            Showing a cached pipeline snapshot while live CRM data is unavailable.
          </p>
        </Card>
      )}

      {!isLoading && !hasError && showEmptyFilter && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">No open deals matched this filter.</p>
        </Card>
      )}
    </>
  );
}
