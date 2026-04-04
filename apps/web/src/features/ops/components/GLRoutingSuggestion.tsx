import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { AlertTriangle } from "lucide-react";

interface GLRoutingSuggestionProps {
  equipmentStatus?: string;
  ticketType?: string;
  isCustomerDamage?: boolean;
  hasLdw?: boolean;
  isSalesTruck?: boolean;
  truckNumber?: string;
  isEventRelated?: boolean;
}

interface GLRule {
  gl_code: string;
  gl_name: string;
  gl_number: string | null;
  description: string | null;
  equipment_status: string | null;
  ticket_type: string | null;
  is_customer_damage: boolean | null;
  has_ldw: boolean | null;
  is_sales_truck: boolean | null;
  is_event_related: boolean | null;
  requires_ownership_approval: boolean;
}

export function GLRoutingSuggestion(props: GLRoutingSuggestionProps) {
  const { data: rules, isLoading } = useQuery({
    queryKey: ["ops", "gl-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gl_routing_rules")
        .select("*")
        .order("gl_code");
      if (error) throw error;
      return (data ?? []) as GLRule[];
    },
    staleTime: 300_000,
  });

  if (isLoading || !rules) return null;

  // Match rules based on context
  const matched = rules.find((rule) => {
    if (props.equipmentStatus && rule.equipment_status && rule.equipment_status !== props.equipmentStatus) return false;
    if (props.isCustomerDamage && rule.is_customer_damage === false) return false;
    if (props.hasLdw && rule.has_ldw === false) return false;
    if (props.isSalesTruck && rule.is_sales_truck === false) return false;
    if (props.isEventRelated && rule.is_event_related === false) return false;
    // Simple first-match
    if (rule.equipment_status === props.equipmentStatus) return true;
    return false;
  }) || rules[0];

  if (!matched) return null;

  return (
    <Card className={`p-3 ${matched.requires_ownership_approval ? "border-red-500/30 bg-red-500/5" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Suggested GL Account</p>
          <p className="font-semibold text-foreground">{matched.gl_code} — {matched.gl_name}</p>
          {matched.description && <p className="text-xs text-muted-foreground mt-0.5">{matched.description}</p>}
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
