import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Calculator, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { ServiceSubNav } from "../components/ServiceSubNav";
import {
  formatLaborPricingRule,
  normalizeServiceLaborBranchConfigRows,
  normalizeServiceLaborCompanyOptions,
  normalizeServiceLaborPricingRuleRows,
  one,
} from "../lib/service-labor-pricing-utils";
import type { ServiceLaborPricingRuleWithCompany } from "../lib/service-labor-pricing-utils";

export function ServiceLaborPricingPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerGroupLabel, setCustomerGroupLabel] = useState("");
  const [workOrderStatus, setWorkOrderStatus] = useState<ServiceLaborPricingRuleWithCompany["work_order_status"]>("customer");
  const [laborTypeCode, setLaborTypeCode] = useState("");
  const [premiumCode, setPremiumCode] = useState("");
  const [defaultPremiumCode, setDefaultPremiumCode] = useState("");
  const [pricingCode, setPricingCode] = useState<ServiceLaborPricingRuleWithCompany["pricing_code"]>("fixed_price");
  const [pricingValue, setPricingValue] = useState("150");
  const [comment, setComment] = useState("");

  const branchConfigQuery = useQuery({
    queryKey: ["service-branch-config", "labor-pricing"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: unknown[] | null; error: unknown }> };
        };
      })
        .from("service_branch_config")
        .select("id, branch_id, default_labor_rate")
        .order("branch_id");
      if (error) throw error;
      return normalizeServiceLaborBranchConfigRows(data);
    },
  });

  const companiesQuery = useQuery({
    queryKey: ["service-labor-pricing", "companies"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: unknown[] | null; error: unknown }> };
        };
      })
        .from("qrm_companies")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return normalizeServiceLaborCompanyOptions(data);
    },
  });

  const rulesQuery = useQuery({
    queryKey: ["service-labor-pricing-rules"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: unknown[] | null; error: unknown }> };
        };
      })
        .from("service_labor_pricing_rules")
        .select("id, location_code, customer_id, customer_group_label, work_order_status, labor_type_code, premium_code, default_premium_code, comment, pricing_code, pricing_value, effective_start_on, effective_end_on, active, qrm_companies(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return normalizeServiceLaborPricingRuleRows(data);
    },
  });

  const saveBranchRate = useMutation({
    mutationFn: async ({ id, default_labor_rate }: { id: string; default_labor_rate: number }) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (row: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
        };
      })
        .from("service_branch_config")
        .update({ default_labor_rate })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-branch-config", "labor-pricing"] }),
  });

  const createRule = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      })
        .from("service_labor_pricing_rules")
        .insert({
          location_code: locationCode || null,
          customer_id: customerId || null,
          customer_group_label: customerGroupLabel.trim() || null,
          work_order_status: workOrderStatus,
          labor_type_code: laborTypeCode.trim() || null,
          premium_code: premiumCode.trim() || null,
          default_premium_code: defaultPremiumCode.trim() || null,
          comment: comment.trim() || null,
          pricing_code: pricingCode,
          pricing_value: Number(pricingValue || "0"),
          active: true,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-labor-pricing-rules"] });
      setLocationCode("");
      setCustomerId("");
      setCustomerGroupLabel("");
      setWorkOrderStatus("customer");
      setLaborTypeCode("");
      setPremiumCode("");
      setDefaultPremiumCode("");
      setPricingCode("fixed_price");
      setPricingValue("150");
      setComment("");
    },
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (row: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
        };
      })
        .from("service_labor_pricing_rules")
        .update({ active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-labor-pricing-rules"] }),
  });

  const visibleRules = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (rulesQuery.data ?? []).filter((rule) => {
      if (!needle) return true;
      const company = one(rule.qrm_companies);
      const haystack = [
        company?.name,
        rule.location_code,
        rule.customer_group_label,
        rule.work_order_status,
        rule.labor_type_code,
        rule.premium_code,
        rule.default_premium_code,
        rule.comment,
        rule.pricing_code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rulesQuery.data, search]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <ServiceSubNav />

      <div className="grid gap-4 lg:grid-cols-[0.98fr_1.02fr]">
        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Phase 4 · Labor Pricing
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                Tiered labor pricing
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Labor pricing rules by branch, customer, work-order status, labor type, and premium code.
                Service quotes now resolve labor rates from these rules unless an operator explicitly overrides them.
              </p>
            </div>
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Calculator className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules"
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={locationCode}
                onChange={(e) => setLocationCode(e.target.value)}
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="">All / default location</option>
                {(branchConfigQuery.data ?? []).map((row) => (
                  <option key={row.id} value={row.branch_id}>{row.branch_id}</option>
                ))}
              </select>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="">Any customer</option>
                {(companiesQuery.data ?? []).map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={customerGroupLabel}
                onChange={(e) => setCustomerGroupLabel(e.target.value)}
                placeholder="Customer group"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <select
                value={workOrderStatus}
                onChange={(e) => setWorkOrderStatus(e.target.value as ServiceLaborPricingRuleWithCompany["work_order_status"])}
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="customer">Customer</option>
                <option value="warranty">Warranty</option>
                <option value="internal">Internal</option>
                <option value="all">All</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={laborTypeCode}
                onChange={(e) => setLaborTypeCode(e.target.value)}
                placeholder="Type code"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                value={premiumCode}
                onChange={(e) => setPremiumCode(e.target.value)}
                placeholder="Premium code"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={defaultPremiumCode}
                onChange={(e) => setDefaultPremiumCode(e.target.value)}
                placeholder="Default premium code"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <select
                value={pricingCode}
                onChange={(e) => setPricingCode(e.target.value as ServiceLaborPricingRuleWithCompany["pricing_code"])}
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="fixed_price">Fixed Price</option>
                <option value="list_plus_pct">List + %</option>
                <option value="list_minus_pct">List - %</option>
                <option value="cost_plus_pct">Cost + %</option>
                <option value="cost_minus_pct">Cost - %</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comment"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={pricingValue}
                onChange={(e) => setPricingValue(e.target.value)}
                placeholder="Rate / %"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>
            <Button onClick={() => createRule.mutate()} disabled={createRule.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              Add rule
            </Button>
            {createRule.isError ? (
              <p className="text-sm text-destructive">{(createRule.error as Error).message}</p>
            ) : null}
          </div>
        </Card>

        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Branch defaults
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">Base labor rates</h2>
            </div>
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Banknote className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(branchConfigQuery.data ?? []).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">{row.branch_id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Default rate when no specific rule matches.</p>
                </div>
                <input
                  type="number"
                  defaultValue={row.default_labor_rate}
                  onBlur={(e) => {
                    const next = Number(e.target.value || row.default_labor_rate);
                    if (next !== row.default_labor_rate) {
                      saveBranchRate.mutate({ id: row.id, default_labor_rate: next });
                    }
                  }}
                  className="w-28 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Pricing rules
            </p>
            <div className="mt-3 space-y-3">
              {rulesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading labor pricing rules…</p>
              ) : visibleRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No labor pricing rules match the current filter.</p>
              ) : (
                visibleRules.map((rule) => {
                  const company = one(rule.qrm_companies);
                  return (
                    <div key={rule.id} className="rounded-2xl border border-border/60 bg-background/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {company?.name ?? rule.customer_group_label ?? "Any customer"} · {rule.location_code ?? "All locations"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {rule.work_order_status} · {rule.labor_type_code ?? "Any type"} · {rule.premium_code ?? "Any premium"}
                          </p>
                          <p className="mt-2 text-sm text-foreground">{formatLaborPricingRule(rule)}</p>
                          {rule.comment ? (
                            <p className="mt-1 text-xs text-muted-foreground">{rule.comment}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleRule.mutate({ id: rule.id, active: !rule.active })}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                            rule.active
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {rule.active ? "Active" : "Inactive"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
