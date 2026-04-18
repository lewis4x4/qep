import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  centsToDollars,
  dollarsToCents,
  getServiceCredits,
  upsertServiceCredits,
  type ServiceCreditRow,
} from "../../lib/deal-economics-api";

interface FormState {
  compactCredit: string;
  largeCredit: string;
  forestryCredit: string;
  travelBudget: string;
}

function rowsToForm(rows: ServiceCreditRow[]): FormState {
  const byCategory = Object.fromEntries(rows.map((r) => [r.category, r]));
  const compact  = byCategory["compact"]  ?? { credit_cents: 150000, travel_budget_cents: 20000 };
  const large    = byCategory["large"]    ?? { credit_cents: 250000, travel_budget_cents: 20000 };
  const forestry = byCategory["forestry"] ?? { credit_cents: 350000, travel_budget_cents: 20000 };
  return {
    compactCredit:  String(centsToDollars(compact.credit_cents)),
    largeCredit:    String(centsToDollars(large.credit_cents)),
    forestryCredit: String(centsToDollars(forestry.credit_cents)),
    travelBudget:   String(centsToDollars(compact.travel_budget_cents)),
  };
}

export function ServiceCreditsForm() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const isReadOnly = profile?.role === "rep";

  const [form, setForm] = useState<FormState>({
    compactCredit:  "1500",
    largeCredit:    "2500",
    forestryCredit: "3500",
    travelBudget:   "200",
  });
  const [rows, setRows] = useState<ServiceCreditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    getServiceCredits().then((data) => {
      setRows(data);
      setForm(rowsToForm(data));
    });
  }, []);

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setErrorMsg(null);
    setSaving(true);
    try {
      const travelCents = dollarsToCents(parseFloat(form.travelBudget) || 0);
      const workspaceId = rows[0]?.workspace_id ?? "default";

      const payload = [
        { workspace_id: workspaceId, category: "compact",  credit_cents: dollarsToCents(parseFloat(form.compactCredit) || 0),  travel_budget_cents: travelCents },
        { workspace_id: workspaceId, category: "large",    credit_cents: dollarsToCents(parseFloat(form.largeCredit) || 0),    travel_budget_cents: travelCents },
        { workspace_id: workspaceId, category: "forestry", credit_cents: dollarsToCents(parseFloat(form.forestryCredit) || 0), travel_budget_cents: travelCents },
      ];

      const result = await upsertServiceCredits(payload);
      if ("error" in result) {
        setErrorMsg(result.error);
      } else {
        toast({ title: "Service credits saved", description: "Defaults updated for all categories." });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Service Credit Defaults</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMsg && (
          <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="compact-credit">Compact Credit ($)</Label>
            <Input
              id="compact-credit"
              type="number"
              min={0}
              step={0.01}
              value={form.compactCredit}
              onChange={(e) => handleChange("compactCredit", e.target.value)}
              disabled={isReadOnly || saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="large-credit">Large Credit ($)</Label>
            <Input
              id="large-credit"
              type="number"
              min={0}
              step={0.01}
              value={form.largeCredit}
              onChange={(e) => handleChange("largeCredit", e.target.value)}
              disabled={isReadOnly || saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="forestry-credit">Forestry Credit ($)</Label>
            <Input
              id="forestry-credit"
              type="number"
              min={0}
              step={0.01}
              value={form.forestryCredit}
              onChange={(e) => handleChange("forestryCredit", e.target.value)}
              disabled={isReadOnly || saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="travel-budget">Travel Budget ($) — all categories</Label>
            <Input
              id="travel-budget"
              type="number"
              min={0}
              step={0.01}
              value={form.travelBudget}
              onChange={(e) => handleChange("travelBudget", e.target.value)}
              disabled={isReadOnly || saving}
            />
          </div>
        </div>

        {!isReadOnly && (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Credits"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
