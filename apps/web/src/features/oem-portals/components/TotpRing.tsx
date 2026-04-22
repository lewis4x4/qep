import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { oemVaultQueryKeys, vaultApi, type TotpPayload } from "../lib/vault-api";

interface TotpRingProps {
  credentialId: string;
  label: string;
  disabled?: boolean;
}

export function TotpRing({ credentialId, label, disabled }: TotpRingProps) {
  const qc = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const intervalRef = useRef<number | null>(null);

  const query = useQuery({
    queryKey: oemVaultQueryKeys.totp(credentialId),
    queryFn: () => vaultApi.totpCode(credentialId),
    enabled: !disabled,
    // Don't refetch on window focus — we control the cadence.
    staleTime: 10_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (disabled) return;
    intervalRef.current = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, [disabled]);

  // When the server-computed window expires, refetch the next code.
  useEffect(() => {
    if (!query.data) return;
    const data = query.data as TotpPayload;
    const windowEnd = (query.dataUpdatedAt ?? 0) + data.remaining_seconds * 1000;
    if (nowMs >= windowEnd) {
      qc.invalidateQueries({ queryKey: oemVaultQueryKeys.totp(credentialId) });
    }
  }, [credentialId, nowMs, qc, query.data, query.dataUpdatedAt]);

  if (disabled) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4" /> TOTP available after admin unlock for reps.
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-background/70 p-4 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4 animate-pulse" /> Fetching TOTP…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load TOTP: {(query.error as Error).message}
      </div>
    );
  }
  const data = query.data as TotpPayload | undefined;
  if (!data) return null;

  const elapsed = Math.floor((nowMs - (query.dataUpdatedAt ?? nowMs)) / 1000);
  const remaining = Math.max(0, data.remaining_seconds - elapsed);
  const pct = Math.min(100, Math.max(0, (remaining / data.period_seconds) * 100));
  const formattedCode = data.code.length === 6 ? `${data.code.slice(0, 3)} ${data.code.slice(3)}` : data.code;

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/50 bg-background/70 p-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          TOTP · {label}
        </p>
        <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-foreground">{formattedCode}</p>
        {(data.issuer || data.account) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {[data.issuer, data.account].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="relative h-12 w-12">
          <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${(pct / 100) * (2 * Math.PI * 16)} ${2 * Math.PI * 16}`}
              className={remaining <= 5 ? "text-destructive" : "text-primary"}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-foreground">
            {remaining}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(data.code)}
          className="rounded-lg border border-border/60 bg-background px-2 py-1 text-xs hover:border-primary/40"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
