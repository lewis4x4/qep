import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight } from "lucide-react";
import { useCustomers } from "../hooks/useCustomers";
import { logVisit } from "../lib/sales-api";
import { enqueueOfflineAction } from "../lib/offline-store";
import type { VisitOutcome, NextAction } from "../lib/types";

const OUTCOMES: Array<{ value: VisitOutcome; label: string; emoji: string }> = [
  { value: "interested", label: "Interested", emoji: "\uD83D\uDFE2" },
  { value: "quoted", label: "Quoted", emoji: "\uD83D\uDCC4" },
  { value: "follow_up", label: "Follow-up needed", emoji: "\uD83D\uDD04" },
  { value: "not_interested", label: "Not interested", emoji: "\u26AA" },
];

const NEXT_ACTIONS: Array<{ value: NextAction; label: string }> = [
  { value: "follow_up_call", label: "Follow-up call" },
  { value: "send_quote", label: "Send quote" },
  { value: "schedule_demo", label: "Schedule demo" },
  { value: "none", label: "No action" },
];

export function LogVisitFlow({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const { allCustomers } = useCustomers();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState<NextAction>("none");
  const [submitting, setSubmitting] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  const selectedCustomer = allCustomers.find(
    (c) => c.customer_id === customerId,
  );

  const filteredCustomers = customerSearch.trim()
    ? allCustomers.filter((c) =>
        c.company_name?.toLowerCase().includes(customerSearch.toLowerCase()),
      )
    : allCustomers.slice(0, 10);

  async function handleSubmit() {
    if (!customerId || !outcome) return;
    setSubmitting(true);
    try {
      await logVisit({
        companyId: customerId,
        outcome,
        notes: notes.trim() || undefined,
        nextAction: nextAction !== "none" ? nextAction : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      onComplete();
    } catch {
      // Offline fallback — queue for sync on reconnect
      try {
        await enqueueOfflineAction({
          id: crypto.randomUUID(),
          action_type: "log_visit",
          payload: {
            company_id: customerId,
            outcome,
            notes: notes.trim() || undefined,
            next_action: nextAction !== "none" ? nextAction : undefined,
          },
          queued_at: new Date().toISOString(),
        });
        onComplete();
        return;
      } catch {
        alert("Failed to save visit. Please try again when connected.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-900">Log Visit</h3>

      {/* Step 1: Customer picker */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Who did you visit?</p>
          <input
            type="text"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Search customer..."
            className="w-full h-11 px-4 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-qep-orange/30"
          />
          <div className="max-h-60 overflow-y-auto space-y-1">
            {filteredCustomers.map((c) => (
              <button
                key={c.customer_id}
                onClick={() => {
                  setCustomerId(c.customer_id);
                  setStep(2);
                }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 text-left"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {c.company_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.primary_contact_name}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Outcome */}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            How did the visit with{" "}
            <span className="font-semibold">
              {selectedCustomer?.company_name}
            </span>{" "}
            go?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  setOutcome(o.value);
                  setStep(3);
                }}
                className={`flex items-center gap-2 px-4 py-4 rounded-xl border text-left transition-colors ${
                  outcome === o.value
                    ? "border-qep-orange bg-orange-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className="text-lg">{o.emoji}</span>
                <span className="text-sm font-medium text-slate-700">
                  {o.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Notes + Next Action */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-sm text-slate-600">
            <span className="font-semibold">
              {selectedCustomer?.company_name}
            </span>{" "}
            &mdash;{" "}
            {OUTCOMES.find((o) => o.value === outcome)?.label}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was discussed? Any key takeaways?"
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-qep-orange/30 resize-none"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              Next Action
            </label>
            <div className="space-y-1.5">
              {NEXT_ACTIONS.map((a) => (
                <button
                  key={a.value}
                  onClick={() => setNextAction(a.value)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left text-sm transition-colors ${
                    nextAction === a.value
                      ? "border-qep-orange bg-orange-50 text-qep-orange font-medium"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {a.label}
                  {nextAction === a.value && (
                    <Check className="w-4 h-4" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-12 bg-qep-orange text-white font-semibold rounded-xl hover:bg-qep-orange/90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {submitting ? "Logging..." : "Log Visit"}
          </button>
        </div>
      )}
    </div>
  );
}
