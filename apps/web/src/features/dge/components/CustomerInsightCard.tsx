import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CustomerProfileResponse } from "../types";

interface CustomerInsightCardProps {
  data: CustomerProfileResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}

function personaLabel(value: string | null): string {
  if (!value) return "Unknown";
  return value
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function CustomerInsightCard({
  data,
  loading,
  error,
  onRefresh,
}: CustomerInsightCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold">Customer DNA</CardTitle>
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
            No existing customer profile was found for this contact yet.
          </p>
        )}

        {!loading && !error && data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{personaLabel(data.pricing_persona)}</Badge>
              {data.data_badges.map((badge) => (
                <Badge key={badge} variant="outline">{badge}</Badge>
              ))}
            </div>

            <div>
              <p className="text-sm font-medium text-foreground">{data.customer_name}</p>
              {data.company_name && (
                <p className="text-xs text-muted-foreground">{data.company_name}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Persona confidence {Math.round(data.persona_confidence * 100)}%
              </p>
            </div>

            {data.persona_reasoning && (
              <p className="text-sm text-muted-foreground">{data.persona_reasoning}</p>
            )}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-md border p-2">
                <p className="text-xs text-muted-foreground">LTV</p>
                <p className="text-sm font-medium text-foreground">
                  {formatCurrency(data.total_lifetime_value)}
                </p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xs text-muted-foreground">Deals</p>
                <p className="text-sm font-medium text-foreground">{data.total_deals}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xs text-muted-foreground">Avg Deal Size</p>
                <p className="text-sm font-medium text-foreground">
                  {formatCurrency(data.avg_deal_size)}
                </p>
              </div>
            </div>

            {data.behavioral_signals && (
              <div className="space-y-1.5 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Behavioral Signals
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Discount</span>
                  <span className="font-medium text-foreground">
                    {data.behavioral_signals.avg_discount_pct ?? 0}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Attachment Rate</span>
                  <span className="font-medium text-foreground">
                    {Math.round((data.behavioral_signals.attachment_rate ?? 0) * 100)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service Contract Rate</span>
                  <span className="font-medium text-foreground">
                    {Math.round((data.behavioral_signals.service_contract_rate ?? 0) * 100)}%
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
