import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import { useAuth } from "@/hooks/useAuth";
import { InspectionChecklist } from "../components/InspectionChecklist";
import {
  computeDamageAssessment,
  DEFAULT_RETURN_CHECKLIST,
  inspectionComplete,
  normalizeReturnChecklist,
  refundMethodMatchesOriginal,
  serializeReturnChecklist,
  updateReturnChecklistItem,
} from "../lib/rental-return-branching";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Wrench } from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  inspection_pending: { label: "Inspection Pending", color: "bg-amber-500/10 text-amber-300" },
  decision_pending: { label: "Decision Pending", color: "bg-blue-500/10 text-blue-300" },
  clean_return: { label: "Clean Return", color: "bg-emerald-500/10 text-emerald-300" },
  damage_assessment: { label: "Damage Assessment", color: "bg-red-500/10 text-red-300" },
  work_order_open: { label: "Work Order Open", color: "bg-violet-500/10 text-violet-300" },
  refund_processing: { label: "Refund Processing", color: "bg-cyan-500/10 text-cyan-300" },
  completed: { label: "Completed", color: "bg-muted text-muted-foreground" },
};

const PAYMENT_METHODS = ["cash", "check", "wire", "credit_card", "debit_card", "ach"] as const;
const PHOTO_BUCKET = "equipment-photos";

interface RentalReturnRow {
  id: string;
  balance_due: number | null;
  charge_amount: number | null;
  condition_photos: Json | null;
  created_at: string;
  credit_invoice_number: string | null;
  damage_description: string | null;
  decided_by: string | null;
  deposit_amount: number | null;
  deposit_covers_charges: boolean | null;
  equipment_id: string | null;
  has_charges: boolean | null;
  inspection_checklist: Json | null;
  inspection_date: string | null;
  inspector_id: string | null;
  original_payment_method: string | null;
  refund_method: string | null;
  refund_status: string | null;
  rental_contract_reference: string | null;
  status: string;
  work_order_number: string | null;
}

function asPhotoArray(value: Json | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value ?? 0);
}

