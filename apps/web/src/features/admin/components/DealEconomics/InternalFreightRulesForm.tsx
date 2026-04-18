import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  centsToDollars,
  dollarsToCents,
  createFreightRule,
  deleteFreightRule,
  getFreightRules,
  updateFreightRule,
  type FreightRuleInput,
  type FreightRuleRow,
} from "../../lib/deal-economics-api";

type RateType = "flat" | "per_mile" | "per_cwt";

interface RuleForm {
  weight_from_lbs: string;
  weight_to_lbs: string;
  distance_from_miles: string;
  distance_to_miles: string;
  rate_type: RateType;
  rate_amount_dollars: string;
  priority: string;
}

const EMPTY_FORM: RuleForm = {
  weight_from_lbs: "",
  weight_to_lbs: "",
  distance_from_miles: "",
  distance_to_miles: "",
  rate_type: "flat",
  rate_amount_dollars: "",
  priority: "100",
};

function formToInput(f: RuleForm): FreightRuleInput {
  return {
    weight_from_lbs:     f.weight_from_lbs     ? parseInt(f.weight_from_lbs)     : null,
    weight_to_lbs:       f.weight_to_lbs       ? parseInt(f.weight_to_lbs)       : null,
    distance_from_miles: f.distance_from_miles ? parseInt(f.distance_from_miles) : null,
    distance_to_miles:   f.distance_to_miles   ? parseInt(f.distance_to_miles)   : null,
    rate_type:           f.rate_type,
    rate_amount_cents:   dollarsToCents(parseFloat(f.rate_amount_dollars) || 0),
    priority:            parseInt(f.priority) || 100,
  };
}

function rowToForm(row: FreightRuleRow): RuleForm {
  return {
    weight_from_lbs:     row.weight_from_lbs     != null ? String(row.weight_from_lbs)     : "",
    weight_to_lbs:       row.weight_to_lbs       != null ? String(row.weight_to_lbs)       : "",
    distance_from_miles: row.distance_from_miles != null ? String(row.distance_from_miles) : "",
    distance_to_miles:   row.distance_to_miles   != null ? String(row.distance_to_miles)   : "",
    rate_type:           row.rate_type as RateType,
    rate_amount_dollars: String(centsToDollars(row.rate_amount_cents)),
    priority:            String(row.priority),
  };
}

const RATE_TYPE_LABELS: Record<RateType, string> = {
  flat:     "Flat",
  per_mile: "Per Mile",
  per_cwt:  "Per CWT",
};

