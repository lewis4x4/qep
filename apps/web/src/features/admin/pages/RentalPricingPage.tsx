import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/format";

interface RentalRateRuleRecord {
  id: string;
  customer_id: string | null;
  equipment_id: string | null;
  branch_id: string | null;
  category: string | null;
  make: string | null;
  model: string | null;
  season_start: string | null;
  season_end: string | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  minimum_days: number | null;
  is_active: boolean;
  priority_rank: number;
  notes: string | null;
}

function emptyDraft() {
  return {
    customerId: "",
    equipmentId: "",
    branchId: "",
    category: "",
    make: "",
    model: "",
    seasonStart: "",
    seasonEnd: "",
    dailyRate: "",
    weeklyRate: "",
    monthlyRate: "",
    minimumDays: "",
    priorityRank: "100",
    notes: "",
  };
}

function withinSeason(rule: RentalRateRuleRecord, now: Date): boolean {
  if (!rule.season_start || !rule.season_end) return true;
  const start = new Date(rule.season_start);
  const end = new Date(rule.season_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true;
  return now >= start && now <= end;
}

export function RentalPricingPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(emptyDraft());
  const [preview, setPreview] = useState({
    customerId: "",
    equipmentId: "",
    branchId: "",
    category: "",
    make: "",
    model: "",
  });

  const rulesQuery = useQuery({
    queryKey: ["admin", "rental-rate-rules"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            order: (column: string, opts?: { ascending?: boolean }) => Promise<{ data: RentalRateRuleRecord[] | null; error: { message?: string } | null }>;
          };
        };
      })
        .from("rental_rate_rules")
        .select("*")
        .order("priority_rank", { ascending: true });
      if (error) throw new Error(error.message ?? "Failed to load rental pricing rules.");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const equipmentQuery = useQuery({
    queryKey: ["admin", "rental-pricing-equipment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_equipment")
        .select("id, make, model, year, category, daily_rental_rate, weekly_rental_rate, monthly_rental_rate")
        .eq("ownership", "rental_fleet")
        .is("deleted_at", null)
        .limit(200);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const branchesQuery = useQuery({
    queryKey: ["admin", "rental-pricing-branches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id, display_name").eq("is_active", true);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const customersQuery = useQuery({
    queryKey: ["admin", "rental-pricing-customers"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => Promise<{ data: Array<{ id: string; first_name: string; last_name: string }> | null; error: { message?: string } | null }>;
        };
      }).from("portal_customers").select("id, first_name, last_name");
      if (error) throw new Error(error.message ?? "Failed to load portal customers.");
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customer_id: draft.customerId || null,
        equipment_id: draft.equipmentId || null,
        branch_id: draft.branchId || null,
        category: draft.category || null,
        make: draft.make || null,
        model: draft.model || null,
        season_start: draft.seasonStart || null,
        season_end: draft.seasonEnd || null,
        daily_rate: draft.dailyRate ? Number(draft.dailyRate) : null,
        weekly_rate: draft.weeklyRate ? Number(draft.weeklyRate) : null,
        monthly_rate: draft.monthlyRate ? Number(draft.monthlyRate) : null,
        minimum_days: draft.minimumDays ? Number(draft.minimumDays) : null,
        priority_rank: Number(draft.priorityRank) || 100,
        notes: draft.notes || null,
      };
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          insert: (value: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
        };
      }).from("rental_rate_rules").insert(payload);
      if (error) throw new Error(error.message ?? "Failed to save pricing rule.");
    },
    onSuccess: async () => {
      setDraft(emptyDraft());
      await queryClient.invalidateQueries({ queryKey: ["admin", "rental-rate-rules"] });
    },
  });

  const previewWinner = useMemo(() => {
    const rules = rulesQuery.data ?? [];
    const equipment = (equipmentQuery.data ?? []).find((item) => item.id === preview.equipmentId);
    const scored = rules
      .filter((rule) => rule.is_active)
      .filter((rule) => withinSeason(rule, new Date()))
      .filter((rule) => !rule.customer_id || rule.customer_id === preview.customerId)
      .filter((rule) => !rule.equipment_id || rule.equipment_id === preview.equipmentId)
      .filter((rule) => !rule.branch_id || rule.branch_id === preview.branchId)
      .filter((rule) => !rule.category || rule.category === preview.category)
      .filter((rule) => !rule.make || rule.make === preview.make)
      .filter((rule) => !rule.model || rule.model === preview.model)
      .map((rule) => ({
        rule,
        score:
          (rule.customer_id ? 1000 : 0) +
          (rule.equipment_id ? 800 : 0) +
          (rule.branch_id ? 400 : 0) +
          (rule.category ? 300 : 0) +
          (rule.make ? 200 : 0) +
          (rule.model ? 100 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.rule.priority_rank - b.rule.priority_rank);
    const winning = scored[0]?.rule ?? null;
    return {
      daily: winning?.daily_rate ?? (equipment?.daily_rental_rate ?? null),
      weekly: winning?.weekly_rate ?? (equipment?.weekly_rental_rate ?? null),
      monthly: winning?.monthly_rate ?? (equipment?.monthly_rental_rate ?? null),
      source: winning ? "pricing rule" : "equipment base rate",
      rule: winning,
    };
  }, [equipmentQuery.data, preview, rulesQuery.data]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Rental Pricing Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage customer-specific, unit-specific, and branch/category seasonal rental pricing with explicit precedence.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="p-4">
          <p className="text-sm font-semibold text-foreground">Create pricing rule</p>
          <div className="mt-4 grid gap-3">
            <select value={draft.customerId} onChange={(e) => setDraft((current) => ({ ...current, customerId: e.target.value }))} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
              <option value="">Customer override (optional)</option>
              {(customersQuery.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.first_name} {customer.last_name}</option>
              ))}
            </select>
            <select value={draft.equipmentId} onChange={(e) => setDraft((current) => ({ ...current, equipmentId: e.target.value }))} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
              <option value="">Unit override (optional)</option>
              {(equipmentQuery.data ?? []).map((equipment) => (
                <option key={equipment.id} value={equipment.id}>{[equipment.year, equipment.make, equipment.model].filter(Boolean).join(" ")}</option>
              ))}
            </select>
            <select value={draft.branchId} onChange={(e) => setDraft((current) => ({ ...current, branchId: e.target.value }))} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
              <option value="">Branch rule (optional)</option>
              {(branchesQuery.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.display_name}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input value={draft.category} onChange={(e) => setDraft((current) => ({ ...current, category: e.target.value }))} placeholder="Category" />
              <Input value={draft.make} onChange={(e) => setDraft((current) => ({ ...current, make: e.target.value }))} placeholder="Make" />
              <Input value={draft.model} onChange={(e) => setDraft((current) => ({ ...current, model: e.target.value }))} placeholder="Model" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="date" value={draft.seasonStart} onChange={(e) => setDraft((current) => ({ ...current, seasonStart: e.target.value }))} />
              <Input type="date" value={draft.seasonEnd} onChange={(e) => setDraft((current) => ({ ...current, seasonEnd: e.target.value }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input value={draft.dailyRate} onChange={(e) => setDraft((current) => ({ ...current, dailyRate: e.target.value }))} placeholder="Daily rate" />
              <Input value={draft.weeklyRate} onChange={(e) => setDraft((current) => ({ ...current, weeklyRate: e.target.value }))} placeholder="Weekly rate" />
              <Input value={draft.monthlyRate} onChange={(e) => setDraft((current) => ({ ...current, monthlyRate: e.target.value }))} placeholder="Monthly rate" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={draft.minimumDays} onChange={(e) => setDraft((current) => ({ ...current, minimumDays: e.target.value }))} placeholder="Minimum days" />
              <Input value={draft.priorityRank} onChange={(e) => setDraft((current) => ({ ...current, priorityRank: e.target.value }))} placeholder="Priority rank" />
            </div>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))}
              className="min-h-[100px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
              placeholder="Why this pricing rule exists..."
            />
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Create pricing rule"}
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground">Estimate preview</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <select value={preview.customerId} onChange={(e) => setPreview((current) => ({ ...current, customerId: e.target.value }))} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
                <option value="">Customer</option>
                {(customersQuery.data ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.first_name} {customer.last_name}</option>
                ))}
              </select>
              <select value={preview.equipmentId} onChange={(e) => {
                const equipment = (equipmentQuery.data ?? []).find((item) => item.id === e.target.value);
                setPreview((current) => ({
                  ...current,
                  equipmentId: e.target.value,
                  category: equipment?.category ?? current.category,
                  make: equipment?.make ?? current.make,
                  model: equipment?.model ?? current.model,
                }));
              }} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
                <option value="">Equipment</option>
                {(equipmentQuery.data ?? []).map((equipment) => (
                  <option key={equipment.id} value={equipment.id}>{[equipment.year, equipment.make, equipment.model].filter(Boolean).join(" ")}</option>
                ))}
              </select>
              <select value={preview.branchId} onChange={(e) => setPreview((current) => ({ ...current, branchId: e.target.value }))} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
                <option value="">Branch</option>
                {(branchesQuery.data ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.display_name}</option>
                ))}
              </select>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="Daily" value={formatCurrency(previewWinner.daily)} />
              <Metric label="Weekly" value={formatCurrency(previewWinner.weekly)} />
              <Metric label="Monthly" value={formatCurrency(previewWinner.monthly)} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Winning source: {previewWinner.source}
              {previewWinner.rule?.notes ? ` · ${previewWinner.rule.notes}` : ""}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground">Active pricing rules</p>
            <div className="mt-4 space-y-3">
              {(rulesQuery.data ?? []).map((rule) => (
                <div key={rule.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {[
                          rule.customer_id ? "customer" : null,
                          rule.equipment_id ? "unit" : null,
                          rule.branch_id ? "branch" : null,
                          rule.category ? `category ${rule.category}` : null,
                          rule.make ? rule.make : null,
                          rule.model ? rule.model : null,
                        ].filter(Boolean).join(" · ") || "base rule"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Daily {formatCurrency(rule.daily_rate)} · Weekly {formatCurrency(rule.weekly_rate)} · Monthly {formatCurrency(rule.monthly_rate)}
                      </p>
                    </div>
                    <span className="rounded-full bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold text-qep-orange">
                      priority {rule.priority_rank}
                    </span>
                  </div>
                  {rule.notes ? <p className="mt-2 text-xs text-muted-foreground">{rule.notes}</p> : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
