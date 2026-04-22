import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { ServiceSubNav } from "../components/ServiceSubNav";
import { PartsSubNav } from "@/features/parts/components/PartsSubNav";
import {
  buildVendorPricingPortalUrl,
  makeVendorAccessKey,
  sha256Hex,
} from "../lib/vendor-pricing-portal-utils";

const SUPPLIER_TYPES = ["oem", "aftermarket", "general", "specialty", "internal"] as const;

type VendorRow = {
  id: string;
  name: string;
  supplier_type: string;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  notes: string | null;
};

type PolicyRow = {
  id: string;
  name: string;
  steps: unknown;
  is_machine_down: boolean;
};

type VendorPriceRow = {
  id: string;
  vendor_id: string;
  part_number: string;
  description: string | null;
  list_price: number | null;
  currency: string;
  effective_date: string;
};

type VendorSubmissionRow = {
  id: string;
  vendor_id: string;
  part_number: string;
  description: string | null;
  proposed_list_price: number;
  currency: string;
  effective_date: string;
  submission_notes: string | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  review_notes: string | null;
  reviewed_at: string | null;
  vendor_profiles?: { name?: string } | { name?: string }[] | null;
};

type VendorAccessKeyRow = {
  id: string;
  vendor_id: string;
  label: string | null;
  contact_name: string | null;
  contact_email: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  vendor_profiles?: { name?: string } | { name?: string }[] | null;
};

function joinedVendorName(value: VendorSubmissionRow["vendor_profiles"] | VendorAccessKeyRow["vendor_profiles"]): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name ?? "Vendor";
}

