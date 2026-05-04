import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi, type PortalQuoteSummary } from "../lib/portal-api";
import { summarizePortalQuoteReview } from "../lib/portal-quote-review";
import {
  buildPortalQuoteActionRail,
  buildPortalQuoteChecklist,
  buildPortalQuoteTimeline,
} from "../lib/portal-quote-room";
import { summarizeQuoteSigningReadiness, vesignRequirementsText } from "../lib/signing-readiness";
import { AskIronAdvisorButton } from "@/components/primitives";
import { Check, ExternalLink, PenTool, X, ArrowLeft, Clock3, ClipboardList, Building2 } from "lucide-react";
import {
  PortalSignaturePad,
  signatureDataUrlToRawBase64,
  type PortalSignaturePadHandle,
} from "../components/PortalSignaturePad";

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function PortalQuoteRoomPage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sigRef = useRef<PortalSignaturePadHandle>(null);
  const [signerName, setSignerName] = useState("");
  const [counterNotes, setCounterNotes] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "quotes"],
    queryFn: portalApi.getQuotes,
    staleTime: 15_000,
  });

  const quote = useMemo(
    () => (data?.quotes ?? []).find((item) => item.id === quoteId) ?? null,
    [data?.quotes, quoteId],
  );

  const reviewSummary = summarizePortalQuoteReview(quote?.quote_data ?? null);
  const timeline = quote ? buildPortalQuoteTimeline(quote) : [];
  const actionRail = quote ? buildPortalQuoteActionRail(quote, reviewSummary) : [];
  const checklist = quote ? buildPortalQuoteChecklist(quote, reviewSummary) : [];
  const signingReadiness = quote
    ? summarizeQuoteSigningReadiness({ signedAt: quote.signed_at, signerName: quote.signer_name, status: quote.status })
    : null;
  const revisionHistory = quote?.revision_history ?? [];
  const compare = quote?.compare_to_previous ?? null;

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.updateQuote(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["portal", "quotes"] });
    },
  });

  useEffect(() => {
    if (!quote) return;
    if (quote.status === "sent") {
      updateMutation.mutate({ id: quote.id, status: "viewed" });
    }
    // deliberate one-shot when quote changes from cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  const canAct = quote ? ["sent", "viewed"].includes(quote.status) : false;
  const canCounter = quote ? ["sent", "viewed", "countered"].includes(quote.status) : false;

  useEffect(() => {
    setCounterNotes(quote?.counter_notes ?? "");
  }, [quote?.id, quote?.counter_notes]);

  const acceptQuote = () => {
    const name = signerName.trim();
    if (!quote || !name) return;
    const dataUrl = sigRef.current?.toDataUrl();
    const base64 = dataUrl ? signatureDataUrlToRawBase64(dataUrl) : "";
    const body: Record<string, unknown> = {
      id: quote.id,
      status: "accepted",
      signer_name: name,
    };
    if (base64.length > 100) {
      body.signature_png_base64 = base64;
    }
    updateMutation.mutate(body);
  };

  const requestChanges = () => {
    if (!quote || !counterNotes.trim()) return;
    updateMutation.mutate({
      id: quote.id,
      status: "countered",
      counter_notes: counterNotes.trim(),
    });
  };

  if (isLoading) {
    return (
      <PortalLayout>
        <Card className="h-64 animate-pulse" />
      </PortalLayout>
    );
  }

  if (isError || !quote) {
    return (
      <PortalLayout>
        <Card className="border-red-500/20 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load this proposal.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/portal/quotes">
              <ArrowLeft className="mr-1 h-3 w-3" />
              Back to quote room
            </Link>
          </Button>
        </Card>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="mb-2 h-7 text-[11px]">
          <Link to="/portal/quotes">
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to quote room
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Dedicated proposal workspace</p>
            <h1 className="mt-1 text-2xl font-bold text-foreground">{quote.deal_name ?? "Proposal"}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {reviewSummary.headline ?? "Review the complete proposal, understand the pricing and terms, and decide when to accept."}
            </p>
          </div>
          <AskIronAdvisorButton
            contextType="portal-quote"
            contextId={quote.id}
            contextTitle={quote.deal_name ?? "Portal quote"}
            draftPrompt="I’m in the dedicated quote room for this proposal. Explain pricing, equipment, financing, risks, and what I should verify before accepting it."
            evidence={[
              `Deal: ${quote.deal_name ?? "Proposal"}`,
              `Status: ${quote.status}`,
              `Quoted amount: ${quote.amount ?? "unknown"}`,
              `Summary: ${reviewSummary.headline ?? "none"}`,
            ].join("\n")}
            preferredSurface="sheet"
            variant="inline"
            label="Ask Iron"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Proposal status</p>
                <p className="mt-2 text-xl font-semibold text-foreground">{quote.portal_status.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{quote.portal_status.next_action ?? "Your dealership is waiting on the next customer-side action."}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Quoted amount</p>
                <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(reviewSummary.netTotal ?? quote.amount ?? null)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {quote.expires_at ? <span>Expires {new Date(quote.expires_at).toLocaleDateString()}</span> : null}
              {quote.viewed_at ? <span>Viewed {new Date(quote.viewed_at).toLocaleDateString()}</span> : null}
              {quote.signed_at ? <span>Signed {new Date(quote.signed_at).toLocaleDateString()}</span> : null}
            </div>
          </Card>

          {reviewSummary.lineItems.length > 0 && (
            <Card className="overflow-hidden p-0">
              <div className="border-b border-border/60 px-5 py-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Scope and pricing</p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-5 py-3 font-medium">Item</th>
                    <th className="px-5 py-3 font-medium text-right">Qty</th>
                    <th className="px-5 py-3 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewSummary.lineItems.map((item, index) => (
                    <tr key={`${item.description}-${index}`} className="border-t border-border/50">
                      <td className="px-5 py-3">{item.description}</td>
                      <td className="px-5 py-3 text-right">{item.quantity ?? "—"}</td>
                      <td className="px-5 py-3 text-right">{formatCurrency(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {reviewSummary.notes.length > 0 && (
            <Card className="p-5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</p>
              <div className="mt-3 space-y-2">
                {reviewSummary.notes.map((note, index) => (
                  <p key={`${note}-${index}`} className="text-sm text-foreground">{note}</p>
                ))}
              </div>
            </Card>
          )}

          {reviewSummary.terms.length > 0 && (
            <Card className="p-5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Terms</p>
              <div className="mt-3 space-y-2">
                {reviewSummary.terms.map((term, index) => (
                  <p key={`${term}-${index}`} className="text-sm text-foreground">{term}</p>
                ))}
              </div>
            </Card>
          )}

          {compare?.has_changes ? (
            <Card className="p-5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Compare changes</p>
              <div className="mt-4 space-y-3">
                {compare.price_changes.map((line) => (
                  <div key={line} className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-foreground">{line}</div>
                ))}
                {compare.equipment_changes.map((line) => (
                  <div key={line} className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-foreground">{line}</div>
                ))}
                {compare.financing_changes.map((line) => (
                  <div key={line} className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-foreground">{line}</div>
                ))}
                {compare.terms_changes.map((line) => (
                  <div key={line} className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-foreground">{line}</div>
                ))}
                {compare.dealer_message_change ? (
                  <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-foreground">
                    Dealer response: {compare.dealer_message_change}
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {quote.counter_notes ? (
            <Card className="border-amber-500/20 bg-amber-500/5 p-5">
              <p className="text-[10px] uppercase tracking-wider text-amber-400">Requested changes</p>
              <p className="mt-3 text-sm text-foreground">{quote.counter_notes}</p>
            </Card>
          ) : null}

          {(reviewSummary.dealerMessage || reviewSummary.revisionSummary || (quote.counter_notes && quote.status !== "countered")) ? (
            <Card className="border-emerald-500/20 bg-emerald-500/5 p-5">
              <p className="text-[10px] uppercase tracking-wider text-emerald-400">Dealership response</p>
              <p className="mt-3 text-sm text-foreground">
                {reviewSummary.dealerMessage
                  ?? "Your dealership has responded with a revised proposal based on the requested changes recorded in this quote room."}
              </p>
              {reviewSummary.revisionSummary ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Revision summary: {reviewSummary.revisionSummary}
                </p>
              ) : null}
            </Card>
          ) : null}

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-qep-orange" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Proposal timeline</p>
            </div>
            <div className="mt-4 space-y-3">
              {timeline.map((item) => (
                <div key={`${item.label}-${item.at ?? "none"}`} className="flex items-start gap-3">
                  <div className={`mt-1 h-2.5 w-2.5 rounded-full ${
                    item.state === "done" ? "bg-emerald-400" : item.state === "current" ? "bg-qep-orange" : "bg-white/25"
                  }`} />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                    {item.at ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {new Date(item.at).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-qep-orange/20 bg-qep-orange/5 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-qep-orange">Decision rail</p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Net total</p>
                <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(reviewSummary.netTotal ?? quote.amount ?? null)}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Subtotal</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{formatCurrency(reviewSummary.subtotal)}</p>
                {reviewSummary.tradeAllowance != null && reviewSummary.tradeAllowance > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Trade credit {formatCurrency(reviewSummary.tradeAllowance)}</p>
                ) : null}
              </div>
              {reviewSummary.equipmentLabels.length > 0 && (
                <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Equipment</p>
                  <div className="mt-2 space-y-1">
                    {reviewSummary.equipmentLabels.map((label, index) => (
                      <p key={`${label}-${index}`} className="text-sm text-foreground">{label}</p>
                    ))}
                  </div>
                </div>
              )}
              {reviewSummary.financingHighlights.length > 0 && (
                <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Financing</p>
                  <div className="mt-2 space-y-1">
                    {reviewSummary.financingHighlights.map((line, index) => (
                      <p key={`${line}-${index}`} className="text-sm text-foreground">{line}</p>
                    ))}
                  </div>
                </div>
              )}
              {quote.quote_pdf_url ? (
                <Button asChild variant="outline" className="justify-start">
                  <a href={quote.quote_pdf_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open proposal PDF
                  </a>
                </Button>
              ) : null}
            </div>
          </Card>

          {revisionHistory.length > 0 ? (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-qep-orange" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Revision history</p>
              </div>
              <div className="mt-4 space-y-3">
                {revisionHistory.map((revision) => (
                  <div key={revision.id} className="rounded-lg border border-border/60 bg-background/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">Version {revision.version_number}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        revision.is_current && quote.status === "accepted"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : revision.is_current && quote.status === "rejected"
                            ? "bg-red-500/10 text-red-400"
                            : revision.is_current
                              ? "bg-qep-orange/15 text-qep-orange"
                              : "bg-white/10 text-muted-foreground"
                      }`}>
                        {revision.is_current
                          ? quote.status === "accepted"
                            ? "accepted"
                            : quote.status === "rejected"
                              ? "declined"
                              : "current"
                          : "superseded"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Published {new Date(revision.published_at).toLocaleDateString()}
                    </p>
                    {revision.revision_summary ? (
                      <p className="mt-2 text-sm text-foreground">{revision.revision_summary}</p>
                    ) : null}
                    {revision.dealer_message ? (
                      <p className="mt-1 text-xs text-muted-foreground">{revision.dealer_message}</p>
                    ) : null}
                    {revision.customer_request_snapshot ? (
                      <p className="mt-2 text-xs text-amber-500">Customer request: {revision.customer_request_snapshot}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-qep-orange" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Dealership actions</p>
            </div>
            <div className="mt-4 space-y-3">
              {actionRail.map((item) => (
                <div key={item.title} className={`rounded-lg border p-3 ${
                  item.tone === "emerald"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : item.tone === "amber"
                      ? "border-amber-500/20 bg-amber-500/5"
                      : "border-border/60 bg-background/70"
                }`}>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-qep-orange" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Customer checklist</p>
            </div>
            <div className="mt-4 space-y-2">
              {checklist.map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${item.done ? "bg-emerald-400" : "bg-white/25"}`} />
                  <p className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</p>
                </div>
              ))}
            </div>
            {quote.counter_notes && quote.status !== "countered" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                A revised proposal is now available. Re-review the scope, pricing, and financing before deciding.
              </p>
            ) : null}
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <PenTool className="h-4 w-4 text-qep-orange" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Native QEP acceptance</p>
            </div>

            {signingReadiness ? (
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-amber-300">{signingReadiness.label} · {signingReadiness.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{signingReadiness.detail}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  VESign remains blocked pending {vesignRequirementsText()}.
                </p>
              </div>
            ) : null}

            {quote.signed_at ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold text-emerald-400">Proposal accepted</p>
                <p className="text-sm text-muted-foreground">
                  Signed by {quote.signer_name ?? "customer"} on {new Date(quote.signed_at).toLocaleDateString()}.
                </p>
                <Button variant="outline" onClick={() => navigate("/portal/quotes")}>
                  Back to quote room
                </Button>
              </div>
            ) : canAct ? (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Review the proposal, enter your legal name, and sign below to accept in the native QEP portal. This does not send a VESign provider envelope.
                </p>
                <label className="block space-y-1 text-sm">
                  Full legal name
                  <Input
                    value={signerName}
                    onChange={(event) => setSignerName(event.target.value)}
                    placeholder="Jane Q. Customer"
                    autoComplete="name"
                  />
                </label>
                <PortalSignaturePad ref={sigRef} className="pt-1" />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate({ id: quote.id, status: "rejected" })}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Decline
                  </Button>
                  <Button
                    variant="outline"
                    disabled={updateMutation.isPending || !counterNotes.trim()}
                    onClick={requestChanges}
                  >
                    Request changes
                  </Button>
                  <Button
                    disabled={!signerName.trim() || updateMutation.isPending}
                    onClick={acceptQuote}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {updateMutation.isPending ? "Submitting…" : "Accept & sign"}
                  </Button>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Requested changes / counter-offer</p>
                  <textarea
                    value={counterNotes}
                    onChange={(event) => setCounterNotes(event.target.value)}
                    placeholder="Example: Please revise the monthly payment target, remove one attachment, or adjust the trade allowance."
                    className="mt-3 min-h-[110px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
                  />
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    This sends your requested changes back to the dealership and moves the proposal into revision.
                  </p>
                </div>
              </div>
            ) : quote.status === "countered" ? (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-amber-400">Requested changes sent</p>
                <p className="text-sm text-muted-foreground">
                  The dealership is reviewing your requested changes and will publish a revised proposal back into this room.
                </p>
                <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Requested changes / counter-offer</p>
                  <textarea
                    value={counterNotes}
                    onChange={(event) => setCounterNotes(event.target.value)}
                    placeholder="Clarify what you want revised."
                    className="mt-3 min-h-[110px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
                  />
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      disabled={updateMutation.isPending || !counterNotes.trim()}
                      onClick={requestChanges}
                    >
                      Update requested changes
                    </Button>
                    <Button variant="outline" onClick={() => navigate("/portal/quotes")}>
                      Back to quote room
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  This proposal is no longer awaiting signature.
                </p>
                <Button variant="outline" onClick={() => navigate("/portal/quotes")}>
                  Back to quote room
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
}