async function uploadReturnPhoto(returnId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `rental-returns/${returnId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function buildWorkOrderNumber(returnId: string): string {
  return `RR-WO-${returnId.slice(0, 8).toUpperCase()}`;
}

export function RentalReturnsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [chargeInput, setChargeInput] = useState("");
  const [depositInput, setDepositInput] = useState("");
  const [damageDescription, setDamageDescription] = useState("");
  const [rentalContractReference, setRentalContractReference] = useState("");
  const [creditInvoiceNumber, setCreditInvoiceNumber] = useState("");
  const [originalPaymentMethod, setOriginalPaymentMethod] = useState<string | null>(null);
  const [refundMethod, setRefundMethod] = useState<string | null>(null);

  const { data: returns = [], isLoading, isError, error } = useQuery({
    queryKey: ["ops", "rental-returns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_returns")
        .select("*")
        .neq("status", "completed")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RentalReturnRow[];
    },
    staleTime: 15_000,
  });

  const selectedReturn = useMemo(() => {
    if (returns.length === 0) return null;
    return returns.find((row) => row.id === selectedId) ?? returns[0] ?? null;
  }, [returns, selectedId]);

  const updateReturnMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<RentalReturnRow> }) => {
      const { error } = await supabase.from("rental_returns").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setStatusError(null);
      queryClient.invalidateQueries({ queryKey: ["ops", "rental-returns"] });
    },
    onError: (mutationError) => {
      setStatusError(mutationError instanceof Error ? mutationError.message : "Rental return update failed.");
    },
  });

  const checklistItems = normalizeReturnChecklist(selectedReturn?.inspection_checklist ?? null);
  const conditionPhotos = asPhotoArray(selectedReturn?.condition_photos);
  const inspectionReady = inspectionComplete(checklistItems, conditionPhotos.length);
  const chargeValue = chargeInput.trim() ? Number(chargeInput) : selectedReturn?.charge_amount ?? null;
  const depositValue = depositInput.trim() ? Number(depositInput) : selectedReturn?.deposit_amount ?? null;
  const damageMath = computeDamageAssessment(chargeValue, depositValue);

  async function patchSelectedReturn(patch: Partial<RentalReturnRow>) {
    if (!selectedReturn) return;
    updateReturnMutation.mutate({ id: selectedReturn.id, patch });
  }

  async function handleConditionPhoto(file: File | null) {
    if (!file || !selectedReturn) return;
    try {
      const url = await uploadReturnPhoto(selectedReturn.id, file);
      const nextPhotos = [...conditionPhotos, url];
      const nextChecklist = updateReturnChecklistItem(checklistItems, "Capture condition photo evidence", true);
      patchSelectedReturn({
        condition_photos: nextPhotos,
        inspection_checklist: serializeReturnChecklist(nextChecklist),
      });
    } catch (uploadError) {
      setStatusError(uploadError instanceof Error ? uploadError.message : "Condition photo upload failed.");
    }
  }

  if (isLoading) {
    return <div className="space-y-4 p-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-20 animate-pulse" />)}</div>;
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="border-red-500/20 bg-red-500/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-red-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">Rental return workflow unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Rental returns could not be loaded."}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">Rental Returns</h1>
        <p className="text-sm text-muted-foreground">
          Branching workflow: inspection → decision → clean credit/refund path or damaged work-order/charge path.
        </p>
      </div>

      {statusError && (
        <Card className="mb-4 border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{statusError}</span>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-3">
          {returns.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">No active rental returns.</p>
            </Card>
          ) : (
            returns.map((ret) => {
              const active = selectedReturn?.id === ret.id;
              const statusInfo = STATUS_LABELS[ret.status] ?? STATUS_LABELS.inspection_pending;
              return (
                <button
                  key={ret.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(ret.id);
                    setChargeInput(ret.charge_amount?.toString() ?? "");
                    setDepositInput(ret.deposit_amount?.toString() ?? "");
                    setDamageDescription(ret.damage_description ?? "");
                    setRentalContractReference(ret.rental_contract_reference ?? "");
                    setCreditInvoiceNumber(ret.credit_invoice_number ?? "");
                    setOriginalPaymentMethod(ret.original_payment_method ?? null);
                    setRefundMethod(ret.refund_method ?? ret.original_payment_method ?? null);
                    setStatusError(null);
                  }}
                  className={`w-full rounded-xl border text-left transition ${active ? "border-qep-orange/40 bg-qep-orange/5" : "border-border bg-background hover:border-white/20"}`}
                >
                  <Card className="border-none bg-transparent p-4 shadow-none">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                    <div className="mt-2 flex items-center gap-2">
                      {ret.has_charges === false && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                      {ret.has_charges === true && <AlertTriangle className="h-4 w-4 text-red-400" />}
                      <span className="text-sm font-medium text-foreground">
                        {ret.has_charges === false ? "Clean return" : ret.has_charges === true ? "Damage found" : "Awaiting inspection"}
                      </span>
                    </div>
                    {ret.damage_description && (
                      <p className="mt-1 text-xs text-red-300">{ret.damage_description}</p>
                    )}
                    {ret.charge_amount != null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Charges {formatCurrency(ret.charge_amount)} · Deposit {formatCurrency(ret.deposit_amount)}
                      </p>
                    )}
                    {ret.refund_status && ret.refund_status !== "completed" && (
                      <p className="mt-1 text-xs text-cyan-300">
                        <RotateCcw className="mr-1 inline h-3 w-3" />
                        Refund {ret.refund_status}
                      </p>
                    )}
                  </Card>
                </button>
              );
            })
          )}
        </div>

        {selectedReturn ? (
          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-qep-orange">Step 1 · Iron Man inspection</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Finish the return inspection before the branch can decide whether this is a clean refund or a damage case.
              </p>
            </Card>

            <InspectionChecklist
              title="Return inspection checklist"
              items={checklistItems}
              onUpdate={(nextItems) => patchSelectedReturn({ inspection_checklist: serializeReturnChecklist(nextItems) })}
            />

            <Card className="p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="return-photo">Condition photos</Label>
                  <Input
                    id="return-photo"
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => void handleConditionPhoto(event.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground">
                  {conditionPhotos.length > 0 ? `${conditionPhotos.length} condition photo${conditionPhotos.length === 1 ? "" : "s"} uploaded.` : "No condition photos yet."}
                </div>
              </div>
              <div className="mt-3">
                <Button
                  onClick={() => {
                    if (!inspectionReady) {
                      setStatusError("Complete every inspection step and upload at least one condition photo before moving to decision.");
                      return;
                    }
                    patchSelectedReturn({
                      inspection_date: new Date().toISOString().slice(0, 10),
                      inspector_id: profile?.id ?? null,
                      status: "decision_pending",
                    });
                  }}
                  disabled={updateReturnMutation.isPending}
                >
                  {updateReturnMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  Move to decision
                </Button>
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-qep-orange">Step 2 · Branch decision</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (selectedReturn.status === "inspection_pending") {
                      setStatusError("Finish inspection before choosing the return path.");
                      return;
                    }
                    patchSelectedReturn({
                      has_charges: false,
                      decided_by: profile?.id ?? null,
                      status: "clean_return",
                    });
                  }}
                >
                  Clean return path
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (selectedReturn.status === "inspection_pending") {
                      setStatusError("Finish inspection before opening the damage path.");
                      return;
                    }
                    patchSelectedReturn({
                      has_charges: true,
                      decided_by: profile?.id ?? null,
                      status: "damage_assessment",
                    });
                  }}
                >
                  Damaged return path
                </Button>
              </div>
            </Card>

            {(selectedReturn.status === "clean_return" || selectedReturn.status === "refund_processing") && (
              <Card className="p-4">
                <p className="text-sm font-semibold text-foreground">Clean return branch</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Refund method must match the original payment method from the contract.
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="contract-reference">Rental contract reference</Label>
                    <Input
                      id="contract-reference"
                      value={rentalContractReference}
                      onChange={(event) => setRentalContractReference(event.target.value)}
                      onBlur={() => patchSelectedReturn({ rental_contract_reference: rentalContractReference.trim() || null })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="credit-invoice">Credit invoice number</Label>
                    <Input
                      id="credit-invoice"
                      value={creditInvoiceNumber}
                      onChange={(event) => setCreditInvoiceNumber(event.target.value)}
                      onBlur={() => patchSelectedReturn({ credit_invoice_number: creditInvoiceNumber.trim() || null })}
                    />
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Original payment method</Label>
                    <div className="flex flex-wrap gap-2">
                      {PAYMENT_METHODS.map((method) => (
                        <Button
                          key={method}
                          type="button"
                          variant={originalPaymentMethod === method ? "default" : "outline"}
                          size="sm"
                          onClick={() => {
                            setOriginalPaymentMethod(method);
                            patchSelectedReturn({ original_payment_method: method });
                          }}
                        >
                          {method.replace(/_/g, " ")}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Refund method</Label>
                    <div className="flex flex-wrap gap-2">
                      {PAYMENT_METHODS.map((method) => (
                        <Button
                          key={method}
                          type="button"
                          variant={refundMethod === method ? "default" : "outline"}
                          size="sm"
                          onClick={() => setRefundMethod(method)}
                        >
                          {method.replace(/_/g, " ")}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      if (!refundMethodMatchesOriginal(originalPaymentMethod, refundMethod)) {
                        setStatusError("Refund method must match the original payment method.");
                        return;
                      }
                      patchSelectedReturn({
                        refund_method: refundMethod,
                        refund_status: "processing",
                        status: "refund_processing",
                      });
                    }}
                  >
                    Start refund processing
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!refundMethodMatchesOriginal(originalPaymentMethod, refundMethod ?? originalPaymentMethod)) {
                        setStatusError("Refund method must match the original payment method before completion.");
                        return;
                      }
                      patchSelectedReturn({
                        refund_method: refundMethod ?? originalPaymentMethod,
                        refund_status: "completed",
                        status: "completed",
                      });
                    }}
                  >
                    Complete clean return
                  </Button>
                </div>
              </Card>
            )}

            {(selectedReturn.status === "damage_assessment" || selectedReturn.status === "work_order_open") && (
              <Card className="p-4">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-red-300" />
                  <p className="text-sm font-semibold text-foreground">Damaged return branch</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open a work order, capture charges, and determine whether the deposit covers the damage.
                </p>

                <div className="mt-3 space-y-2">
                  <Label htmlFor="damage-description">Damage description</Label>
                  <Input
                    id="damage-description"
                    value={damageDescription}
                    onChange={(event) => setDamageDescription(event.target.value)}
                    onBlur={() => patchSelectedReturn({ damage_description: damageDescription.trim() || null })}
                  />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="charge-amount">Charge amount</Label>
                    <Input
                      id="charge-amount"
                      type="number"
                      value={chargeInput}
                      onChange={(event) => setChargeInput(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="deposit-amount">Deposit amount</Label>
                    <Input
                      id="deposit-amount"
                      type="number"
                      value={depositInput}
                      onChange={(event) => setDepositInput(event.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground">
                  Deposit covers charges: {damageMath.depositCoversCharges == null ? "—" : damageMath.depositCoversCharges ? "Yes" : "No"} ·
                  Balance due: {damageMath.balanceDue == null ? " —" : ` ${formatCurrency(damageMath.balanceDue)}`}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      if (!damageDescription.trim()) {
                        setStatusError("Damage description is required before opening the work order.");
                        return;
                      }
                      patchSelectedReturn({
                        has_charges: true,
                        damage_description: damageDescription.trim(),
                        charge_amount: chargeValue,
                        deposit_amount: depositValue,
                        deposit_covers_charges: damageMath.depositCoversCharges,
                        balance_due: damageMath.balanceDue,
                        work_order_number: selectedReturn.work_order_number ?? buildWorkOrderNumber(selectedReturn.id),
                        status: "work_order_open",
                      });
                    }}
                  >
                    Open damage work order
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      patchSelectedReturn({
                        charge_amount: chargeValue,
                        deposit_amount: depositValue,
                        deposit_covers_charges: damageMath.depositCoversCharges,
                        balance_due: damageMath.balanceDue,
                        status: "completed",
                      });
                    }}
                  >
                    Finalize damaged return
                  </Button>
                </div>
              </Card>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
