import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { Check, X } from "lucide-react";

export function PortalQuotesPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["portal", "quotes"],
    queryFn: portalApi.getQuotes,
    staleTime: 15_000,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.updateQuote(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portal", "quotes"] }),
  });

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Quotes & Proposals</h1>

      {isLoading && <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>}

      <div className="space-y-3">
        {(data?.quotes ?? []).map((quote: any) => {
          const canAct = quote.status === "sent" || quote.status === "viewed";
          return (
            <Card key={quote.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    quote.status === "accepted" ? "bg-emerald-500/10 text-emerald-400" :
                    quote.status === "rejected" ? "bg-red-500/10 text-red-400" :
                    "bg-blue-500/10 text-blue-400"
                  }`}>{quote.status}</span>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {quote.expires_at ? `Expires: ${new Date(quote.expires_at).toLocaleDateString()}` : ""}
                  </p>
                  {quote.signed_at && (
                    <p className="text-xs text-emerald-400 mt-1">
                      Signed by {quote.signer_name} on {new Date(quote.signed_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {canAct && (
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="outline"
                      onClick={() => updateMutation.mutate({ id: quote.id, status: "rejected" })}
                      disabled={updateMutation.isPending}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        const name = prompt("Enter your full name to sign:");
                        if (name) updateMutation.mutate({ id: quote.id, status: "accepted", signer_name: name });
                      }}
                      disabled={updateMutation.isPending}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Accept & Sign
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        {!isLoading && (data?.quotes ?? []).length === 0 && (
          <Card className="border-dashed p-6 text-center"><p className="text-sm text-muted-foreground">No pending quotes.</p></Card>
        )}
      </div>
    </PortalLayout>
  );
}
