import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi, type PortalQuoteSummary } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { AskIronAdvisorButton } from "@/components/primitives";
import { ExternalLink, FileText } from "lucide-react";

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function statusTone(label: string): string {
  if (/accepted/i.test(label)) return "bg-emerald-500/10 text-emerald-400";
  if (/changes|revised|counter/i.test(label)) return "bg-amber-500/10 text-amber-400";
  if (/declined|closed/i.test(label)) return "bg-red-500/10 text-red-400";
  return "bg-blue-500/10 text-blue-400";
}

export function PortalQuotesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["portal", "quotes"],
    queryFn: portalApi.getQuotes,
    staleTime: 15_000,
  });

  const quotes = data?.quotes ?? [];

  return (
    <PortalLayout>
      <div className="mb-4 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="border-white/10 bg-white/[0.04] p-5 text-white shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">Quote room</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Open reviews</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {quotes.filter((quote) => ["sent", "viewed"].includes(quote.status)).length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Accepted</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {quotes.filter((quote) => quote.status === "accepted").length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Quoted value</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {formatCurrency(quotes.reduce((sum, quote) => sum + (quote.amount ?? 0), 0))}
              </p>
            </div>
          </div>
        </Card>
        <Card className="border-qep-orange/20 bg-qep-orange/10 p-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">Ask Iron</p>
          <p className="mt-3 text-sm leading-6 text-white/75">
            Ask which proposal needs attention first, which quote is closest to signature, or what the customer should review next.
          </p>
          <div className="mt-4">
            <AskIronAdvisorButton
              contextType="portal-quotes"
              contextTitle="Portal quote room"
              draftPrompt="Review the current portal quote room. Which proposals need attention first, which ones are closest to acceptance, and what should the customer check next?"
              preferredSurface="sheet"
              variant="inline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              label="Ask Iron"
            />
          </div>
        </Card>
      </div>

      {isLoading && <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>}

      <div className="space-y-3">
        {quotes.map((quote: PortalQuoteSummary) => {
          const eta = quote.portal_status.eta
            ? new Date(quote.portal_status.eta).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : null;
          const updated = quote.portal_status.last_updated_at
            ? new Date(quote.portal_status.last_updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : null;

          return (
            <Card key={quote.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(quote.portal_status.label)}`}>
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
                  {quote.counter_notes ? (
                    <p className="mt-2 text-xs text-amber-500">
                      Requested changes: {quote.counter_notes}
                    </p>
                  ) : null}
                  {quote.signed_at ? (
                    <p className="mt-1 text-xs text-emerald-400">
                      Signed by {String(quote.signer_name ?? "")} on {new Date(String(quote.signed_at)).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/portal/quotes/${quote.id}`}>
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      Open quote room
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">{formatCurrency(quote.amount)}</div>
                {quote.quote_pdf_url ? (
                  <Button asChild variant="ghost" size="sm">
                    <a href={quote.quote_pdf_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      PDF
                    </a>
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}

        {!isLoading && quotes.length === 0 && (
          <Card className="border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No pending quotes.</p>
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
