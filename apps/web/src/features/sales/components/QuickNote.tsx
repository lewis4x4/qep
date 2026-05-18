import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCustomers } from "../hooks/useCustomers";
import { createQuickNote } from "../lib/sales-api";

export interface QuickNoteTag {
  key: string;
  label: string;
  colorClass?: string;
}

export function QuickNote({
  onComplete,
  tag,
}: {
  onComplete: () => void;
  tag?: QuickNoteTag;
}) {
  const queryClient = useQueryClient();
  const { allCustomers } = useCustomers();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  const filtered = customerSearch.trim()
    ? allCustomers.filter((c) =>
        c.company_name?.toLowerCase().includes(customerSearch.toLowerCase()),
      )
    : allCustomers.slice(0, 8);

  async function handleSubmit() {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const body = tag ? `[${tag.label}] ${text.trim()}` : text.trim();
      await createQuickNote({
        companyId: customerId && customerId !== "__none__" ? customerId : undefined,
        text: body,
      });
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      onComplete();
    } catch {
      alert("Failed to save note.");
    } finally {
      setSubmitting(false);
    }
  }

  const title = tag ? `Log a ${tag.label}` : "Quick Note";
  const placeholder = tag ? `Describe the ${tag.label.toLowerCase()}…` : "Type your note...";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        {tag && (
          <span
            className={`text-[10px] font-extrabold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full border ${tag.colorClass ?? "border-qep-orange/40 text-qep-orange bg-qep-orange/10"}`}
          >
            {tag.label}
          </span>
        )}
      </div>

      {/* Optional customer */}
      {!customerId ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Attach to a customer? (optional)</p>
          <input
            type="text"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Search customer..."
            className="w-full h-11 px-4 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-qep-orange/30"
          />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {filtered.map((c) => (
              <button
                key={c.customer_id}
                onClick={() => setCustomerId(c.customer_id)}
                className="w-full text-left px-4 py-2.5 rounded-xl hover:bg-slate-50 text-sm text-slate-900"
              >
                {c.company_name}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCustomerId("__none__")}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Skip — just write a note
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            rows={4}
            autoFocus
            className="w-full px-4 py-3 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-qep-orange/30 resize-none"
          />

          <button
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="w-full h-12 bg-qep-orange text-white font-semibold rounded-xl hover:bg-qep-orange/90 disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Note"}
          </button>
        </>
      )}
    </div>
  );
}
