import { useState, useEffect, useRef } from "react";
import { Search, X, Building2, Briefcase } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCustomers } from "../hooks/useCustomers";
import { useSalesPipeline } from "../hooks/useSalesPipeline";

export function SalesGlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { allCustomers } = useCustomers();
  const { allDeals } = useSalesPipeline();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape key closes
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const q = query.toLowerCase().trim();

  const matchedCustomers = q
    ? allCustomers
        .filter(
          (c) =>
            c.company_name?.toLowerCase().includes(q) ||
            c.primary_contact_name?.toLowerCase().includes(q),
        )
        .slice(0, 5)
    : [];

  const matchedDeals = q
    ? allDeals
        .filter(
          (d) =>
            d.deal_name?.toLowerCase().includes(q) ||
            d.customer_name?.toLowerCase().includes(q),
        )
        .slice(0, 5)
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
      <div className="bg-white min-h-screen max-w-lg mx-auto">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-200">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customers, deals, equipment..."
            className="flex-1 text-base outline-none bg-transparent placeholder:text-slate-400"
          />
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Results */}
        <div className="px-4 py-3 space-y-4">
          {matchedCustomers.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Customers
              </h3>
              {matchedCustomers.map((c) => (
                <button
                  key={c.customer_id}
                  onClick={() => {
                    navigate(`/sales/customers/${c.customer_id}`);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-slate-50 text-left"
                >
                  <Building2 className="w-5 h-5 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {c.company_name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {c.primary_contact_name}
                      {c.city && ` · ${c.city}, ${c.state}`}
                    </p>
                  </div>
                  {c.open_deals > 0 && (
                    <span className="ml-auto shrink-0 text-xs font-semibold text-blue-600 bg-blue-50 rounded-full px-2 py-0.5">
                      {c.open_deals}
                    </span>
                  )}
                </button>
              ))}
            </section>
          )}

          {matchedDeals.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Deals
              </h3>
              {matchedDeals.map((d) => (
                <button
                  key={d.deal_id}
                  onClick={() => {
                    navigate(`/sales/customers/${d.company_id}`);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-slate-50 text-left"
                >
                  <Briefcase className="w-5 h-5 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {d.deal_name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {d.customer_name} · {d.stage}
                    </p>
                  </div>
                  {d.amount != null && (
                    <span className="ml-auto shrink-0 text-sm font-semibold text-slate-700">
                      ${d.amount.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
            </section>
          )}

          {q && matchedCustomers.length === 0 && matchedDeals.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">
              No results for "{query}"
            </p>
          )}

          {!q && (
            <p className="text-sm text-slate-400 text-center py-8">
              Search by customer name, deal name, or equipment type
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
