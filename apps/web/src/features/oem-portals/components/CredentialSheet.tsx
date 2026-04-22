import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  oemVaultQueryKeys,
  vaultApi,
  type CredentialKind,
  type CredentialMeta,
} from "../lib/vault-api";

interface CredentialSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalId: string;
  mode: "create" | "rotate" | "edit";
  credential?: CredentialMeta;
}

const KIND_OPTIONS: { value: CredentialKind; label: string; help: string }[] = [
  { value: "shared_login", label: "Shared login", help: "Username + password shared across a role (dealer portal)." },
  { value: "api_key",     label: "API key",      help: "Single bearer/secret for a machine-to-machine integration." },
  { value: "oauth_client",label: "OAuth client", help: "Client ID + client secret for OAuth2 apps." },
  { value: "totp_seed",   label: "TOTP (MFA)",   help: "2FA seed (otpauth:// URI or base32) for this portal." },
];

export function CredentialSheet(props: CredentialSheetProps) {
  const { open, onOpenChange, portalId, mode, credential } = props;
  const qc = useQueryClient();

  const [kind, setKind] = useState<CredentialKind>(credential?.kind ?? "shared_login");
  const [label, setLabel] = useState(credential?.label ?? "");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [totpInput, setTotpInput] = useState("");
  const [revealAllowedForReps, setRevealAllowedForReps] = useState(
    credential?.reveal_allowed_for_reps ?? false,
  );
  const [notes, setNotes] = useState(credential?.notes ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Scrub on close to avoid leaving plaintext in component state.
      setUsername("");
      setSecret("");
      setTotpInput("");
      setReason("");
      setError(null);
      return;
    }
    if (credential) {
      setKind(credential.kind);
      setLabel(credential.label);
      setRevealAllowedForReps(credential.reveal_allowed_for_reps);
      setNotes(credential.notes ?? "");
    } else {
      setKind("shared_login");
      setLabel("");
      setRevealAllowedForReps(false);
      setNotes("");
    }
  }, [open, credential]);

  const createMutation = useMutation({
    mutationFn: () =>
      vaultApi.create({
        portal_id: portalId,
        kind,
        label: label.trim(),
        username: username || undefined,
        secret: secret || undefined,
        totp_uri_or_seed: totpInput || undefined,
        reveal_allowed_for_reps: revealAllowedForReps,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: oemVaultQueryKeys.list(portalId) });
      qc.invalidateQueries({ queryKey: oemVaultQueryKeys.audit(portalId) });
      setUsername("");
      setSecret("");
      setTotpInput("");
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      vaultApi.update({
        credential_id: credential!.id,
        label: label.trim(),
        notes: notes.trim(),
        reveal_allowed_for_reps: revealAllowedForReps,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: oemVaultQueryKeys.list(portalId) });
      qc.invalidateQueries({ queryKey: oemVaultQueryKeys.audit(portalId) });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const rotateMutation = useMutation({
    mutationFn: () =>
      vaultApi.rotate({
        credential_id: credential!.id,
        new_username: username || undefined,
        new_secret: secret || undefined,
        new_totp_uri_or_seed: totpInput || undefined,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: oemVaultQueryKeys.list(portalId) });
      qc.invalidateQueries({ queryKey: oemVaultQueryKeys.audit(portalId) });
      qc.invalidateQueries({ queryKey: oemVaultQueryKeys.totp(credential!.id) });
      setUsername("");
      setSecret("");
      setTotpInput("");
      setReason("");
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const busy = createMutation.isPending || updateMutation.isPending || rotateMutation.isPending;

  const title =
    mode === "create" ? "Add credential" : mode === "rotate" ? "Rotate credential" : "Edit credential";
  const description =
    mode === "create"
      ? "Secrets are encrypted server-side before they touch Postgres."
      : mode === "rotate"
        ? "Only fields you fill in will be re-encrypted. Reason is optional but audited."
        : "Metadata changes only — rotate to change secrets.";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> {title}
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex-1 space-y-4">
          {mode === "create" && (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Kind
              </label>
              <div className="grid gap-2">
                {KIND_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                      kind === opt.value ? "border-primary/40 bg-primary/[0.05]" : "border-border/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={opt.value}
                      checked={kind === opt.value}
                      onChange={() => setKind(opt.value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium text-foreground">{opt.label}</span>
                      <span className="block text-xs text-muted-foreground">{opt.help}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Label
            </label>
            <input
              autoFocus={mode !== "rotate"}
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={mode === "rotate"}
              placeholder="Dealer master login · Parts API · Service portal TOTP"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>

          {(mode === "create" || mode === "rotate") && (
            <>
              {(kind === "shared_login" || kind === "oauth_client") && (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {kind === "oauth_client" ? "Client ID" : "Username"}
                  </label>
                  <input
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={kind === "oauth_client" ? "client_abc123" : "ops@dealership"}
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm"
                  />
                </div>
              )}
              {kind !== "totp_seed" && (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {kind === "oauth_client" ? "Client secret" : kind === "api_key" ? "API key" : "Password / secret"}
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={mode === "rotate" ? "Leave blank to keep current secret" : "Paste secret once — it will be encrypted server-side"}
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm"
                  />
                </div>
              )}
              {kind === "totp_seed" && (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    TOTP seed
                  </label>
                  <textarea
                    rows={3}
                    value={totpInput}
                    onChange={(e) => setTotpInput(e.target.value)}
                    placeholder="Paste otpauth://totp/... URI or a raw base32 seed"
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Code is generated server-side on each tick; the seed never leaves the vault.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background p-3">
            <span className="text-sm">
              Allow reps to reveal
              <span className="ml-1 text-xs text-muted-foreground">(default: elevated roles only)</span>
            </span>
            <input
              type="checkbox"
              checked={revealAllowedForReps}
              onChange={(e) => setRevealAllowedForReps(e.target.checked)}
              className="h-4 w-4"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Notes
            </label>
            <textarea
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context the next operator should see before revealing…"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </div>

          {mode === "rotate" && (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Reason (optional, audited)
              </label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Quarterly rotation · compromised on 2026-04-21"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setError(null);
              if (mode === "create") createMutation.mutate();
              else if (mode === "rotate") rotateMutation.mutate();
              else updateMutation.mutate();
            }}
            disabled={busy || !label.trim()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {mode === "create" ? "Save credential" : mode === "rotate" ? "Rotate & encrypt" : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
