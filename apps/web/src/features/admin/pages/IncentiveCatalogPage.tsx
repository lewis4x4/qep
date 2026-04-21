import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus, Trash2, Lock, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Incentive {
  id: string;
  manufacturer: string;
  program_name: string;
  program_code: string | null;
  description: string | null;
  discount_type: "flat" | "pct" | "apr_buydown" | "cash_back";
  discount_value: number;
  effective_date: string;
  expiration_date: string | null;
  stackable: boolean;
  requires_approval: boolean;
  source_url: string | null;
}

interface NewIncentive {
  manufacturer: string;
  program_name: string;
  program_code: string;
  description: string;
  discount_type: Incentive["discount_type"];
  discount_value: string;
  effective_date: string;
  expiration_date: string;
  stackable: boolean;
  requires_approval: boolean;
  source_url: string;
}

const EMPTY_NEW: NewIncentive = {
  manufacturer: "",
  program_name: "",
  program_code: "",
  description: "",
  discount_type: "flat",
  discount_value: "",
  effective_date: new Date().toISOString().split("T")[0],
  expiration_date: "",
  stackable: false,
  requires_approval: false,
  source_url: "",
};

export function IncentiveCatalogPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<NewIncentive>(EMPTY_NEW);

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "incentives"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { order: (c: string, o: Record<string, boolean>) => Promise<{ data: Incentive[] | null; error: unknown }> } };
      }).from("manufacturer_incentives")
        .select("*")
        .order("effective_date", { ascending: false });
      if (error) throw new Error("Failed to load incentives");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async (input: NewIncentive) => {
      const payload = {
        manufacturer: input.manufacturer.trim(),
        program_name: input.program_name.trim(),
        program_code: input.program_code.trim() || null,
        description: input.description.trim() || null,
        discount_type: input.discount_type,
        discount_value: parseFloat(input.discount_value),
        effective_date: input.effective_date,
        expiration_date: input.expiration_date || null,
        stackable: input.stackable,
        requires_approval: input.requires_approval,
        source_url: input.source_url.trim() || null,
      };
      const { error } = await (supabase as unknown as {
        from: (t: string) => { insert: (v: Record<string, unknown>) => Promise<{ error: unknown }> };
      }).from("manufacturer_incentives").insert(payload);
      if (error) throw new Error(String((error as { message?: string }).message ?? "Insert failed"));
    },
    onSuccess: () => {
      setDraft(EMPTY_NEW);
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "incentives"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as unknown as {
        from: (t: string) => { delete: () => { eq: (c: string, v: string) => Promise<{ error: unknown }> } };
      }).from("manufacturer_incentives").delete().eq("id", id);
      if (error) throw new Error("Delete failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "incentives"] }),
  });

  const isExpired = (i: Incentive) => i.expiration_date && new Date(i.expiration_date) < new Date();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Incentive Catalog</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Active manufacturer incentives. Auto-applied to quotes by the resolver.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="mr-1 h-3 w-3" /> {showCreate ? "Cancel" : "New incentive"}
        </Button>
      </div>

      {showCreate && (
        <Card className="p-4 border-qep-orange/30">
          <h2 className="text-sm font-bold text-foreground mb-3">New incentive</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Manufacturer">
              <input
                type="text"
                value={draft.manufacturer}
                onChange={(e) => setDraft((d) => ({ ...d, manufacturer: e.target.value }))}
                placeholder="e.g. Develon"
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Program code">
              <input
                type="text"
                value={draft.program_code}
                onChange={(e) => setDraft((d) => ({ ...d, program_code: e.target.value }))}
                placeholder="optional"
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Program name">
                <input
                  type="text"
                  value={draft.program_name}
                  onChange={(e) => setDraft((d) => ({ ...d, program_name: e.target.value }))}
                  placeholder="e.g. Spring Cash Back"
                  className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Description">
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  rows={2}
                  className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </Field>
            </div>
            <Field label="Discount type">
              <select
                value={draft.discount_type}
                onChange={(e) => setDraft((d) => ({ ...d, discount_type: e.target.value as Incentive["discount_type"] }))}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="flat">Flat $</option>
                <option value="pct">Percentage</option>
                <option value="cash_back">Cash back</option>
                <option value="apr_buydown">APR buydown</option>
              </select>
            </Field>
            <Field label="Discount value">
              <input
                type="number"
                step="0.01"
                value={draft.discount_value}
                onChange={(e) => setDraft((d) => ({ ...d, discount_value: e.target.value }))}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Effective date">
              <input
                type="date"
                value={draft.effective_date}
                onChange={(e) => setDraft((d) => ({ ...d, effective_date: e.target.value }))}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Expiration date">
              <input
                type="date"
                value={draft.expiration_date}
                onChange={(e) => setDraft((d) => ({ ...d, expiration_date: e.target.value }))}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </Field>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={draft.stackable}
                onChange={(e) => setDraft((d) => ({ ...d, stackable: e.target.checked }))}
              />
              Stackable
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={draft.requires_approval}
                onChange={(e) => setDraft((d) => ({ ...d, requires_approval: e.target.checked }))}
              />
              Requires approval
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate(draft)}
              disabled={createMutation.isPending || !draft.manufacturer.trim() || !draft.program_name.trim() || !draft.discount_value}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
          {createMutation.isError && (
            <p className="mt-2 text-xs text-red-400">{(createMutation.error as Error)?.message}</p>
          )}
        </Card>
      )}

      {/* List */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-20 animate-pulse" />)}
        </div>
      )}

      {!isLoading && data.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
          <p className="text-sm text-foreground">No incentives in the catalog yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">Click "New incentive" to add one.</p>
        </Card>
      )}

      {!isLoading && data.length > 0 && (
        <div className="space-y-2">
          {data.map((i) => {
            const expired = isExpired(i);
            return (
              <Card key={i.id} className={`p-3 ${expired ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-foreground">{i.program_name}</p>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                        {i.manufacturer}
                      </span>
                      {i.stackable && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                          stackable
                        </span>
                      )}
                      {i.requires_approval && (
                        <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                          <Lock className="h-2 w-2" /> approval
                        </span>
                      )}
                      {expired && (
                        <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-red-400">
                          expired
                        </span>
                      )}
                      {!expired && (
                        <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                          <Check className="h-2 w-2" /> active
                        </span>
                      )}
                    </div>
                    {i.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{i.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                      <span>
                        {i.discount_type === "pct"
                          ? `${i.discount_value}%`
                          : `$${i.discount_value.toLocaleString()} ${i.discount_type === "cash_back" ? "cash back" : i.discount_type === "apr_buydown" ? "APR buydown" : "off"}`}
                      </span>
                      <span>Effective {new Date(i.effective_date).toLocaleDateString()}</span>
                      {i.expiration_date && <span>Expires {new Date(i.expiration_date).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px]"
                    onClick={() => deleteMutation.mutate(i.id)}
                    aria-label="Delete incentive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {deleteMutation.isError && deleteMutation.variables === i.id && (
                  <p className="mt-1 text-[11px] text-red-400">
                    {(deleteMutation.error as Error)?.message ?? "Delete failed"}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
