import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CreditCard, Mail, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getPortalErrorMessage, normalizePortalCheckoutResponse, type PortalCheckoutResponse } from "../lib/portal-row-normalizers";

interface PayInvoiceButtonProps {
  invoiceId: string;
  companyId: string;
  amountCents: number;
  customerEmail?: string;
  description?: string;
  className?: string;
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
    mutationFn: async (popup: Window | null) => {
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
        // Close the popup we pre-opened so the user isn't left with a blank tab
        try { popup?.close(); } catch { /* noop */ }
        const err = await res.json().catch(() => null);
        throw new Error(getPortalErrorMessage(err) ?? "Checkout failed");
      }
      const data: PortalCheckoutResponse = normalizePortalCheckoutResponse(await res.json().catch(() => null));
      // Navigate the pre-opened popup (preserves the user-gesture chain so
      // popup blockers do not bite). If the popup was blocked at click time,
      // fall back to current-tab navigation.
      const target = data.url ?? data.fallback;
      if (target) {
        if (popup && !popup.closed) {
          popup.location.href = target;
        } else {
          // Fallback: use current tab if popup got blocked anyway
          window.location.href = target;
        }
      } else {
        try { popup?.close(); } catch { /* noop */ }
      }
      return data;
    },
  });

  const dollars = (amountCents / 100).toFixed(2);

  function handleClick() {
    if (checkoutMutation.isPending || amountCents <= 0) return;
    // Open the popup SYNCHRONOUSLY inside the click handler so the
    // browser's user-gesture context is preserved. We point it at
    // about:blank for now and rewrite the URL once the fetch resolves.
    const popup = window.open("about:blank", "_blank");
    checkoutMutation.mutate(popup);
  }

  return (
    <div className={className}>
      <Button
        size="sm"
        onClick={handleClick}
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
