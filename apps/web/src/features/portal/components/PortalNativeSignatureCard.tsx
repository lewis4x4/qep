import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PortalNativeSignatureView } from "../../../../../../shared/qep-moonshot-contracts";
import { PortalSignaturePad, signatureDataUrlToRawBase64, type PortalSignaturePadHandle } from "./PortalSignaturePad";

function formatSignedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "date unavailable";
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function PortalNativeSignatureCard({
  title,
  description,
  signedLabel = "Signed in QEP portal",
  nativeSignature,
  disabledReason,
  isSubmitting,
  onSubmit,
}: {
  title: string;
  description: string;
  signedLabel?: string;
  nativeSignature: PortalNativeSignatureView | null;
  disabledReason?: string | null;
  isSubmitting: boolean;
  onSubmit: (input: { signerName: string; signaturePngBase64: string }) => void;
}) {
  const padRef = useRef<PortalSignaturePadHandle>(null);
  const [signerName, setSignerName] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const canSubmit = signerName.trim().length > 0 && hasInk && !isSubmitting && !disabledReason;

  return (
    <Card className="border-emerald-500/20 bg-emerald-500/5 p-5">
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Native signature</p>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {nativeSignature ? (
        <div className="mt-4 rounded border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold text-emerald-200">{signedLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Signed by {nativeSignature.signerName} on {formatSignedAt(nativeSignature.signedAt)}.
          </p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            Hash {nativeSignature.documentHash.slice(0, 16)}…
          </p>
        </div>
      ) : disabledReason ? (
        <p className="mt-4 rounded border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
          {disabledReason}
        </p>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const dataUrl = padRef.current?.toDataUrl();
            if (!dataUrl || !padRef.current?.hasInk()) return;
            onSubmit({
              signerName: signerName.trim(),
              signaturePngBase64: signatureDataUrlToRawBase64(dataUrl),
            });
          }}
        >
          <div>
            <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Signer name</label>
            <Input
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
              placeholder="Type your legal name"
              className="mt-1"
              maxLength={100}
            />
          </div>
          <PortalSignaturePad ref={padRef} className="max-w-full" onInkChange={setHasInk} onClear={() => setHasInk(false)} />
          <Button type="submit" disabled={!canSubmit}>
            {isSubmitting ? "Recording signature…" : "Sign in QEP portal"}
          </Button>
          {!hasInk ? <p className="text-[11px] text-muted-foreground">Draw your signature to enable signing.</p> : null}
        </form>
      )}
    </Card>
  );
}
