import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export function VendorProfilesPage() {
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

  const openEdit = (v: VendorRow) => {
    setEditing(v);
    setEditName(v.name);
    setEditSupplierType(v.supplier_type);
    setEditLead(v.avg_lead_time_hours != null ? String(v.avg_lead_time_hours) : "");
    setEditNotes(v.notes ?? "");
    setEditOpen(true);
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vendor profiles</h1>
        <p className="text-sm text-muted-foreground">
          Suppliers for parts escalation and lead-time intelligence.
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

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {vendors.map((v) => (
            <li key={v.id} className="px-4 py-3 flex flex-wrap justify-between gap-3 text-sm items-center">
              <div>
                <span className="font-medium">{v.name}</span>
                <span className="text-muted-foreground ml-2">{v.supplier_type}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Lead {v.avg_lead_time_hours != null ? `${v.avg_lead_time_hours}h` : "—"} · score{" "}
                  {v.responsiveness_score != null ? Number(v.responsiveness_score).toFixed(2) : "—"}
                </p>
              </div>
              {canManage && (
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(v)}>
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ul>
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
