import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
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
import { portalApi, type PortalQuoteSummary } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { summarizePortalQuoteReview } from "../lib/portal-quote-review";
import { Check, ExternalLink, FileText, X } from "lucide-react";
import {
  PortalSignaturePad,
  signatureDataUrlToRawBase64,
  type PortalSignaturePadHandle,
} from "../components/PortalSignaturePad";

export function PortalQuotesPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const sigRef = useRef<PortalSignaturePadHandle>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["portal", "quotes"],
    queryFn: portalApi.getQuotes,
    staleTime: 15_000,
  });

  useEffect(() => {
    const target = location.hash.replace(/^#/, "");
    if (!target) return;
    const el = document.getElementById(`portal-quote-${target}`);
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [location.hash, data?.quotes]);

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

  const reviewMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.updateQuote(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portal", "quotes"] }),
  });

  const selectedQuote = (data?.quotes ?? []).find((quote) => quote.id === selectedQuoteId) ?? null;
  const reviewSummary = summarizePortalQuoteReview(selectedQuote?.quote_data ?? null);

  const openReview = (quote: PortalQuoteSummary) => {
    setSelectedQuoteId(quote.id);
    setReviewOpen(true);
    if (quote.status === "sent") {
      reviewMutation.mutate({ id: quote.id, status: "viewed" });
    }
  };

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

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review proposal</DialogTitle>
          </DialogHeader>
          {selectedQuote && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {selectedQuote.deal_name ?? "Proposal"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {reviewSummary.headline ?? "Review the proposal details below before accepting or declining."}
                    </p>
                  </div>
                  {selectedQuote.amount != null ? (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Quoted amount</p>
                      <p className="text-sm font-semibold text-foreground">
                        {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(selectedQuote.amount)}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  {selectedQuote.expires_at ? <span>Expires {new Date(selectedQuote.expires_at).toLocaleDateString()}</span> : null}
                  {selectedQuote.viewed_at ? <span>Viewed {new Date(selectedQuote.viewed_at).toLocaleDateString()}</span> : null}
                  {selectedQuote.signed_at ? <span>Signed {new Date(selectedQuote.signed_at).toLocaleDateString()}</span> : null}
                </div>
              </div>

              {reviewSummary.lineItems.length > 0 && (
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">Item</th>
                        <th className="px-3 py-2 font-medium text-right">Qty</th>
                        <th className="px-3 py-2 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewSummary.lineItems.map((item, index) => (
                        <tr key={`${item.description}-${index}`} className="border-t border-border/50">
                          <td className="px-3 py-2">{item.description}</td>
                          <td className="px-3 py-2 text-right">{item.quantity ?? "—"}</td>
                          <td className="px-3 py-2 text-right">
                            {item.amount == null
                              ? "—"
                              : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {reviewSummary.notes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                  <div className="space-y-1">
                    {reviewSummary.notes.map((note, index) => (
                      <p key={`${note}-${index}`} className="text-sm text-foreground">{note}</p>
                    ))}
                  </div>
                </div>
              )}

              {reviewSummary.terms.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Terms</p>
                  <div className="space-y-1">
                    {reviewSummary.terms.map((term, index) => (
                      <p key={`${term}-${index}`} className="text-sm text-foreground">{term}</p>
                    ))}
                  </div>
                </div>
              )}

              {selectedQuote.quote_pdf_url ? (
                <div className="flex justify-end">
                  <Button asChild variant="outline" size="sm">
                    <a href={selectedQuote.quote_pdf_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      Open proposal PDF
                    </a>
                  </Button>
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
              Close
            </Button>
            {selectedQuote && (selectedQuote.status === "sent" || selectedQuote.status === "viewed") ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: selectedQuote.id, status: "rejected" })}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Decline
                </Button>
                <Button
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => {
                    setReviewOpen(false);
                    openSign(selectedQuote.id);
                  }}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Accept & sign
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        {(data?.quotes ?? []).map((quote: PortalQuoteSummary) => {
          const st = String(quote.status ?? "");
          const canAct = st === "sent" || st === "viewed";
          const eta = quote.portal_status.eta
            ? new Date(quote.portal_status.eta).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : null;
          const updated = quote.portal_status.last_updated_at
            ? new Date(quote.portal_status.last_updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : null;
          return (
            <Card key={quote.id} id={`portal-quote-${quote.id}`} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      /accepted/i.test(quote.portal_status.label) ? "bg-emerald-500/10 text-emerald-400" :
                      /declined|closed/i.test(quote.portal_status.label) ? "bg-red-500/10 text-red-400" :
                      "bg-blue-500/10 text-blue-400"
                    }`}>
                      {quote.portal_status.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{quote.portal_status.source_label}</span>
                  </div>
                  {quote.deal_name && (
                    <p className="mt-2 text-sm font-semibold text-foreground">{quote.deal_name}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {quote.expires_at ? <span>Expires: {new Date(String(quote.expires_at)).toLocaleDateString()}</span> : null}
                    {eta ? <span>ETA: <span className="text-foreground font-medium">{eta}</span></span> : null}
                    {updated ? <span>Last updated: {updated}</span> : null}
                  </div>
                  {quote.portal_status.next_action && (
                    <p className="mt-2 text-xs text-foreground">{quote.portal_status.next_action}</p>
                  )}
                  {quote.signed_at != null && String(quote.signed_at).length > 0 ? (
                    <p className="text-xs text-emerald-400 mt-1">
                      Signed by {String(quote.signer_name ?? "")} on {new Date(String(quote.signed_at)).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openReview(quote)}
                    disabled={updateMutation.isPending || reviewMutation.isPending}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" /> Review proposal
                  </Button>
                </div>
              </div>
              {quote.deal_id && (
                <div className="mt-3 flex justify-end">
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/portal/deals`}>
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      View deal overview
                    </Link>
                  </Button>
                </div>
              )}
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
