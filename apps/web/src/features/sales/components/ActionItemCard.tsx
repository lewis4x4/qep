import { useNavigate } from "react-router-dom";
import { AlertCircle, Clock, PhoneForwarded } from "lucide-react";
import type { PriorityAction } from "../lib/types";

const TYPE_CONFIG: Record<
  string,
  { icon: typeof AlertCircle; color: string; bg: string; border: string }
> = {
  follow_up_overdue: {
    icon: AlertCircle,
    color: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-200",
  },
  closing_soon: {
    icon: Clock,
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  going_cold: {
    icon: PhoneForwarded,
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  cooling: {
    icon: Clock,
    color: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
  },
};

const DEFAULT_CONFIG = {
  icon: AlertCircle,
  color: "text-qep-orange",
  bg: "bg-orange-50",
  border: "border-orange-200",
};

export function ActionItemCard({ action }: { action: PriorityAction }) {
  const navigate = useNavigate();
  const config = TYPE_CONFIG[action.type] ?? DEFAULT_CONFIG;
  const Icon = config.icon;

  return (
    <button
      onClick={() => {
        if (action.deal_id) {
          // Navigate to the customer for this deal — we'd need company_id
          // For now, just highlight in pipeline
          navigate("/sales/pipeline");
        }
      }}
      className={`w-full text-left ${config.bg} border ${config.border} rounded-xl px-4 py-3 hover:shadow-sm transition-shadow`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.color} mt-0.5 shrink-0`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            {action.customer_name ?? "Priority"}
          </p>
          <p className="text-sm text-slate-600 mt-0.5">{action.summary}</p>
        </div>
      </div>
    </button>
  );
}
