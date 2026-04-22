import { KeyRound, ShieldCheck, Eye, RotateCw, Trash2, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type CredentialMeta } from "../lib/vault-api";
import { TotpRing } from "./TotpRing";

interface CredentialCardProps {
  credential: CredentialMeta;
  canManage: boolean;
  canRevealForRep: boolean;
  onReveal: () => void;
  onRotate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const KIND_META: Record<
  CredentialMeta["kind"],
  { label: string; color: string; icon: typeof KeyRound }
> = {
  shared_login: { label: "Shared login", color: "text-primary", icon: UserCog },
  api_key:      { label: "API key",      color: "text-primary", icon: KeyRound },
  oauth_client: { label: "OAuth client", color: "text-primary", icon: KeyRound },
  totp_seed:    { label: "TOTP (MFA)",   color: "text-primary", icon: ShieldCheck },
};

function formatStamp(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function CredentialCard({
  credential,
  canManage,
  canRevealForRep,
  onReveal,
  onRotate,
  onEdit,
  onDelete,
}: CredentialCardProps) {
  const meta = KIND_META[credential.kind];
  const Icon = meta.icon;
  const revealEligible = canManage || (canRevealForRep && credential.reveal_allowed_for_reps);
  const isTotp = credential.kind === "totp_seed";

  return (
    <div className="rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Icon className={`h-3 w-3 ${meta.color}`} /> {meta.label}
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold text-foreground">{credential.label}</h3>
        </div>
        {credential.reveal_allowed_for_reps && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
            reps ok
          </span>
        )}
      </div>

      {isTotp ? (
        <div className="mt-3">
          <TotpRing
            credentialId={credential.id}
            label={credential.totp_issuer ?? credential.label}
            disabled={!revealEligible}
          />
        </div>
      ) : (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {credential.has_username && <p>• Username stored</p>}
          {credential.has_secret && <p>• Secret stored</p>}
          <p className="mt-2">
            Last rotated: <span className="text-foreground">{formatStamp(credential.last_rotated_at)}</span>
          </p>
          <p>
            Last revealed: <span className="text-foreground">{formatStamp(credential.last_revealed_at)}</span>
            {credential.reveal_count > 0 && (
              <span className="ml-1 text-muted-foreground">({credential.reveal_count}×)</span>
            )}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!isTotp && (
          <Button
            size="sm"
            variant="outline"
            onClick={onReveal}
            disabled={!revealEligible}
            title={revealEligible ? "Reveal for 30 seconds" : "Elevated role required"}
          >
            <Eye className="mr-1 h-3.5 w-3.5" /> Reveal
          </Button>
        )}
        {canManage && (
          <>
            <Button size="sm" variant="outline" onClick={onRotate}>
              <RotateCw className="mr-1 h-3.5 w-3.5" /> Rotate
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
