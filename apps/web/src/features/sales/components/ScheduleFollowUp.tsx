import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useCustomers } from "../hooks/useCustomers";
import { useSalesPipeline } from "../hooks/useSalesPipeline";

export function ScheduleFollowUp({ onComplete }: { onComplete: () => void }) {
  const queryClient = useQueryClient();
  const { allCustomers } = useCustomers();
  const { allDeals } = useSalesPipeline();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  const filtered = customerSearch.trim()
    ? allCustomers.filter((c) =>
        c.company_name?.toLowerCase().includes(customerSearch.toLowerCase()),
      )
    : allCustomers.slice(0, 8);

  const customerDeals = customerId
    ? allDeals.filter((d) => d.company_id === customerId)
    : [];

  async function handleSubmit() {
    if (!dealId || !date) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: dealErr } = await supabase
        .from("crm_deals")
        .update({ next_follow_up_at: new Date(date).toISOString() })
        .eq("id", dealId)
        .eq("assigned_rep_id", user.id);

      if (dealErr) throw dealErr;

      if (note.trim()) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("active_workspace_id")
          .eq("id", user.id)
          .maybeSingle();
        const wsId = (prof as { active_workspace_id: string } | null)?.active_workspace_id ?? "default";

        await supabase.from("crm_activities").insert({
          workspace_id: wsId,
          activity_type: "note",
          body: `Follow-up scheduled for ${date}: ${note}`,
          occurred_at: new Date().toISOString(),
          deal_id: dealId,
          company_id: customerId,
          metadata: { source: "sales_companion", type: "followup_scheduled" },
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      onComplete();
    } catch {
      alert("Failed to schedule. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Step 1: customer
  if (!customerId) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">Schedule Follow-Up</h3>
        <input
          type="text"
          value={customerSearch}
          onChange={(e) => setCustomerSearch(e.target.value)}
          placeholder="Search customer..."
          className="w-full h-11 px-4 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-qep-orange/30"
        />
        <div className="max-h-60 overflow-y-auto space-y-1">
          {filtered.map((c) => (
            <button
              key={c.customer_id}
              onClick={() => setCustomerId(c.customer_id)}
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-50 text-sm font-medium text-slate-900"
            >
              {c.company_name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: deal + date
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-900">Schedule Follow-Up</h3>

      {customerDeals.length === 0 && (
        <div className="bg-slate-50 rounded-xl px-4 py-4 text-center">
          <p className="text-sm text-slate-600">
            No open deals for this customer.
          </p>
          <button
            onClick={() => {
              setCustomerId(null);
              setCustomerSearch("");
            }}
            className="mt-2 text-sm text-qep-orange font-medium hover:underline"
          >
            Choose a different customer
          </button>
        </div>
      )}

      {customerDeals.length > 0 && (
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">
            For which deal?
          </label>
          <div className="space-y-1.5">
            {customerDeals.map((d) => (
              <button
                key={d.deal_id}
                onClick={() => setDealId(d.deal_id)}
                className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                  dealId === d.deal_id
                    ? "border-qep-orange bg-orange-50 font-medium"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                {d.deal_name}{" "}
                {d.amount != null && (
                  <span className="text-slate-500">
                    — ${d.amount.toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1.5">
          Follow-up date
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          min={new Date().toISOString().split("T")[0]}
          className="w-full h-11 px-4 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-qep-orange/30"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1.5">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What to follow up on?"
          rows={2}
          className="w-full px-4 py-3 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-qep-orange/30 resize-none"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!dealId || !date || submitting}
        className="w-full h-12 bg-qep-orange text-white font-semibold rounded-xl hover:bg-qep-orange/90 disabled:opacity-50"
      >
        {submitting ? "Scheduling..." : "Schedule Follow-Up"}
      </button>
    </div>
  );
}
