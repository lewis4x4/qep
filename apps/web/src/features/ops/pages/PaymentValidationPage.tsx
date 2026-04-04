import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { GLRoutingSuggestion } from "../components/GLRoutingSuggestion";

const PAYMENT_TYPES = [
  "business_check", "personal_check", "cashiers_check",
  "credit_card", "debit_card", "ach", "wire",
];

const TRANSACTION_TYPES = ["equipment_sale", "rental", "parts", "service"];

export function PaymentValidationPage() {
  const [paymentType, setPaymentType] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [isDeliveryDay, setIsDeliveryDay] = useState(false);
  const [result, setResult] = useState<{ passed: boolean; rule_applied: string | null; reason: string | null } | null>(null);

  const validateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as unknown as { rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc("validate_payment", {
        p_workspace_id: "default",
        p_customer_id: null,
        p_payment_type: paymentType,
        p_amount: parseFloat(amount),
        p_transaction_type: transactionType,
        p_is_delivery_day: isDeliveryDay,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => setResult(data),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">Payment Validation</h1>
        <p className="text-sm text-muted-foreground">Enforce check acceptance rules per SOP before processing</p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Payment Type</label>
            <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className="mt-1 w-full rounded border border-input bg-card px-3 py-2 text-sm">
              <option value="">Select...</option>
              {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Amount ($)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="mt-1 w-full rounded border border-input bg-card px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Transaction Type</label>
            <select value={transactionType} onChange={(e) => setTransactionType(e.target.value)} className="mt-1 w-full rounded border border-input bg-card px-3 py-2 text-sm">
              <option value="">Select...</option>
              {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isDeliveryDay} onChange={(e) => setIsDeliveryDay(e.target.checked)} className="rounded border-input" />
              Delivery day
            </label>
          </div>
        </div>

        <Button onClick={() => validateMutation.mutate()} disabled={!paymentType || !amount || !transactionType || validateMutation.isPending}>
          {validateMutation.isPending ? "Validating..." : "Validate Payment"}
        </Button>

        {result && (
          <Card className={`p-4 ${result.passed ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
            <div className="flex items-center gap-2">
              {result.passed ? (
                <CheckCircle className="h-5 w-5 text-emerald-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400" />
              )}
              <span className={`font-semibold ${result.passed ? "text-emerald-400" : "text-red-400"}`}>
                {result.passed ? "Payment Approved" : "Payment Blocked"}
              </span>
            </div>
            {result.reason && <p className="mt-2 text-sm text-foreground">{result.reason}</p>}
            {result.rule_applied && <p className="mt-1 text-xs text-muted-foreground">Rule: {result.rule_applied}</p>}
          </Card>
        )}
      </Card>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-foreground mb-3">GL Account Routing</h2>
        <GLRoutingSuggestion equipmentStatus={transactionType === "rental" ? "rental" : "inventory"} />
      </div>
    </div>
  );
}