export function InternalFreightRulesForm() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isReadOnly = profile?.role === "rep";

  const [rules, setRules]           = useState<FreightRuleRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  // Add form
  const [showAdd, setShowAdd]       = useState(false);
  const [addForm, setAddForm]       = useState<RuleForm>(EMPTY_FORM);

  // Edit
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editForm, setEditForm]     = useState<RuleForm>(EMPTY_FORM);

  // Delete confirm
  const [deleteId, setDeleteId]     = useState<string | null>(null);

  useEffect(() => {
    getFreightRules().then((data) => {
      setRules(data);
      setLoading(false);
    });
  }, []);

  async function handleAdd() {
    setErrorMsg(null);
    setSaving(true);
    const result = await createFreightRule(formToInput(addForm));
    setSaving(false);
    if ("error" in result) {
      setErrorMsg(result.error);
      return;
    }
    toast({ title: "Freight rule added" });
    setShowAdd(false);
    setAddForm(EMPTY_FORM);
    const refreshed = await getFreightRules();
    setRules(refreshed);
  }

  async function handleUpdate() {
    if (!editingId) return;
    setErrorMsg(null);
    setSaving(true);
    const result = await updateFreightRule(editingId, formToInput(editForm));
    setSaving(false);
    if ("error" in result) {
      setErrorMsg(result.error);
      return;
    }
    toast({ title: "Freight rule updated" });
    setEditingId(null);
    const refreshed = await getFreightRules();
    setRules(refreshed);
  }

  async function handleDelete() {
    if (!deleteId) return;
    setSaving(true);
    const result = await deleteFreightRule(deleteId);
    setSaving(false);
    setDeleteId(null);
    if ("error" in result) {
      setErrorMsg(result.error);
      return;
    }
    toast({ title: "Freight rule deleted" });
    const refreshed = await getFreightRules();
    setRules(refreshed);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Internal Freight Rules</CardTitle>
        {!isReadOnly && (
          <Button size="sm" onClick={() => { setShowAdd(true); setAddForm(EMPTY_FORM); }}>
            Add Rule
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMsg && (
          <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMsg}
          </div>
        )}

        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No freight rules configured. Iron Advisor will use inbound freight keys only until rules are added.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-3">Wt From (lbs)</th>
                  <th className="pb-2 pr-3">Wt To (lbs)</th>
                  <th className="pb-2 pr-3">Dist From (mi)</th>
                  <th className="pb-2 pr-3">Dist To (mi)</th>
                  <th className="pb-2 pr-3">Rate Type</th>
                  <th className="pb-2 pr-3">Rate ($)</th>
                  <th className="pb-2 pr-3">Priority</th>
                  {!isReadOnly && <th className="pb-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) =>
                  editingId === rule.id ? (
                    <tr key={rule.id} className="border-b">
                      <td className="py-1 pr-2"><Input className="h-7 w-20" value={editForm.weight_from_lbs} onChange={(e) => setEditForm((f) => ({ ...f, weight_from_lbs: e.target.value }))} /></td>
                      <td className="py-1 pr-2"><Input className="h-7 w-20" value={editForm.weight_to_lbs} onChange={(e) => setEditForm((f) => ({ ...f, weight_to_lbs: e.target.value }))} /></td>
                      <td className="py-1 pr-2"><Input className="h-7 w-20" value={editForm.distance_from_miles} onChange={(e) => setEditForm((f) => ({ ...f, distance_from_miles: e.target.value }))} /></td>
                      <td className="py-1 pr-2"><Input className="h-7 w-20" value={editForm.distance_to_miles} onChange={(e) => setEditForm((f) => ({ ...f, distance_to_miles: e.target.value }))} /></td>
                      <td className="py-1 pr-2">
                        <select className="h-7 rounded border bg-background px-1 text-sm" value={editForm.rate_type} onChange={(e) => setEditForm((f) => ({ ...f, rate_type: e.target.value as RateType }))}>
                          {(["flat", "per_mile", "per_cwt"] as RateType[]).map((t) => <option key={t} value={t}>{RATE_TYPE_LABELS[t]}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2"><Input className="h-7 w-24" type="number" value={editForm.rate_amount_dollars} onChange={(e) => setEditForm((f) => ({ ...f, rate_amount_dollars: e.target.value }))} /></td>
                      <td className="py-1 pr-2"><Input className="h-7 w-16" type="number" value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))} /></td>
                      <td className="py-1 space-x-1">
                        <Button size="sm" variant="default" disabled={saving} onClick={handleUpdate}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={rule.id} className="border-b">
                      <td className="py-2 pr-3">{rule.weight_from_lbs ?? "—"}</td>
                      <td className="py-2 pr-3">{rule.weight_to_lbs ?? "—"}</td>
                      <td className="py-2 pr-3">{rule.distance_from_miles ?? "—"}</td>
                      <td className="py-2 pr-3">{rule.distance_to_miles ?? "—"}</td>
                      <td className="py-2 pr-3">{RATE_TYPE_LABELS[rule.rate_type as RateType] ?? rule.rate_type}</td>
                      <td className="py-2 pr-3">${centsToDollars(rule.rate_amount_cents).toFixed(2)}</td>
                      <td className="py-2 pr-3">{rule.priority}</td>
                      {!isReadOnly && (
                        <td className="py-2 space-x-1">
                          <Button size="sm" variant="outline" onClick={() => { setEditingId(rule.id); setEditForm(rowToForm(rule)); }}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(rule.id)}>Delete</Button>
                        </td>
                      )}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Add rule inline form */}
        {showAdd && !isReadOnly && (
          <div className="rounded-md border p-4 space-y-3">
            <p className="text-sm font-medium">New Rule</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Weight From (lbs)</Label>
                <Input className="h-8" value={addForm.weight_from_lbs} onChange={(e) => setAddForm((f) => ({ ...f, weight_from_lbs: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Weight To (lbs)</Label>
                <Input className="h-8" value={addForm.weight_to_lbs} onChange={(e) => setAddForm((f) => ({ ...f, weight_to_lbs: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Distance From (mi)</Label>
                <Input className="h-8" value={addForm.distance_from_miles} onChange={(e) => setAddForm((f) => ({ ...f, distance_from_miles: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Distance To (mi)</Label>
                <Input className="h-8" value={addForm.distance_to_miles} onChange={(e) => setAddForm((f) => ({ ...f, distance_to_miles: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Rate Type</Label>
                <select className="h-8 w-full rounded border bg-background px-2 text-sm" value={addForm.rate_type} onChange={(e) => setAddForm((f) => ({ ...f, rate_type: e.target.value as RateType }))}>
                  {(["flat", "per_mile", "per_cwt"] as RateType[]).map((t) => <option key={t} value={t}>{RATE_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Rate Amount ($)</Label>
                <Input className="h-8" type="number" value={addForm.rate_amount_dollars} onChange={(e) => setAddForm((f) => ({ ...f, rate_amount_dollars: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Input className="h-8" type="number" value={addForm.priority} onChange={(e) => setAddForm((f) => ({ ...f, priority: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={saving} onClick={handleAdd}>Save Rule</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Delete confirm dialog */}
        <Dialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Freight Rule</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This rule will be permanently removed. This cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button variant="destructive" disabled={saving} onClick={handleDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
