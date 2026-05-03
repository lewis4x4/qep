import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import {
  listThresholds,
  upsertThreshold,
  deleteThreshold,
  getExceptionRollup,
  type MarginThresholdRow,
  type ExceptionRollup,
} from "../../lib/pricing-discipline-api";

/**
 * Slice 15 — admin tab combining threshold editor + exception rollup.
 *
 * Two panels:
 *   1. Thresholds — workspace default + per-brand overrides. Add/edit/delete.
 *   2. Exceptions rollup — sums of margin erosion, by rep + brand, recent list.
 */

type ThresholdWithBrand = MarginThresholdRow & {
  qb_brands?: { id: string; name: string; code: string | null } | null;
};

type BrandRow = { id: string; name: string; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBrand(value: unknown): BrandRow | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    code: nullableString(value.code) ?? "",
  };
}

function toThresholdBrand(value: unknown): ThresholdWithBrand["qb_brands"] {
  const brand = Array.isArray(value) ? value.find(isRecord) : value;
  if (!isRecord(brand)) return null;
  const id = requiredString(brand.id);
  const name = requiredString(brand.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    code: nullableString(brand.code),
  };
}

function toThresholdWithBrand(row: MarginThresholdRow): ThresholdWithBrand {
  const record: unknown = row;
  return {
    ...row,
    qb_brands: isRecord(record) ? toThresholdBrand(record.qb_brands) : null,
  };
}

