import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { Check, X } from "lucide-react";
import {
  PortalSignaturePad,
  signatureDataUrlToRawBase64,
  type PortalSignaturePadHandle,
} from "../components/PortalSignaturePad";

export function PortalQuotesPage() {
  const queryClient = useQueryClient();
  const sigRef = useRef<PortalSignaturePadHandle>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["portal", "quotes"],
    queryFn: portalApi.getQuotes,
    staleTime: 15_000,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.updateQuote(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal", "quotes"] });
      setSignOpen(false);
      setPendingQuoteId(null);
      setSignerName("");
      sigRef.current?.clear();
    },
  });

  const openSign = (quoteId: string) => {
    setPendingQuoteId(quoteId);
    setSignerName("");
    sigRef.current?.clear();
    setSignOpen(true);
  };

  const confirmAccept = () => {
    const name = signerName.trim();
    if (!name || !pendingQuoteId) return;
    const dataUrl = sigRef.current?.toDataUrl();
    const base64 = dataUrl ? signatureDataUrlToRawBase64(dataUrl) : "";
    const body: Record<string, unknown> = {
      id: pendingQuoteId,
      status: "accepted",
      signer_name: name,
    };
    if (base64.length > 100) {
      body.signature_png_base64 = base64;
    }
    updateMutation.mutate(body);
  };

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Quotes & Proposals</h1>

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign to accept</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Type your full legal name and sign below. This replaces a wet signature for this quote acceptance.
          </p>
          <label className="text-sm block space-y-1">
            Full name
            <Input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Jane Q. Customer"
              autoComplete="name"
            />
          </label>
          <PortalSignaturePad ref={sigRef} className="pt-1" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSignOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!signerName.trim() || updateMutation.isPending}
              onClick={confirmAccept}
            >
              {updateMutation.isPending ? "Submitting…" : "Accept & sign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading && <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>}

      <div className="space-y-3">
        {(data?.quotes ?? []).map((quote: Record<string, unknown>) => {
          const st = String(quote.status ?? "");
          const canAct = st === "sent" || st === "viewed";
          return (
            <Card key={quote.id as string} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    st === "accepted" ? "bg-emerald-500/10 text-emerald-400" :
                    st === "rejected" ? "bg-red-500/10 text-red-400" :
                    "bg-blue-500/10 text-blue-400"
                  }`}>{st}</span>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {quote.expires_at ? `Expires: ${new Date(String(quote.expires_at)).toLocaleDateString()}` : ""}
                  </p>
                  {quote.signed_at != null && String(quote.signed_at).length > 0 ? (
                    <p className="text-xs text-emerald-400 mt-1">
                      Signed by {String(quote.signer_name ?? "")} on {new Date(String(quote.signed_at)).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
                {canAct && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateMutation.mutate({ id: quote.id, status: "rejected" })}
                      disabled={updateMutation.isPending}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => openSign(quote.id as string)}
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
