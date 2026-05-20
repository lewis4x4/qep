/**
 * Send Quote Section — customer email send surface.
 *
 * The component deliberately does not call the send API directly. Its parent
 * must provide the immutable artifact-generating send callback so every visible
 * email send uses the versioned PDF path.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Loader2, Mail, Send } from "lucide-react";

export interface SendQuoteSectionResult {
  ok: boolean;
  toEmail?: string | null;
  versionNumber?: number | null;
  message?: string | null;
  error?: string | null;
}

interface SendQuoteSectionProps {
  quotePackageId?: string | null;
  contactName?: string;
  onSendQuote?: () => Promise<SendQuoteSectionResult>;
  onSent?: (result: { toEmail: string | null; versionNumber: number | null }) => void;
}

export function SendQuoteSection({ quotePackageId, contactName, onSendQuote, onSent }: SendQuoteSectionProps) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const sendUnavailableReason = !quotePackageId
    ? "Save this quote before sending."
    : !onSendQuote
      ? "Versioned PDF send is not wired for this surface. Use the Send step so a fresh immutable PDF is generated."
      : null;

  async function handleSend() {
    if (!onSendQuote || sendUnavailableReason) {
      setState("error");
      setErrorMsg(sendUnavailableReason ?? "Versioned PDF send is not available from this surface.");
      return;
    }
    setState("sending");
    setErrorMsg(null);
    try {
      const result = await onSendQuote();
      if (result.ok !== true) {
        throw new Error(result.error || result.message || "Failed to send quote");
      }
      const toEmail = result.toEmail ?? null;
      const nextVersionNumber = result.versionNumber ?? null;
      setSentTo(toEmail);
      setVersionNumber(nextVersionNumber);
      onSent?.({ toEmail, versionNumber: nextVersionNumber });
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
          <p className="text-sm font-medium text-emerald-400">
            Quote sent{sentTo ? ` to ${sentTo}` : ""}{versionNumber ? ` with PDF v${versionNumber}` : " through the versioned PDF workflow"}.
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
              Generates a fresh immutable PDF version, emails the proposal, and records the sent artifact.
            </p>
          </div>
        </div>
        <Button
          onClick={handleSend}
          disabled={state === "sending" || Boolean(sendUnavailableReason)}
          className="shrink-0"
          title={sendUnavailableReason ?? undefined}
        >
          {state === "sending" ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-1 h-4 w-4" />
          )}
          {state === "sending" ? "Sending..." : "Send Quote"}
        </Button>
      </div>
      {sendUnavailableReason && (
        <p className="mt-2 text-xs text-amber-300">{sendUnavailableReason}</p>
      )}
      {state === "error" && errorMsg && (
        <p className="mt-2 text-xs text-rose-400">{errorMsg}</p>
      )}
    </Card>
  );
}
