import { useNavigate } from "react-router-dom";
import { Phone, ChevronRight } from "lucide-react";
import type { RepCustomer } from "../lib/types";

export function SalesCustomerCard({ customer }: { customer: RepCustomer }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/sales/customers/${customer.customer_id}`)}
      className="w-full text-left bg-white rounded-xl border border-slate-200 px-4 py-3.5 hover:shadow-sm transition-shadow active:bg-slate-50"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {customer.company_name}
            </p>
            {customer.open_deals > 0 && (
              <span className="shrink-0 text-[10px] font-bold text-blue-600 bg-blue-50 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {customer.open_deals}
              </span>
            )}
          </div>

          {customer.primary_contact_name && (
            <p className="text-xs text-slate-600 mt-0.5">
              {customer.primary_contact_name}
              {customer.city && ` \u00B7 ${customer.city}, ${customer.state}`}
            </p>
          )}

          <div className="flex items-center gap-3 mt-1.5">
            {customer.days_since_contact != null && (
              <span className="text-[10px] text-slate-400">
                Last contact: {customer.days_since_contact}d ago
              </span>
            )}
            {customer.active_quotes > 0 && (
              <span className="text-[10px] text-amber-600 font-medium">
                {customer.active_quotes} active{" "}
                {customer.active_quotes === 1 ? "quote" : "quotes"}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {customer.primary_contact_phone && (
            <a
              href={`tel:${customer.primary_contact_phone}`}
              onClick={(e) => e.stopPropagation()}
              className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 hover:bg-blue-100 transition-colors"
              aria-label={`Call ${customer.primary_contact_name}`}
            >
              <Phone className="w-4 h-4" />
            </a>
          )}
          <ChevronRight className="w-4 h-4 text-slate-300" />
        </div>
      </div>
    </button>
  );
}
