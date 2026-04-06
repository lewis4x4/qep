import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CreditCard, Mail, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface PayInvoiceButtonProps {
  invoiceId: string;
  companyId: string;
  amountCents: number;
  customerEmail?: string;
  description?: string;
  className?: string;
}

interface CheckoutResponse {
  url?: string;
  fallback?: string;
  stripe_configured: boolean;
  stripe_error?: boolean;
  message?: string;
}

const PORTAL_STRIPE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal-stripe`;

/**
 * Pay-an-invoice button. Opens a Stripe Checkout session in a new tab
 * when Stripe is configured. Falls back to a mailto: payment-coordination
 * link when STRIPE_SECRET_KEY is unset on the workspace OR when Stripe
 * is unreachable. Zero-blocking per v2 §9.3.
 */
export function PayInvoiceButton({
  invoiceId, companyId, amountCents, customerEmail, description, className = "",
}: PayInvoiceButtonProps) {
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${PORTAL_STRIPE_URL}/create-checkout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invoice_id: invoiceId,
          company_id: companyId,
          amount_cents: amountCents,
          customer_email: customerEmail,
          description: description ?? `Invoice ${invoiceId}`,
          success_url: `${window.location.origin}/portal/invoices?paid=1`,
          cancel_url: `${window.location.origin}/portal/invoices`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Checkout failed" }));
        throw new Error((err as { error?: string }).error ?? "Checkout failed");
      }
      return res.json() as Promise<CheckoutResponse>;
    },
    onSuccess: (data) => {
      // Open Stripe URL or mailto fallback in new tab
      const target = data.url ?? data.fallback;
      if (target) window.open(target, "_blank");
    },
  });

  const dollars = (amountCents / 100).toFixed(2);

  return (
    <div className={className}>
      <Button
        size="sm"
        onClick={() => checkoutMutation.mutate()}
        disabled={checkoutMutation.isPending || amountCents <= 0}
      >
        {checkoutMutation.isPending ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <CreditCard className="mr-1 h-3 w-3" />
        )}
        Pay ${dollars}
      </Button>

      {checkoutMutation.isSuccess && checkoutMutation.data?.fallback && !checkoutMutation.data?.url && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-400">
          <Mail className="h-2.5 w-2.5" />
          Stripe not configured — mailto fallback opened.
        </p>
      )}
      {checkoutMutation.isError && (
        <p className="mt-1 text-[10px] text-red-400">
          {(checkoutMutation.error as Error)?.message}
        </p>
      )}
    </div>
  );
}
