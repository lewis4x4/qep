import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { CheckCircle, XCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import { GLRoutingSuggestion } from "../components/GLRoutingSuggestion";
import {
  PAYMENT_TYPES,
  TRANSACTION_TYPES,
  attemptOutcome,
  canOverridePayment,
  paymentValidationSummary,
  requiredApproverRole,
  type PaymentType,
  type TransactionType,
  type ValidationResult,
} from "../lib/payment-validation";
import { normalizeValidationHistoryRows } from "../lib/payment-validation-history";

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function PaymentValidationPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [paymentType, setPaymentType] = useState<PaymentType | null>(null);
  const [amount, setAmount] = useState("");
  const [transactionType, setTransactionType] = useState<TransactionType | null>(null);
  const [invoiceReference, setInvoiceReference] = useState("");
  const [isDeliveryDay, setIsDeliveryDay] = useState(false);
  const [isCustomerDamage, setIsCustomerDamage] = useState(false);
  const [isEventRelated, setIsEventRelated] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [activeValidationId, setActiveValidationId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const amountValue = amount.trim() ? Number(amount) : null;
  const canOverride = canOverridePayment(profile?.role);
  const selectedEquipmentStatus = transactionType === "rental" ? "rental" : "inventory";

  const { data: recentValidations = [] } = useQuery({
    queryKey: ["ops", "payment-validations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_validations")
        .select("id, amount, attempt_outcome, created_at, daily_check_total, invoice_reference, is_delivery_day, override_reason, passed, payment_type, rule_applied, transaction_type")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return normalizeValidationHistoryRows(data);
    },
    staleTime: 30_000,
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!paymentType || !transactionType || amountValue == null) {
        throw new Error("Payment type, amount, and transaction type are required.");
      }

      const rpcResult = await (supabase as unknown as {
        rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: ValidationResult | null; error: { message?: string } | null }>;
      }).rpc("validate_payment", {
        p_workspace_id: profile?.active_workspace_id ?? "default",
        p_customer_id: null,
        p_payment_type: paymentType,
        p_amount: amountValue,
        p_transaction_type: transactionType,
        p_is_delivery_day: isDeliveryDay,
      });

      if (rpcResult.error) {
        throw new Error(rpcResult.error.message ?? "Validation RPC failed.");
      }

      const validation = rpcResult.data ?? { passed: false, rule_applied: null, reason: "Validation failed." };
      const insertResult = await supabase
        .from("payment_validations")
        .insert({
          amount: amountValue,
          attempt_outcome: attemptOutcome(validation, false),
          customer_id: null,
          daily_check_total: validation.daily_check_total ?? null,
          invoice_reference: invoiceReference.trim() || null,
          is_delivery_day: isDeliveryDay,
          override_reason: null,
          override_by: null,
          passed: validation.passed,
          payment_type: paymentType,
          required_approver_role: requiredApproverRole(validation),
          rule_applied: validation.rule_applied,
          transaction_type: transactionType,
          workspace_id: profile?.active_workspace_id ?? "default",
        })
        .select("id")
        .single();

      if (insertResult.error) {
        throw new Error(insertResult.error.message);
      }

      return {
        validation,
        validationId: insertResult.data.id,
      };
    },
    onSuccess: ({ validation, validationId }) => {
      setPageError(null);
      setResult(validation);
      setActiveValidationId(validationId);
      queryClient.invalidateQueries({ queryKey: ["ops", "payment-validations"] });
    },
    onError: (error) => {
      setPageError(error instanceof Error ? error.message : "Validation failed.");
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      if (!activeValidationId || !result) {
        throw new Error("Run a blocked validation before overriding.");
      }
      if (!canOverride) {
        throw new Error("Only elevated ops users can override a blocked validation.");
      }
      if (!overrideReason.trim()) {
        throw new Error("A documented override reason is required.");
      }
      const { error } = await supabase
        .from("payment_validations")
        .update({
          attempt_outcome: attemptOutcome(result, true),
          override_by: profile?.id ?? null,
          override_reason: overrideReason.trim(),
          passed: true,
        })
        .eq("id", activeValidationId);
      if (error) throw error;
    },
    onSuccess: () => {
      setPageError(null);
      setResult((current) => current ? { ...current, passed: true, reason: `${current.reason ?? "Blocked by SOP."} Override recorded.` } : current);
      queryClient.invalidateQueries({ queryKey: ["ops", "payment-validations"] });
    },
    onError: (error) => {
      setPageError(error instanceof Error ? error.message : "Override failed.");
    },
  });

  const validationSummary = useMemo(() => paymentValidationSummary(result), [result]);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">Payment Validation</h1>
        <p className="text-sm text-muted-foreground">
          Enforce SOP payment rules before accepting funds, with documented override and GL routing guidance.
        </p>
      </div>

      {pageError && (
        <Card className="mb-4 border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-start gap-2 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{pageError}</span>
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid gap-4">
              <div>
                <Label className="mb-2 block">Payment type</Label>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_TYPES.map((type) => (
                    <Button
                      key={type}
                      type="button"
                      variant={paymentType === type ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPaymentType(type)}
                    >
                      {type.replace(/_/g, " ")}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Transaction type</Label>
                <div className="flex flex-wrap gap-2">
                  {TRANSACTION_TYPES.map((type) => (
                    <Button
                      key={type}
                      type="button"
                      variant={transactionType === type ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTransactionType(type)}
                    >
                      {type.replace(/_/g, " ")}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="payment-amount">Amount</Label>
                  <Input
                    id="payment-amount"
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice-reference">Invoice / reference</Label>
                  <Input
                    id="invoice-reference"
                    placeholder="Optional reference"
                    value={invoiceReference}
                    onChange={(event) => setInvoiceReference(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={isDeliveryDay ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsDeliveryDay((current) => !current)}
                >
                  Delivery day
                </Button>
                <Button
                  type="button"
                  variant={isCustomerDamage ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsCustomerDamage((current) => !current)}
                >
                  Customer damage
                </Button>
                <Button
                  type="button"
                  variant={isEventRelated ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsEventRelated((current) => !current)}
                >
                  Event related
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => validateMutation.mutate()}
                  disabled={!paymentType || !transactionType || amountValue == null || validateMutation.isPending}
                >
                  {validateMutation.isPending ? "Validating..." : "Validate payment"}
                </Button>
              </div>
            </div>
          </Card>

          <Card className={`p-4 ${result?.passed ? "border-emerald-500/30 bg-emerald-500/5" : result ? "border-red-500/30 bg-red-500/5" : ""}`}>
            <div className="flex items-center gap-2">
              {result?.passed ? (
                <CheckCircle className="h-5 w-5 text-emerald-400" />
              ) : result ? (
                <XCircle className="h-5 w-5 text-red-400" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-qep-orange" />
              )}
              <span className={`font-semibold ${result?.passed ? "text-emerald-300" : result ? "text-red-300" : "text-foreground"}`}>
                {result ? (result.passed ? "Payment approved" : "Payment blocked") : "Awaiting validation"}
              </span>
            </div>

            <p className="mt-2 text-sm text-foreground">{validationSummary}</p>
            {result?.rule_applied && (
              <p className="mt-1 text-xs text-muted-foreground">Rule: {result.rule_applied}</p>
            )}
            {result?.daily_check_total != null && (
              <p className="mt-1 text-xs text-muted-foreground">Daily check total: {formatCurrency(result.daily_check_total)}</p>
            )}

            {!result?.passed && canOverride && (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="flex items-center gap-2 text-amber-300">
                  <ShieldAlert className="h-4 w-4" />
                  <p className="text-sm font-semibold">Documented override path</p>
                </div>
                <p className="mt-1 text-xs text-amber-100">
                  Assumption: the roadmap’s A/R override path is handled by elevated ops users already present in the system.
                </p>
                <div className="mt-3 space-y-2">
                  <Label htmlFor="override-reason">Override reason</Label>
                  <Input
                    id="override-reason"
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="Document why this SOP exception is allowed"
                  />
                </div>
                <Button className="mt-3" onClick={() => overrideMutation.mutate()} disabled={overrideMutation.isPending}>
                  {overrideMutation.isPending ? "Recording override..." : "Approve override"}
                </Button>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Recent validation history</h2>
              <span className="text-xs text-muted-foreground">{recentValidations.length} recorded</span>
            </div>
            {recentValidations.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No payment validations recorded yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {recentValidations.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">
                        {entry.payment_type.replace(/_/g, " ")} · {formatCurrency(entry.amount)}
                      </p>
                      <span className={`text-[11px] ${entry.passed ? "text-emerald-300" : "text-red-300"}`}>
                        {entry.attempt_outcome ?? (entry.passed ? "approved" : "blocked")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.transaction_type?.replace(/_/g, " ") ?? "unknown"} · {entry.rule_applied ?? "no rule"} · {new Date(entry.created_at).toLocaleString()}
                    </p>
                    {entry.override_reason && (
                      <p className="mt-1 text-xs text-amber-200">Override: {entry.override_reason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <GLRoutingSuggestion
            title="Suggested GL routing"
            equipmentStatus={selectedEquipmentStatus}
            isCustomerDamage={isCustomerDamage}
            isEventRelated={isEventRelated}
          />

          <Card className="border-red-500/20 bg-red-500/5 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-red-300" />
              <div>
                <p className="text-sm font-semibold text-red-200">`SALEW001` watch</p>
                <p className="mt-1 text-xs text-red-100">
                  Good-faith writeoffs or customer goodwill adjustments must be treated as ownership-gated, even if the route suggestion otherwise looks valid.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
