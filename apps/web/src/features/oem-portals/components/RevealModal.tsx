import { useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff, Lock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { vaultApi, type RevealPayload } from "../lib/vault-api";

type Stage = "prompt" | "loading" | "revealed" | "cleared" | "error";

interface RevealModalProps {
  open: boolean;
  credentialId: string;
  credentialLabel: string;
  onOpenChange: (open: boolean) => void;
}

export function RevealModal({ open, credentialId, credentialLabel, onOpenChange }: RevealModalProps) {
  const [stage, setStage] = useState<Stage>("prompt");
  const [reason, setReason] = useState("");
  const [payload, setPayload] = useState<RevealPayload | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [showSecret, setShowSecret] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Reset when the modal closes.
  useEffect(() => {
    if (!open) {
      clearSecret();
      setStage("prompt");
      setReason("");
      setErrorMsg(null);
      setShowSecret(false);
    }
  }, [open]);

  function clearSecret() {
    setPayload(null);
    setRemainingMs(0);
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function handleReveal() {
    setStage("loading");
    setErrorMsg(null);
    try {
      const res = await vaultApi.reveal(credentialId, reason.trim() || null);
      setPayload(res);
      setRemainingMs(res.expires_in_ms);
      setStage("revealed");
      const start = Date.now();
      intervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - start;
        const left = res.expires_in_ms - elapsed;
        if (left <= 0) {
          clearSecret();
          // Best-effort clipboard wipe — user may have copied.
          void navigator.clipboard?.writeText("").catch(() => {});
          setStage("cleared");
        } else {
          setRemainingMs(left);
        }
      }, 200);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStage("error");
    }
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  const countdownSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Reveal credential
          </DialogTitle>
          <DialogDescription>
            {credentialLabel} · plaintext clears after 30 s. Your reveal is audited.
          </DialogDescription>
        </DialogHeader>

        {stage === "prompt" && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="reveal-reason">
              Reason (optional, 200 chars max)
            </label>
            <textarea
              id="reveal-reason"
              autoFocus
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Dealer login for live rental intake, acct #RX-4421"
              className="min-h-[80px] w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </div>
        )}

        {stage === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Decrypting…
          </div>
        )}

        {stage === "revealed" && payload && (
          <div className="space-y-3">
            {payload.username && (
              <CredentialRow
                label="Username"
                value={payload.username}
                reveal
                onCopy={() => copyValue(payload.username!)}
              />
            )}
            {payload.secret && (
              <CredentialRow
                label="Secret"
                value={payload.secret}
                reveal={showSecret}
                onToggle={() => setShowSecret((v) => !v)}
                onCopy={() => copyValue(payload.secret!)}
              />
            )}
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Auto-clears in</span>
              <span className={`font-mono tabular-nums ${countdownSeconds <= 5 ? "text-destructive" : "text-foreground"}`}>
                {countdownSeconds}s
              </span>
            </div>
          </div>
        )}

        {stage === "cleared" && (
          <div className="rounded-lg bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
            Secret cleared from memory. Clipboard wipe attempted.
          </div>
        )}

        {stage === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {errorMsg ?? "Reveal failed"}
          </div>
        )}

        <DialogFooter>
          {stage === "prompt" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleReveal}>Reveal for 30s</Button>
            </>
          )}
          {stage === "revealed" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          )}
          {(stage === "cleared" || stage === "error") && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RowProps {
  label: string;
  value: string;
  reveal: boolean;
  onToggle?: () => void;
  onCopy: () => void;
}

function CredentialRow({ label, value, reveal, onToggle, onCopy }: RowProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-background p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label={reveal ? "Hide" : "Show"}
            >
              {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            aria-label="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-1 font-mono text-sm text-foreground break-all">
        {reveal ? value : "•".repeat(Math.min(value.length, 24))}
      </div>
    </div>
  );
}
