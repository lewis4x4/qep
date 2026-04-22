import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Plus, ScrollText, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { matchesOemPortalFilters, sortOemPortals, countPortalSetupReady, type OemPortalRow } from "../lib/oem-portal-utils";
import { oemVaultQueryKeys, vaultApi, type CredentialMeta } from "../lib/vault-api";
import { CredentialCard } from "../components/CredentialCard";
import { CredentialSheet } from "../components/CredentialSheet";
import { CredentialAuditSheet } from "../components/CredentialAuditSheet";
import { RevealModal } from "../components/RevealModal";

function SegmentBadge({ segment }: { segment: OemPortalRow["segment"] }) {
  const style =
    segment === "construction" ? "bg-blue-500/10 text-blue-700 dark:text-blue-300" :
    segment === "forestry" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" :
    segment === "industrial" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" :
    "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>{segment}</span>;
}

type CredentialSheetState =
  | { open: false }
  | { open: true; mode: "create" }
  | { open: true; mode: "edit" | "rotate"; credential: CredentialMeta };

export function OemPortalDashboardPage() {
  const { profile } = useAuth();
  const role = profile?.role ?? "";
  const canManage = ["admin", "manager", "owner"].includes(role);
  const canRevealForRep = role === "rep";
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [status, setStatus] = useState("all");
  const [accessMode, setAccessMode] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [credentialSheet, setCredentialSheet] = useState<CredentialSheetState>({ open: false });
  const [revealCredential, setRevealCredential] = useState<CredentialMeta | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const portalsQuery = useQuery({
    queryKey: ["oem-portals"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: OemPortalRow[] | null; error: unknown }> };
        };
      })
        .from("oem_portal_profiles")
        .select("id, brand_code, oem_name, portal_name, segment, launch_url, status, access_mode, favorite, mfa_required, credential_owner, support_contact, notes, sort_order")
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const portals = useMemo(
    () => sortOemPortals((portalsQuery.data ?? []).filter((row) =>
      matchesOemPortalFilters(row, { search, segment, status, accessMode }),
    )),
    [accessMode, portalsQuery.data, search, segment, status],
  );

  const selected = portals.find((row) => row.id === selectedId) ?? portals[0] ?? null;

  const savePortal = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (value: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
        };
      })
        .from("oem_portal_profiles")
        .update(payload)
        .eq("id", selected!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oem-portals"] }),
  });

  const createPortal = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => { insert: (value: Record<string, unknown>) => Promise<{ error: unknown }> };
      })
        .from("oem_portal_profiles")
        .insert({
          oem_name: "New OEM",
          portal_name: "New OEM Portal",
          segment: "support",
          status: "needs_setup",
          access_mode: "bookmark_only",
          sort_order: 999,
        });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oem-portals"] }),
  });

  const readyCount = countPortalSetupReady(portalsQuery.data ?? []);

  const credentialsQuery = useQuery({
    queryKey: selected ? oemVaultQueryKeys.list(selected.id) : ["oem-portal-credentials", "noop"],
    queryFn: () => vaultApi.list(selected!.id),
    enabled: !!selected,
    staleTime: 15_000,
  });

  async function handleDeleteCredential(credential: CredentialMeta) {
    const reason = window.prompt(
      `Delete "${credential.label}"? This is append-only audited. Reason (optional):`,
      "",
    );
    if (reason === null) return;
    try {
      await vaultApi.remove(credential.id, reason);
      if (selected) qc.invalidateQueries({ queryKey: oemVaultQueryKeys.list(selected.id) });
    } catch (err) {
      window.alert(`Delete failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <div className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Phase 9 · OEM Portal SSO
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                OEM portal dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                One internal launch board for manufacturer and dealer portals, seeded from verified repo-known brands.
                This is the operational shell for the OEM portal moat; admins can progressively add launch URLs,
                login ownership, and verification notes without engineering tickets.
              </p>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => createPortal.mutate()} disabled={createPortal.isPending}>
                <Plus className="mr-1 h-4 w-4" />
                Add OEM
              </Button>
            )}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Metric label="Portals" value={String(portalsQuery.data?.length ?? 0)} />
            <Metric label="Ready" value={String(readyCount)} />
            <Metric label="Needs Setup" value={String((portalsQuery.data ?? []).filter((row) => row.status === "needs_setup").length)} />
            <Metric label="Favorites" value={String((portalsQuery.data ?? []).filter((row) => row.favorite).length)} />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1.2fr_repeat(3,minmax(0,1fr))]">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search OEM, portal, owner, notes" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            <select value={segment} onChange={(e) => setSegment(e.target.value)} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
              <option value="all">All segments</option>
              <option value="construction">Construction</option>
              <option value="forestry">Forestry</option>
              <option value="industrial">Industrial</option>
              <option value="support">Support</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="needs_setup">Needs setup</option>
              <option value="paused">Paused</option>
            </select>
            <select value={accessMode} onChange={(e) => setAccessMode(e.target.value)} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
              <option value="all">All access modes</option>
              <option value="bookmark_only">Bookmark only</option>
              <option value="shared_login">Shared login</option>
              <option value="individual_login">Individual login</option>
              <option value="oauth_ready">OAuth ready</option>
              <option value="api_only">API only</option>
            </select>
          </div>
        </Card>

        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Portal detail
          </p>
          {selected ? (
            <div className="mt-4 space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{selected.oem_name}</h2>
                <p className="text-sm text-muted-foreground">{selected.portal_name}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SegmentBadge segment={selected.segment} />
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {selected.status}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {selected.access_mode.replace(/_/g, " ")}
                </span>
                {selected.mfa_required ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" />
                    MFA
                  </span>
                ) : null}
              </div>
              {selected.launch_url ? (
                <Button asChild variant="outline">
                  <a href={selected.launch_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 h-4 w-4" />
                    Launch portal
                  </a>
                </Button>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                  Launch URL not configured yet.
                </div>
              )}
              <div className="grid gap-3">
                <input
                  defaultValue={selected.launch_url ?? ""}
                  onBlur={(e) => canManage && savePortal.mutate({ launch_url: e.target.value || null })}
                  placeholder="Launch URL"
                  disabled={!canManage}
                  className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    defaultValue={selected.credential_owner ?? ""}
                    onBlur={(e) => canManage && savePortal.mutate({ credential_owner: e.target.value || null })}
                    placeholder="Credential owner"
                    disabled={!canManage}
                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  />
                  <input
                    defaultValue={selected.support_contact ?? ""}
                    onBlur={(e) => canManage && savePortal.mutate({ support_contact: e.target.value || null })}
                    placeholder="Support contact"
                    disabled={!canManage}
                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <select
                    value={selected.segment}
                    onChange={(e) => canManage && savePortal.mutate({ segment: e.target.value })}
                    disabled={!canManage}
                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  >
                    <option value="construction">Construction</option>
                    <option value="forestry">Forestry</option>
                    <option value="industrial">Industrial</option>
                    <option value="support">Support</option>
                  </select>
                  <select
                    value={selected.status}
                    onChange={(e) => canManage && savePortal.mutate({ status: e.target.value })}
                    disabled={!canManage}
                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="needs_setup">Needs setup</option>
                    <option value="paused">Paused</option>
                  </select>
                  <select
                    value={selected.access_mode}
                    onChange={(e) => canManage && savePortal.mutate({ access_mode: e.target.value })}
                    disabled={!canManage}
                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  >
                    <option value="bookmark_only">Bookmark only</option>
                    <option value="shared_login">Shared login</option>
                    <option value="individual_login">Individual login</option>
                    <option value="oauth_ready">OAuth ready</option>
                    <option value="api_only">API only</option>
                  </select>
                </div>
                <textarea
                  defaultValue={selected.notes ?? ""}
                  onBlur={(e) => canManage && savePortal.mutate({ notes: e.target.value || null })}
                  placeholder="Portal notes"
                  disabled={!canManage}
                  className="min-h-[140px] rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </div>
              {savePortal.isError ? (
                <p className="text-sm text-destructive">{(savePortal.error as Error).message}</p>
              ) : null}

              <div className="mt-5 border-t border-border/50 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Credentials
                  </p>
                  <div className="flex items-center gap-2">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setAuditOpen(true)}>
                        <ScrollText className="mr-1 h-3.5 w-3.5" /> Audit
                      </Button>
                    )}
                    {canManage && (
                      <Button size="sm" onClick={() => setCredentialSheet({ open: true, mode: "create" })}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add credential
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Secrets are encrypted server-side. Reveal is audited and clears in 30s.
                </p>

                <div className="mt-3 grid gap-3">
                  {credentialsQuery.isLoading && (
                    <p className="text-sm text-muted-foreground">Loading credentials…</p>
                  )}
                  {credentialsQuery.isError && (
                    <p className="text-sm text-destructive">
                      Failed to load credentials: {(credentialsQuery.error as Error).message}
                    </p>
                  )}
                  {credentialsQuery.data && credentialsQuery.data.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
                      No credentials stored yet. Use <span className="font-medium text-foreground">Add credential</span> to seal a shared login, API key, OAuth secret, or TOTP seed.
                    </div>
                  )}
                  {credentialsQuery.data?.map((credential) => (
                    <CredentialCard
                      key={credential.id}
                      credential={credential}
                      canManage={canManage}
                      canRevealForRep={canRevealForRep}
                      onReveal={() => setRevealCredential(credential)}
                      onRotate={() => setCredentialSheet({ open: true, mode: "rotate", credential })}
                      onEdit={() => setCredentialSheet({ open: true, mode: "edit", credential })}
                      onDelete={() => handleDeleteCredential(credential)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No OEM portals in this workspace yet.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {portals.map((portal) => (
          <button
            key={portal.id}
            type="button"
            onClick={() => setSelectedId(portal.id)}
            className={`rounded-2xl border p-4 text-left transition ${
              selected?.id === portal.id
                ? "border-primary/30 bg-primary/[0.08] shadow-sm"
                : "border-border/50 bg-background/70 hover:border-primary/25"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{portal.oem_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{portal.portal_name}</p>
              </div>
              {portal.favorite ? (
                <KeyRound className="h-4 w-4 text-primary" />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <SegmentBadge segment={portal.segment} />
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {portal.status}
              </span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {portal.credential_owner ? `Owner: ${portal.credential_owner}` : "Credential owner not set"}
            </p>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <CredentialSheet
            open={credentialSheet.open}
            onOpenChange={(open) =>
              setCredentialSheet(open
                ? (credentialSheet.open ? credentialSheet : { open: true, mode: "create" })
                : { open: false })
            }
            portalId={selected.id}
            mode={credentialSheet.open ? credentialSheet.mode : "create"}
            credential={
              credentialSheet.open && credentialSheet.mode !== "create"
                ? credentialSheet.credential
                : undefined
            }
          />
          <CredentialAuditSheet
            open={auditOpen}
            onOpenChange={setAuditOpen}
            portalId={selected.id}
            portalName={selected.oem_name}
          />
        </>
      )}

      {revealCredential && (
        <RevealModal
          open={!!revealCredential}
          credentialId={revealCredential.id}
          credentialLabel={revealCredential.label}
          onOpenChange={(open) => {
            if (!open) setRevealCredential(null);
          }}
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
