import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  PortalSignaturePad,
  type PortalSignaturePadHandle,
} from "@/features/portal/components/PortalSignaturePad";

/**
 * L9.5 — public rental quote page (/rq/:token). Tokened, unauthenticated:
 * the share_token is the sole authorization (equipment deal-room model).
 * Customer reviews the quoted terms and signs; signing reserves the
 * contract at the signed rates.
 */

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rental-quote-public`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface PublicQuote {
  contract_number: string | null;
  lifecycle_state: string;
  company_name: string | null;
  equipment: { label: string | null } | null;
  start_date: string | null;
  end_date: string | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  deposit_required: boolean;
  deposit_amount: number | null;
  delivery_mode: string | null;
  dealer_notes: string | null;
  rpo_eligible: boolean;
  rpo_purchase_price: number | null;
  signature: { signer_name: string | null; signed_at: string | null } | null;
}

async function callPublic(body: Record<string, unknown>) {
  const res = await fetch(FN_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(payload.error ?? `Request failed (${res.status})`));
  return payload;
}

function rate(value: number | null): string {
  return value != null ? `$${Number(value).toLocaleString()}` : "—";
}

export function RentalQuotePublicPage() {
  const { token } = useParams<{ token: string }>();
  const padRef = useRef<PortalSignaturePadHandle>(null);
  const [signerName, setSignerName] = useState("");
  const [signedState, setSignedState] = useState<string | null>(null);

  const quoteQuery = useQuery({
    queryKey: ["rental-quote-public", token],
    enabled: Boolean(token),
    retry: false,
    queryFn: async () => (await callPublic({ action: "read", token })).quote as PublicQuote,
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      const dataUrl = padRef.current?.toDataUrl();
      if (!dataUrl) throw new Error("Draw your signature first.");
      return callPublic({
        action: "sign",
        token,
        signer_name: signerName.trim(),
        signature_data_url: dataUrl,
      });
    },
    onSuccess: (result) => {
      setSignedState(String(result.lifecycle_state ?? "reserved"));
      void quoteQuery.refetch();
    },
  });

  const quote = quoteQuery.data;
  const alreadySigned = Boolean(quote?.signature) || signedState !== null;
  const signable = quote?.lifecycle_state === "quoted" && !alreadySigned;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-500">
        QEP Equipment &amp; Parts
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Rental quote</h1>

      {quoteQuery.isLoading ? (
        <Card className="mt-6 h-48 animate-pulse" />
      ) : quoteQuery.isError || !quote ? (
        <Card className="mt-6 p-6">
          <p className="text-sm text-muted-foreground">
            {quoteQuery.error instanceof Error
              ? quoteQuery.error.message
              : "This quote link is invalid or has been withdrawn. Contact the dealership."}
          </p>
        </Card>
      ) : (
        <>
          <Card className="mt-6 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">
                  {quote.contract_number ?? "Rental quote"}
                  {quote.company_name ? ` — ${quote.company_name}` : ""}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {quote.equipment?.label ?? "Equipment TBD"}
                </p>
              </div>
              <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {quote.lifecycle_state}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Start</p>
                <p className="mt-0.5 font-medium">{quote.start_date ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">End</p>
                <p className="mt-0.5 font-medium">{quote.end_date ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Daily</p>
                <p className="mt-0.5 font-medium tabular-nums">{rate(quote.daily_rate)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Weekly / Monthly</p>
                <p className="mt-0.5 font-medium tabular-nums">
                  {rate(quote.weekly_rate)} / {rate(quote.monthly_rate)}
                </p>
              </div>
            </div>

            {quote.deposit_required ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Deposit required{quote.deposit_amount != null ? `: $${Number(quote.deposit_amount).toLocaleString()}` : ""}.
              </p>
            ) : null}
            {quote.rpo_eligible ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Rental-purchase option available
                {quote.rpo_purchase_price != null
                  ? ` — buyout $${Number(quote.rpo_purchase_price).toLocaleString()}`
                  : ""}.
              </p>
            ) : null}
            {quote.dealer_notes ? (
              <p className="mt-3 rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                {quote.dealer_notes}
              </p>
            ) : null}
          </Card>

          <Card className="mt-4 p-5">
            {alreadySigned ? (
              <div>
                <p className="text-sm font-semibold text-emerald-500">
                  {signedState ? "Quote signed — your rental is reserved." : "This quote has been signed."}
                </p>
                {quote.signature ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Signed by {quote.signature.signer_name}
                    {quote.signature.signed_at
                      ? ` on ${new Date(quote.signature.signed_at).toLocaleString()}`
                      : ""}.
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  The dealership will confirm delivery details{quote.deposit_required ? " and the deposit" : ""} next.
                </p>
              </div>
            ) : signable ? (
              <div>
                <p className="text-sm font-semibold">Accept and sign</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Signing accepts the quoted rates and reserves the unit for your dates.
                </p>
                <div className="mt-3 space-y-3">
                  <Input
                    placeholder="Your full name"
                    value={signerName}
                    onChange={(event) => setSignerName(event.target.value)}
                  />
                  <PortalSignaturePad ref={padRef} />
                  <Button
                    type="button"
                    disabled={!signerName.trim() || signMutation.isPending}
                    onClick={() => signMutation.mutate()}
                  >
                    {signMutation.isPending ? "Signing…" : "Sign and reserve"}
                  </Button>
                  {signMutation.isError ? (
                    <p className="text-xs text-destructive">
                      {signMutation.error instanceof Error ? signMutation.error.message : "Signing failed."}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This quote is not open for signing (state: {quote.lifecycle_state}). Contact the dealership.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