export function MarginDisciplineForm() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [thresholds, setThresholds] = useState<ThresholdWithBrand[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [rollup, setRollup] = useState<ExceptionRollup | null>(null);
  const [period, setPeriod] = useState<"30" | "90" | "all">("90");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{ brandId: string | null; minMarginPct: string; notes: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    const [t, r] = await Promise.all([
      listThresholds(),
      getExceptionRollup({ daysBack: period === "all" ? null : parseInt(period) }),
    ]);
    setThresholds(t.map(toThresholdWithBrand));
    setRollup(r);
    setLoading(false);
  }

  useEffect(() => {
    // Brands list — one-time pull for the per-brand dropdown
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("qb_brands")
        .select("id, name, code")
        .order("name", { ascending: true });
      if (!cancelled) setBrands((data ?? []).flatMap((row) => {
        const brand = toBrand(row);
        return brand ? [brand] : [];
      }));
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const usedBrandIds = new Set(thresholds.map((t) => t.brand_id).filter(Boolean));
  const hasDefault = thresholds.some((t) => t.brand_id === null);

  function startNew(kind: "default" | "brand") {
    setDraft({
      brandId: kind === "default" ? null : "",
      minMarginPct: "",
      notes: "",
    });
    setEditingId(null);
  }

  function startEdit(row: ThresholdWithBrand) {
    setDraft({
      brandId: row.brand_id,
      minMarginPct: String(row.min_margin_pct),
      notes: row.notes ?? "",
    });
    setEditingId(row.id);
  }

  async function handleSave() {
    if (!draft || !profile) return;
    const parsed = parseFloat(draft.minMarginPct);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      toast({ title: "Invalid margin", description: "Enter a number between 0 and 100", variant: "destructive" });
      return;
    }
    setSaving(true);
    const result = await upsertThreshold({
      id: editingId ?? undefined,
      workspaceId: profile.active_workspace_id ?? "default",
      brandId: draft.brandId,
      minMarginPct: parsed,
      notes: draft.notes.trim() || null,
      updatedBy: profile.id,
    });
    setSaving(false);
    if ("error" in result) {
      toast({ title: "Save failed", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Threshold saved" });
    setDraft(null);
    setEditingId(null);
    void refresh();
  }

  async function handleDelete(id: string) {
    const result = await deleteThreshold(id);
    if ("error" in result) {
      toast({ title: "Delete failed", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Threshold removed" });
    void refresh();
  }

  const availableBrands = brands.filter(
    (b) => !usedBrandIds.has(b.id) || (editingId && thresholds.find((t) => t.id === editingId)?.brand_id === b.id),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Margin Thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Quotes saved below the applicable floor require a one-sentence reason and are logged
            to the exceptions table. Workspace default applies to brands without their own row.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Scope</th>
                      <th className="px-3 py-2">Minimum margin</th>
                      <th className="px-3 py-2">Notes</th>
                      <th className="px-3 py-2" aria-hidden />
                    </tr>
                  </thead>
                  <tbody>
                    {thresholds.map((t) => (
                      <tr key={t.id} className="border-b">
                        <td className="px-3 py-2 font-medium">
                          {t.brand_id === null ? (
                            <Badge variant="outline">Workspace default</Badge>
                          ) : (
                            t.qb_brands?.name ?? t.brand_id.slice(0, 8) + "…"
                          )}
                        </td>
                        <td className="px-3 py-2">{t.min_margin_pct}%</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{t.notes ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => startEdit(t)}
                            className="text-xs text-primary hover:underline mr-3"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(t.id)}
                            className="text-xs text-destructive hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {thresholds.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No thresholds configured. Add a workspace default to start enforcing.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!draft && (
                <div className="flex gap-2">
                  {!hasDefault && (
                    <Button variant="outline" size="sm" onClick={() => startNew("default")}>
                      <Plus className="mr-1 h-3 w-3" /> Add workspace default
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => startNew("brand")}>
                    <Plus className="mr-1 h-3 w-3" /> Add brand override
                  </Button>
                </div>
              )}

              {draft && (
                <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                  <div className="text-sm font-semibold">
                    {editingId ? "Edit threshold" : "New threshold"}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label>Scope</Label>
                      {draft.brandId === null ? (
                        <div className="text-sm text-muted-foreground py-2">Workspace default</div>
                      ) : (
                        <select
                          value={draft.brandId ?? ""}
                          onChange={(e) => setDraft({ ...draft, brandId: e.target.value })}
                          disabled={!!editingId}
                          className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm"
                        >
                          <option value="">Pick a brand…</option>
                          {availableBrands.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="min-margin">Minimum margin %</Label>
                      <Input
                        id="min-margin"
                        value={draft.minMarginPct}
                        onChange={(e) => setDraft({ ...draft, minMarginPct: e.target.value })}
                        placeholder="15"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="min-notes">Notes (optional)</Label>
                      <Input
                        id="min-notes"
                        value={draft.notes}
                        onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                        placeholder="Why this floor?"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => { setDraft(null); setEditingId(null); }} disabled={saving}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={saving || !draft.minMarginPct || (draft.brandId === "" ? true : false)}
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Rollup */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Exceptions</CardTitle>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Period:</span>
              {(["30", "90", "all"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md px-2 py-0.5 transition-colors ${
                    period === p ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  {p === "all" ? "All time" : `${p}d`}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !rollup ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rollup.total === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No margin exceptions in this period. Pricing is holding the floors.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-2xl font-bold">{rollup.total}</div>
                  <div className="text-xs text-muted-foreground">Exceptions</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-warning">
                    {rollup.avgDeltaPts != null ? `${rollup.avgDeltaPts.toFixed(1)} pts` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">Avg below floor</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-destructive">
                    ${(rollup.totalEstimatedGapCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-xs text-muted-foreground">Est. margin erosion</div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    By rep
                  </h3>
                  {rollup.byRep.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No data</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {rollup.byRep.slice(0, 10).map((row) => (
                        <li key={row.repId ?? "unknown"} className="flex items-center justify-between">
                          <span className="font-mono">{row.repId ? row.repId.slice(0, 8) + "…" : "unknown"}</span>
                          <span className="text-muted-foreground">
                            {row.count} · avg {row.avgDeltaPts.toFixed(1)} pts
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    By brand
                  </h3>
                  {rollup.byBrand.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No data</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {rollup.byBrand.slice(0, 10).map((row) => (
                        <li key={row.brandId ?? "unknown"} className="flex items-center justify-between">
                          <span>{row.brandId ?? <span className="text-muted-foreground">unresolved</span>}</span>
                          <span className="text-muted-foreground">
                            {row.count} · avg {row.avgDeltaPts.toFixed(1)} pts
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {rollup.recent.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recent reasons
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {rollup.recent.slice(0, 10).map((row) => (
                      <li key={row.id} className="rounded border border-border bg-background p-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {row.quoted_margin_pct}% vs {row.threshold_margin_pct}% floor
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(row.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="mt-1 italic text-muted-foreground">"{row.reason}"</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
