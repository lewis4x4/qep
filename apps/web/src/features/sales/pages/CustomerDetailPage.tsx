import { useParams, useNavigate, Navigate } from "react-router-dom";
import {
  ArrowLeft,
  Phone,
  Mail,
  ClipboardList,
  FileText,
  Wrench,
  Clock,
} from "lucide-react";
import { useCustomerDetail } from "../hooks/useCustomerDetail";
import { EquipmentFleet } from "../components/EquipmentFleet";
import { InteractionTimeline } from "../components/InteractionTimeline";

export function CustomerDetailPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const safeId = companyId ?? "";
  const navigate = useNavigate();
  const { customer, equipment, deals, activities, quotes, isLoading } =
    useCustomerDetail(safeId);

  if (!companyId) {
    return <Navigate to="/sales/customers" replace />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-12 px-4">
        <p className="text-slate-500">Customer not found.</p>
        <button
          onClick={() => navigate("/sales/customers")}
          className="mt-4 text-qep-orange text-sm font-medium"
        >
          Back to customers
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate("/sales/customers")}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Customers
        </button>

        <h1 className="text-xl font-bold text-slate-900">
          {customer.company_name}
        </h1>
        {customer.primary_contact_name && (
          <p className="text-sm text-slate-600 mt-0.5">
            {customer.primary_contact_name}
          </p>
        )}
        {customer.city && (
          <p className="text-xs text-slate-400 mt-0.5">
            {customer.city}, {customer.state}
          </p>
        )}
      </div>

      {/* Quick action row — 48px+ touch targets */}
      <div className="flex gap-2">
        {customer.primary_contact_phone && (
          <a
            href={`tel:${customer.primary_contact_phone}`}
            className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-blue-50 text-blue-700 font-medium text-sm hover:bg-blue-100 transition-colors"
          >
            <Phone className="w-4 h-4" />
            Call
          </a>
        )}
        {customer.primary_contact_email && (
          <a
            href={`mailto:${customer.primary_contact_email}`}
            className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-slate-50 text-slate-700 font-medium text-sm hover:bg-slate-100 transition-colors"
          >
            <Mail className="w-4 h-4" />
            Email
          </a>
        )}
        <button className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-orange-50 text-qep-orange font-medium text-sm hover:bg-orange-100 transition-colors">
          <ClipboardList className="w-4 h-4" />
          Log Visit
        </button>
      </div>

      {/* EQUIPMENT FLEET — THE LEAD SECTION */}
      <EquipmentFleet equipment={equipment} />

      {/* Open Deals */}
      {deals.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            Open Deals ({deals.length})
          </h2>
          <div className="space-y-2">
            {deals.map((deal) => (
              <div
                key={deal.deal_id}
                className="bg-white rounded-xl border border-slate-200 px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {deal.deal_name}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {deal.stage}
                      {deal.days_since_activity != null &&
                        ` \u00B7 ${deal.days_since_activity}d since activity`}
                    </p>
                  </div>
                  {deal.amount != null && (
                    <span className="text-sm font-semibold text-slate-800">
                      ${deal.amount.toLocaleString()}
                    </span>
                  )}
                </div>
                {deal.expected_close_on && (
                  <p className="text-xs text-slate-400 mt-1">
                    Expected close:{" "}
                    {new Date(deal.expected_close_on).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Quotes */}
      {quotes.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Active Quotes ({quotes.length})
          </h2>
          <div className="space-y-2">
            {quotes.map((quote: { id: string; title: string | null; status: string; created_at: string }) => (
              <div
                key={quote.id}
                className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {quote.title ?? "Untitled Quote"}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {quote.status} \u00B7{" "}
                    {new Date(quote.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Activity Timeline */}
      <InteractionTimeline activities={activities} />

      {/* Link to Iron Manager */}
      <div className="pt-2 pb-4 text-center">
        <button
          onClick={() => navigate(`/qrm/companies/${companyId}`)}
          className="text-sm text-qep-orange font-medium hover:underline"
        >
          View full profile in Iron Manager &rarr;
        </button>
      </div>
    </div>
  );
}