export function VendorProfilesPage({ subNav = "service" }: { subNav?: "service" | "parts" }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const canManage = ["admin", "manager", "owner"].includes(profile?.role ?? "");

  const [name, setName] = useState("");
  const [supplierType, setSupplierType] = useState<string>("general");
  const [leadHours, setLeadHours] = useState("");
  const [notes, setNotes] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<VendorRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editSupplierType, setEditSupplierType] = useState("general");
  const [editLead, setEditLead] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [portalVendorId, setPortalVendorId] = useState("");
  const [portalLabel, setPortalLabel] = useState("");
  const [portalContactName, setPortalContactName] = useState("");
  const [portalContactEmail, setPortalContactEmail] = useState("");
  const [portalExpiryDays, setPortalExpiryDays] = useState("30");
  const [latestPortalLink, setLatestPortalLink] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, string>>({});

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendor-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_profiles")
        .select("id, name, supplier_type, avg_lead_time_hours, responsiveness_score, notes")
        .order("name");
      if (error) throw error;
      return (data ?? []) as VendorRow[];
    },
  });

  const { data: policies = [] } = useQuery({
    queryKey: ["vendor-escalation-policies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_escalation_policies")
        .select("id, name, steps, is_machine_down")
        .order("name");
      if (error) throw error;
      return (data ?? []) as PolicyRow[];
    },
    enabled: canManage,
  });

  const { data: vendorAccessKeys = [] } = useQuery({
    queryKey: ["vendor-portal-access-keys"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            order: (column: string, opts: { ascending: boolean }) => Promise<{ data: VendorAccessKeyRow[] | null; error: unknown }>;
          };
        };
      })
        .from("vendor_portal_access_keys")
        .select("id, vendor_id, label, contact_name, contact_email, expires_at, revoked_at, created_at, vendor_profiles(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: canManage,
  });

  const { data: vendorSubmissions = [] } = useQuery({
    queryKey: ["vendor-price-submissions"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            order: (column: string, opts: { ascending: boolean }) => Promise<{ data: VendorSubmissionRow[] | null; error: unknown }>;
          };
        };
      })
        .from("parts_vendor_price_submissions")
        .select("id, vendor_id, part_number, description, proposed_list_price, currency, effective_date, submission_notes, submitted_by_name, submitted_by_email, status, review_notes, reviewed_at, vendor_profiles(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: canManage,
  });

  const { data: vendorPrices = [] } = useQuery({
    queryKey: ["parts-vendor-prices"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            order: (column: string, opts: { ascending: boolean }) => Promise<{ data: VendorPriceRow[] | null; error: unknown }>;
          };
        };
      })
        .from("parts_vendor_prices")
        .select("id, vendor_id, part_number, description, list_price, currency, effective_date")
        .order("effective_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: canManage,
  });

  const insertVendor = useMutation({
    mutationFn: async () => {
      const row = {
        name: name.trim(),
        supplier_type: supplierType,
        avg_lead_time_hours: leadHours.trim() === "" ? null : Number(leadHours),
        notes: notes.trim() || null,
      };
      if (!row.name) throw new Error("Name is required");
      const { error } = await supabase.from("vendor_profiles").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-profiles"] });
      setName("");
      setSupplierType("general");
      setLeadHours("");
      setNotes("");
    },
  });

  const updateVendor = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("vendor_profiles")
        .update({
          name: editName.trim(),
          supplier_type: editSupplierType,
          avg_lead_time_hours: editLead.trim() === "" ? null : Number(editLead),
          notes: editNotes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-profiles"] });
      setEditOpen(false);
      setEditing(null);
    },
  });

  const savePolicy = useMutation({
    mutationFn: async ({ id, stepsText }: { id: string; stepsText: string }) => {
      let steps: unknown;
      try {
        steps = JSON.parse(stepsText);
      } catch {
        throw new Error("Steps must be valid JSON array");
      }
      const { error } = await supabase
        .from("vendor_escalation_policies")
        .update({ steps, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendor-escalation-policies"] }),
  });

  const createAccessKey = useMutation({
    mutationFn: async () => {
      if (!portalVendorId) throw new Error("Select a vendor first.");
      const rawAccessKey = makeVendorAccessKey();
      const accessKeyHash = await sha256Hex(rawAccessKey);
      const days = Number.parseInt(portalExpiryDays, 10);
      const expiresAt = Number.isFinite(days) && days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const { error } = await (supabase as unknown as {
        from: (table: string) => { insert: (value: Record<string, unknown>) => Promise<{ error: unknown }> };
      })
        .from("vendor_portal_access_keys")
        .insert({
          vendor_id: portalVendorId,
          label: portalLabel.trim() || null,
          contact_name: portalContactName.trim() || null,
          contact_email: portalContactEmail.trim() || null,
          access_key_hash: accessKeyHash,
          expires_at: expiresAt,
          created_by: profile?.id ?? null,
        });
      if (error) throw error;
      return rawAccessKey;
    },
    onSuccess: async (rawAccessKey) => {
      setLatestPortalLink(buildVendorPricingPortalUrl(window.location.origin, rawAccessKey));
      setPortalLabel("");
      setPortalContactName("");
      setPortalContactEmail("");
      await qc.invalidateQueries({ queryKey: ["vendor-portal-access-keys"] });
    },
  });

  const approveSubmission = useMutation({
    mutationFn: async (submission: VendorSubmissionRow) => {
      const { data: priceRow, error: priceError } = await (supabase as unknown as {
        from: (table: string) => {
          upsert: (value: Record<string, unknown>, options: { onConflict: string }) => {
            select: (columns: string) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> };
          };
        };
      })
        .from("parts_vendor_prices")
        .upsert({
          vendor_id: submission.vendor_id,
          part_number: submission.part_number,
          description: submission.description,
          list_price: submission.proposed_list_price,
          currency: submission.currency,
          effective_date: submission.effective_date,
        }, {
          onConflict: "vendor_id,part_number,effective_date",
        })
        .select("id")
        .single();
      if (priceError || !priceRow) throw priceError ?? new Error("Could not apply vendor price.");

      const { error: updateError } = await (supabase as unknown as {
        from: (table: string) => {
          update: (value: Record<string, unknown>) => {
            eq: (column: string, value: string) => Promise<{ error: unknown }>;
          };
        };
      })
        .from("parts_vendor_price_submissions")
        .update({
          status: "approved",
          reviewed_by: profile?.id ?? null,
          reviewed_at: new Date().toISOString(),
          review_notes: reviewNotes[submission.id] ?? null,
          applied_vendor_price_id: priceRow.id,
        })
        .eq("id", submission.id);
      if (updateError) throw updateError;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["vendor-price-submissions"] }),
        qc.invalidateQueries({ queryKey: ["parts-vendor-prices"] }),
      ]);
    },
  });

  const rejectSubmission = useMutation({
    mutationFn: async (submission: VendorSubmissionRow) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (value: Record<string, unknown>) => {
            eq: (column: string, value: string) => Promise<{ error: unknown }>;
          };
        };
      })
        .from("parts_vendor_price_submissions")
        .update({
          status: "rejected",
          reviewed_by: profile?.id ?? null,
          reviewed_at: new Date().toISOString(),
          review_notes: reviewNotes[submission.id] ?? null,
        })
        .eq("id", submission.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["vendor-price-submissions"] });
    },
  });

  const openEdit = (v: VendorRow) => {
    setEditing(v);
    setEditName(v.name);
    setEditSupplierType(v.supplier_type);
    setEditLead(v.avg_lead_time_hours != null ? String(v.avg_lead_time_hours) : "");
    setEditNotes(v.notes ?? "");
    setEditOpen(true);
  };

  const currentVendor = useMemo(
    () => vendors.find((vendor) => vendor.id === selectedVendorId) ?? null,
    [selectedVendorId, vendors],
  );

  const latestVendorPrices = useMemo(() => {
    const latest = new Map<string, VendorPriceRow>();
    for (const row of vendorPrices) {
      const key = `${row.vendor_id}:${row.part_number}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return [...latest.values()];
  }, [vendorPrices]);

  const currentVendorPrices = useMemo(
    () => latestVendorPrices.filter((row) => row.vendor_id === currentVendor?.id),
    [currentVendor?.id, latestVendorPrices],
  );

  const pendingSubmissions = vendorSubmissions.filter((row) => row.status === "pending");

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {subNav === "parts" ? <PartsSubNav /> : <ServiceSubNav />}
      <div>
        <h1 className="text-2xl font-semibold">Vendor profiles</h1>
        <p className="text-sm text-muted-foreground">
          Suppliers, portal links, current price files, and vendor-submitted pricing approvals.
        </p>
      </div>

      {canManage && (
        <Card className="p-4 space-y-3">
          <p className="text-sm font-medium">Add vendor</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vendor name"
              className="rounded border border-input bg-card px-3 py-2 text-sm"
            />
            <select
              value={supplierType}
              onChange={(e) => setSupplierType(e.target.value)}
              className="rounded border border-input bg-card px-3 py-2 text-sm"
            >
              {SUPPLIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={leadHours}
              onChange={(e) => setLeadHours(e.target.value)}
              placeholder="Avg lead time (hours)"
              className="rounded border border-input bg-card px-3 py-2 text-sm"
              type="number"
            />
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              className="rounded border border-input bg-card px-3 py-2 text-sm sm:col-span-2"
            />
          </div>
          <Button size="sm" onClick={() => insertVendor.mutate()} disabled={insertVendor.isPending}>
            {insertVendor.isPending ? "Saving…" : "Add vendor"}
          </Button>
          {insertVendor.isError && (
            <p className="text-sm text-destructive">
              {insertVendor.error instanceof Error ? insertVendor.error.message : "Insert failed"}
            </p>
          )}
        </Card>
      )}

      {canManage && (
        <Card className="p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Vendor pricing portal</p>
            <p className="text-sm text-muted-foreground">
              Generate a vendor link, let the vendor submit price updates, then approve or reject each request before it touches the active price file.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={portalVendorId}
              onChange={(e) => {
                setPortalVendorId(e.target.value);
                setSelectedVendorId(e.target.value || null);
              }}
              className="rounded border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">Select vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
            <input
              value={portalLabel}
              onChange={(e) => setPortalLabel(e.target.value)}
              placeholder="Link label"
              className="rounded border border-input bg-card px-3 py-2 text-sm"
            />
            <input
              value={portalContactName}
              onChange={(e) => setPortalContactName(e.target.value)}
              placeholder="Vendor contact name"
              className="rounded border border-input bg-card px-3 py-2 text-sm"
            />
            <input
              value={portalContactEmail}
              onChange={(e) => setPortalContactEmail(e.target.value)}
              placeholder="Vendor contact email"
              className="rounded border border-input bg-card px-3 py-2 text-sm"
            />
            <input
              value={portalExpiryDays}
              onChange={(e) => setPortalExpiryDays(e.target.value)}
              placeholder="Expiry in days"
              type="number"
              className="rounded border border-input bg-card px-3 py-2 text-sm"
            />
          </div>
          <Button size="sm" onClick={() => createAccessKey.mutate()} disabled={createAccessKey.isPending}>
            {createAccessKey.isPending ? "Generating…" : "Generate portal link"}
          </Button>
          {createAccessKey.isError && (
            <p className="text-sm text-destructive">
              {createAccessKey.error instanceof Error ? createAccessKey.error.message : "Link generation failed"}
            </p>
          )}
          {latestPortalLink && (
            <div className="rounded border border-border bg-card/50 p-3 text-sm">
              <p className="font-medium">Latest portal link</p>
              <p className="mt-1 break-all text-muted-foreground">{latestPortalLink}</p>
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {vendors.map((v) => (
            <li key={v.id} className="px-4 py-3 flex flex-wrap justify-between gap-3 text-sm items-center">
              <button type="button" className="text-left" onClick={() => setSelectedVendorId(v.id)}>
                <span className="font-medium">{v.name}</span>
                <span className="text-muted-foreground ml-2">{v.supplier_type}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Lead {v.avg_lead_time_hours != null ? `${v.avg_lead_time_hours}h` : "—"} · score{" "}
                  {v.responsiveness_score != null
                    ? Number(v.responsiveness_score).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </p>
              </button>
              {canManage && (
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(v)}>
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && currentVendor && (
        <Card className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Current vendor price file</p>
              <p className="text-sm text-muted-foreground">
                Latest active prices QEP has on file for {currentVendor.name}.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{currentVendorPrices.length} rows</span>
          </div>
          {currentVendorPrices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vendor price rows on file yet.</p>
          ) : (
            <div className="space-y-2">
              {currentVendorPrices.slice(0, 25).map((row) => (
                <div key={row.id} className="rounded border border-border/60 bg-card/40 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.part_number}</p>
                      <p className="text-xs text-muted-foreground">{row.description || "No description"}</p>
                    </div>
                    <div className="text-right">
                      <p>{row.list_price != null ? `${Number(row.list_price).toFixed(4)} ${row.currency}` : "—"}</p>
                      <p className="text-xs text-muted-foreground">{row.effective_date}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {canManage && (
        <Card className="p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Pending vendor pricing submissions</p>
            <p className="text-sm text-muted-foreground">
              Review and approve vendor-entered price changes before they update the active vendor price file.
            </p>
          </div>
          {pendingSubmissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending submissions.</p>
          ) : (
            <div className="space-y-3">
              {pendingSubmissions.map((submission) => {
                const currentPrice = latestVendorPrices.find((row) =>
                  row.vendor_id === submission.vendor_id && row.part_number === submission.part_number,
                );
                return (
                  <Card key={submission.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{joinedVendorName(submission.vendor_profiles)} · {submission.part_number}</p>
                        <p className="text-xs text-muted-foreground">{submission.description || "No description"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Submitted by {[submission.submitted_by_name, submission.submitted_by_email].filter(Boolean).join(" · ") || "Unknown contact"}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p>Current {currentPrice?.list_price != null ? Number(currentPrice.list_price).toFixed(4) : "—"} {submission.currency}</p>
                        <p className="font-semibold text-qep-orange">
                          Proposed {Number(submission.proposed_list_price).toFixed(4)} {submission.currency}
                        </p>
                        <p className="text-xs text-muted-foreground">Effective {submission.effective_date}</p>
                      </div>
                    </div>
                    {submission.submission_notes && (
                      <p className="text-sm text-muted-foreground">{submission.submission_notes}</p>
                    )}
                    <textarea
                      value={reviewNotes[submission.id] ?? ""}
                      onChange={(e) => setReviewNotes((prev) => ({ ...prev, [submission.id]: e.target.value }))}
                      className="w-full min-h-[72px] rounded border border-input bg-card px-3 py-2 text-sm"
                      placeholder="Approval or rejection notes"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => approveSubmission.mutate(submission)} disabled={approveSubmission.isPending}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => rejectSubmission.mutate(submission)} disabled={rejectSubmission.isPending}>
                        Reject
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {canManage && vendorAccessKeys.length > 0 && (
        <Card className="p-4 space-y-3">
          <p className="text-sm font-medium">Active portal links</p>
          <div className="space-y-2">
            {vendorAccessKeys.map((keyRow) => (
              <div key={keyRow.id} className="rounded border border-border/60 bg-card/40 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{joinedVendorName(keyRow.vendor_profiles)}</p>
                    <p className="text-xs text-muted-foreground">
                      {[keyRow.label, keyRow.contact_name, keyRow.contact_email].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{keyRow.revoked_at ? "Revoked" : "Active"}</p>
                    <p>{keyRow.expires_at ? `Expires ${new Date(keyRow.expires_at).toLocaleDateString()}` : "No expiry"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {canManage && policies.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Escalation policies</h2>
          <p className="text-sm text-muted-foreground">
            Steps must be a JSON array (validated server-side). Example:{" "}
            <code className="text-xs">[{`{"after_hours":4,"action":"notify"}`}]</code>
          </p>
          {policies.map((p) => {
            const draft =
              policyDrafts[p.id] ??
              JSON.stringify(p.steps ?? [], null, 2);
            return (
              <Card key={p.id} className="p-4 space-y-2">
                <div className="flex justify-between gap-2 flex-wrap">
                  <span className="font-medium">{p.name}</span>
                  {p.is_machine_down && (
                    <span className="text-xs rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5">
                      Machine down
                    </span>
                  )}
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  className="w-full min-h-[120px] rounded border border-input bg-card px-3 py-2 text-xs font-mono"
                  spellCheck={false}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={savePolicy.isPending}
                  onClick={() => savePolicy.mutate({ id: p.id, stepsText: draft })}
                >
                  Save steps
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit vendor</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="rounded border border-input px-3 py-2 text-sm"
              placeholder="Name"
            />
            <select
              value={editSupplierType}
              onChange={(e) => setEditSupplierType(e.target.value)}
              className="rounded border border-input px-3 py-2 text-sm"
            >
              {SUPPLIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={editLead}
              onChange={(e) => setEditLead(e.target.value)}
              className="rounded border border-input px-3 py-2 text-sm"
              placeholder="Avg lead time (hours)"
              type="number"
            />
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="rounded border border-input px-3 py-2 text-sm min-h-[72px]"
              placeholder="Notes"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => updateVendor.mutate()} disabled={updateVendor.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
