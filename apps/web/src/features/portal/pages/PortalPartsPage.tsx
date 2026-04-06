import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { PartsReorderHistory } from "../components/PartsReorderHistory";
import { Plus, Sparkles, Trash2 } from "lucide-react";

type LineDraft = { part_number: string; quantity: number };

type FleetRow = {
  id: string;
  make: string;
  model: string;
  serial_number?: string | null;
};

type SuggestPmKitResponse =
  | {
      ok: true;
      ai_suggested_pm_kit: boolean;
      ai_suggestion_reason: string;
      line_items: Array<{
        part_number: string;
        quantity: number;
        description?: string;
        is_ai_suggested?: boolean;
      }>;
      matched_job_code: {
        id: string;
        job_name: string;
        make: string;
        model_family: string | null;
      };
    }
  | {
      ok: false;
      error: string;
      message: string;
      matched_job_code?: {
        id: string;
        job_name: string;
        make: string;
        model_family: string | null;
      };
    };

export function PortalPartsPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialFleetId = searchParams.get("fleet_id") ?? "";
  const [lines, setLines] = useState<LineDraft[]>([{ part_number: "", quantity: 1 }]);
  const [fleetId, setFleetId] = useState<string>(initialFleetId);
  const [aiReason, setAiReason] = useState<string | null>(null);
  const [matchedJobLabel, setMatchedJobLabel] = useState<string | null>(null);
  /** When true, draft submit includes ai_suggested_pm_kit + ai_suggestion_reason. Cleared if user edits lines. */
  const [aiKitSubmitEligible, setAiKitSubmitEligible] = useState(false);

  const { data: fleetData } = useQuery({
    queryKey: ["portal", "fleet"],
    queryFn: portalApi.getFleet,
    staleTime: 60_000,
  });

  const fleet: FleetRow[] = (fleetData?.fleet as FleetRow[] | undefined) ?? [];

  useEffect(() => {
    if (!fleetId && fleet.length > 0) {
      setFleetId(fleet[0].id);
    }
  }, [fleet, fleetId]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "parts-orders"],
    queryFn: portalApi.getPartsOrders,
    staleTime: 20_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.createPartsOrder(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal", "parts-orders"] });
      setLines([{ part_number: "", quantity: 1 }]);
      setAiReason(null);
      setMatchedJobLabel(null);
      setAiKitSubmitEligible(false);
    },
  });

  const submitToDealerMutation = useMutation({
    mutationFn: (orderId: string) => portalApi.submitPartsOrder(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal", "parts-orders"] });
    },
  });

  const suggestMutation = useMutation({
    mutationFn: async () => {
      if (!fleetId) throw new Error("Select a machine from your fleet first.");
      return portalApi.suggestPmKit(fleetId) as Promise<SuggestPmKitResponse>;
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setAiReason(res.message);
        setMatchedJobLabel(
          res.matched_job_code ? `${res.matched_job_code.job_name} (${res.matched_job_code.make})` : null,
        );
        setAiKitSubmitEligible(false);
        return;
      }
      const mapped: LineDraft[] = res.line_items.map((l) => ({
        part_number: l.part_number,
        quantity: Math.max(1, l.quantity),
      }));
      setLines(mapped.length > 0 ? mapped : [{ part_number: "", quantity: 1 }]);
      setAiReason(res.ai_suggestion_reason);
      setMatchedJobLabel(`${res.matched_job_code.job_name} · ${res.matched_job_code.make}`);
      setAiKitSubmitEligible(true);
    },
  });

  const orders = data?.orders ?? [];

  const addLine = () => setLines((prev) => [...prev, { part_number: "", quantity: 1 }]);
  const removeLine = (i: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
    clearAiSubmitMetadata();
  };

  const submit = () => {
    const line_items = lines
      .map((l) => ({
        part_number: l.part_number.trim(),
        quantity: Math.max(1, Math.floor(Number(l.quantity)) || 1),
      }))
      .filter((l) => l.part_number.length > 0);
    if (line_items.length === 0) return;

    const body: Record<string, unknown> = {
      line_items,
      fleet_id: fleetId || null,
    };
    if (aiKitSubmitEligible && aiReason) {
      body.ai_suggested_pm_kit = true;
      body.ai_suggestion_reason = aiReason;
    }
    createMutation.mutate(body);
  };

  const clearAiSubmitMetadata = () => setAiKitSubmitEligible(false);

  const resetSuggestionContext = () => {
    setAiKitSubmitEligible(false);
    setAiReason(null);
    setMatchedJobLabel(null);
  };

  /** Populate the line draft from a past order (one-click reorder). */
  const handleReorder = (
    items: Array<{ part_number: string; quantity: number; description?: string }>,
  ) => {
    const mapped: LineDraft[] = items
      .filter((i) => i.part_number)
      .map((i) => ({ part_number: i.part_number, quantity: Math.max(1, i.quantity) }));
    if (mapped.length > 0) {
      setLines(mapped);
      resetSuggestionContext();
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Parts orders</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Build a cart, save it as a draft, then submit it to the dealership when you are ready. AI-suggested PM kits use
        the same service templates your shop relies on.
      </p>

      {/* Wave 6 Task 7 — one-click reorder from purchase history */}
      <div className="mb-6">
        <PartsReorderHistory
          fleetFilterId={fleetId || undefined}
          onReorder={handleReorder}
        />
      </div>

      {fleet.length > 0 && (
        <Card className="p-4 mb-6 space-y-3">
          <p className="text-sm font-medium text-foreground">Equipment context</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Fleet machine</label>
              <select
                value={fleetId}
                onChange={(e) => {
                  setFleetId(e.target.value);
                  resetSuggestionContext();
                }}
                className="w-full rounded border border-input bg-card px-3 py-2 text-sm mt-1"
              >
                {fleet.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.make} {f.model}
                    {f.serial_number ? ` · ${f.serial_number}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1"
              disabled={!fleetId || suggestMutation.isPending}
              onClick={() => suggestMutation.mutate()}
            >
              <Sparkles className="h-4 w-4" />
              {suggestMutation.isPending ? "Suggesting…" : "Suggest PM kit"}
            </Button>
          </div>
          {matchedJobLabel && (
            <p className="text-xs text-muted-foreground">
              Template: <span className="text-foreground font-medium">{matchedJobLabel}</span>
            </p>
          )}
          {aiReason && (
            <div
              className={`text-sm rounded-md border p-3 ${
                aiKitSubmitEligible
                  ? "border-amber-500/40 bg-amber-500/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground"
              }`}
            >
              {aiKitSubmitEligible ? (
                <>
                  <span className="font-medium text-amber-200/90">AI + dealership template — </span>
                  {aiReason}
                </>
              ) : (
                aiReason
              )}
            </div>
          )}
          {suggestMutation.isError && (
            <p className="text-sm text-destructive">
              {suggestMutation.error instanceof Error ? suggestMutation.error.message : "Suggestion failed"}
            </p>
          )}
        </Card>
      )}

      <Card className="p-4 mb-6 space-y-3">
        <p className="text-sm font-medium text-foreground">New order</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground">Part #</label>
              <input
                value={line.part_number}
                onChange={(e) => {
                  setLines((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, part_number: e.target.value } : row)),
                  );
                  clearAiSubmitMetadata();
                }}
                className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                placeholder="SKU / part number"
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-muted-foreground">Qty</label>
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((row, j) =>
                      j === i ? { ...row, quantity: Number(e.target.value) || 1 } : row,
                    ),
                  )
                }
                className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
              />
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="Remove line">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              addLine();
              clearAiSubmitMetadata();
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Add line
          </Button>
          <Button size="sm" onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Saving…" : "Save as draft"}
          </Button>
        </div>
        {createMutation.isError && (
          <p className="text-sm text-destructive">
            {createMutation.error instanceof Error ? createMutation.error.message : "Could not create order"}
          </p>
        )}
      </Card>

      {isLoading && (
        <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Card key={i} className="h-20 animate-pulse" />)}</div>
      )}
      {isError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-400">Failed to load orders. Sign in with your portal account.</p>
        </Card>
      )}

      <div className="space-y-2">
        {orders.map((o: Record<string, unknown>) => {
          const oid = o.id as string;
          const isDraft = String(o.status ?? "") === "draft";
          const submitting =
            submitToDealerMutation.isPending && submitToDealerMutation.variables === oid;
          return (
            <Card key={oid} className="p-4">
              <div className="flex justify-between gap-2 flex-wrap items-start">
                <span className="text-sm font-semibold text-foreground capitalize">{String(o.status ?? "")}</span>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-xs text-muted-foreground">
                    {o.created_at ? new Date(String(o.created_at)).toLocaleString() : ""}
                  </span>
                  {isDraft && (
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={submitting}
                      onClick={() => submitToDealerMutation.mutate(oid)}
                    >
                      {submitting ? "Submitting…" : "Submit to dealership"}
                    </Button>
                  )}
                </div>
              </div>
              {submitToDealerMutation.isError && submitToDealerMutation.variables === oid && (
                <p className="text-sm text-destructive mt-2">
                  {submitToDealerMutation.error instanceof Error
                    ? submitToDealerMutation.error.message
                    : "Could not submit"}
                </p>
              )}
              {o.ai_suggested_pm_kit === true && typeof o.ai_suggestion_reason === "string" && (
                <p className="mt-2 text-xs text-amber-200/90 border-l-2 border-amber-500/60 pl-2">{o.ai_suggestion_reason}</p>
              )}
              <pre className="mt-2 text-[10px] bg-muted/40 rounded p-2 overflow-x-auto max-h-32">
                {JSON.stringify(o.line_items, null, 2)}
              </pre>
            </Card>
          );
        })}
        {!isLoading && orders.length === 0 && (
          <Card className="border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No parts orders yet.</p>
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
