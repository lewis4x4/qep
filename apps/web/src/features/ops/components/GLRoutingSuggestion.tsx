import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { AlertTriangle } from "lucide-react";
import { normalizeGlRules, type GLRule } from "../lib/ops-row-normalizers";

interface GLRoutingSuggestionProps {
  equipmentStatus?: string;
  ticketType?: string;
  isCustomerDamage?: boolean;
  hasLdw?: boolean;
  isSalesTruck?: boolean;
  truckNumber?: string;
  isEventRelated?: boolean;
  title?: string;
}

export function GLRoutingSuggestion({
  equipmentStatus,
  ticketType,
  isCustomerDamage,
  hasLdw,
  isSalesTruck,
  truckNumber,
  isEventRelated,
  title = "Suggested GL Account",
}: GLRoutingSuggestionProps) {
  const { data: rules, isLoading } = useQuery<GLRule[]>({
    queryKey: ["ops", "gl-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gl_routing_rules")
        .select("*")
        .order("gl_code");
      if (error) throw error;
      return normalizeGlRules(data);
    },
    staleTime: 300_000,
  });

  if (isLoading || !rules) return null;

  const scored = rules.map((rule) => {
    let score = 0;
    if (equipmentStatus && rule.equipment_status === equipmentStatus) score += 3;
    if (ticketType && rule.ticket_type === ticketType) score += 2;
    if (typeof isCustomerDamage === "boolean" && rule.is_customer_damage === isCustomerDamage) score += 2;
    if (typeof hasLdw === "boolean" && rule.has_ldw === hasLdw) score += 1;
    if (typeof isSalesTruck === "boolean" && rule.is_sales_truck === isSalesTruck) score += 1;
    if (typeof isEventRelated === "boolean" && rule.is_event_related === isEventRelated) score += 1;
    if (truckNumber && rule.truck_numbers?.includes(truckNumber)) score += 1;
    if (rule.gl_code === "SALEW001") score -= 1;
    return { rule, score };
  }).sort((left, right) => right.score - left.score);

  const matched = scored[0]?.rule ?? null;

  if (!matched) return null;

  return (
    <Card className={`p-3 ${matched.requires_ownership_approval ? "border-red-500/30 bg-red-500/5" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className="font-semibold text-foreground">{matched.gl_code} — {matched.gl_name}</p>
          {matched.description && <p className="text-xs text-muted-foreground mt-0.5">{matched.description}</p>}
          {matched.usage_examples && <p className="text-[11px] text-muted-foreground mt-1">{matched.usage_examples}</p>}
        </div>
        {matched.requires_ownership_approval && (
          <div className="flex items-center gap-1 text-red-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-[10px] font-bold">OWNERSHIP APPROVAL REQUIRED</span>
          </div>
        )}
      </div>
    </Card>
  );
}
