/**
 * Send Quote Section — appears after save success in Quote Builder.
 *
 * One-click sends the quote package to the customer's email via Resend.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Loader2, Mail, Send } from "lucide-react";
import { sendQuotePackage } from "../lib/quote-api";

interface SendQuoteSectionProps {
  quotePackageId: string;
  contactName?: string;
  onSent?: (result: { toEmail: string }) => void;
}

export function SendQuoteSection({ quotePackageId, contactName, onSent }: SendQuoteSectionProps) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSend() {
    setState("sending");
    setErrorMsg(null);
    try {
      const result = await sendQuotePackage(quotePackageId);
      setSentTo(result.to_email);
      onSent?.({ toEmail: result.to_email });
      setState("sent");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to send quote");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <p className="text-sm text-emerald-400 font-medium">
            Quote sent to {sentTo}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-qep-orange" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Send to {contactName || "customer"}
            </p>
            <p className="text-xs text-muted-foreground">
              Emails the proposal summary with equipment details and pricing
            </p>
          </div>
        </div>
        <Button
          onClick={handleSend}
          disabled={state === "sending"}
          className="shrink-0"
        >
          {state === "sending" ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-1 h-4 w-4" />
          )}
          {state === "sending" ? "Sending..." : "Send Quote"}
        </Button>
      </div>
      {state === "error" && errorMsg && (
        <p className="mt-2 text-xs text-rose-400">{errorMsg}</p>
      )}
    </Card>
  );
}
