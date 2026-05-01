import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  Activity, FileText, Wrench, Phone, Mic, Eye, AlertCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type Asset24hRpcRow = Database["public"]["Functions"]["get_asset_24h_activity"]["Returns"][number];

interface Last24hRow {
  category: "mechanical" | "commercial";
  event_type: string;
  count: number;
  last_at: string;
  detail?: string | null;
}

interface Last24hStripProps {
  equipmentId: string;
  className?: string;
}

const ICON: Record<string, React.ReactNode> = {
  run_hours:       <Activity className="h-3 w-3" />,
  idle_hours:      <Activity className="h-3 w-3" />,
  fault_codes:     <AlertCircle className="h-3 w-3" />,
  quote_touched:   <FileText className="h-3 w-3" />,
  parts_ordered:   <Wrench className="h-3 w-3" />,
  call_logged:     <Phone className="h-3 w-3" />,
  voice_capture:   <Mic className="h-3 w-3" />,
  portal_login:    <Eye className="h-3 w-3" />,
};

function normalizeCategory(value: string): Last24hRow["category"] {
  return value === "mechanical" ? "mechanical" : "commercial";
}

function mapLast24hRow(row: Asset24hRpcRow): Last24hRow {
  return {
    category: normalizeCategory(row.category),
    event_type: row.event_type,
    count: row.count,
    last_at: row.last_at,
    detail: row.detail,
  };
}

/**
 * Mechanical activity (run/idle/coolant/voltage from telematics_readings)
 * AND commercial activity (quotes touched, parts ordered, calls logged,
 * voice captures, portal logins) for one piece of equipment over the last
 * 24 hours.
 *
 * Backed by get_asset_24h_activity(p_equipment_id) RPC (mig 161).
 */
export function Last24hStrip({ equipmentId, className = "" }: Last24hStripProps) {
  const { data, isLoading, isError } = useQuery<Last24hRow[]>({
    queryKey: ["asset", "24h", equipmentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_asset_24h_activity", { p_equipment_id: equipmentId });
      if (error) return [] as Last24hRow[]; // graceful empty until 161 ships
      return (data ?? []).map(mapLast24hRow);
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Card className={`h-32 animate-pulse ${className}`} />;
  if (isError) return null;

  const rows = data ?? [];
  const mechanical = rows.filter((r) => r.category === "mechanical");
  const commercial = rows.filter((r) => r.category === "commercial");

  return (
    <Card className={`p-3 ${className}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Last 24 hours
      </p>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No mechanical or commercial activity in the last 24 hours.
        </p>
      ) : (
        <div className="space-y-3">
          {mechanical.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Mechanical</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {mechanical.map((r, i) => (
                  <Row key={`m-${i}`} row={r} />
                ))}
              </div>
            </div>
          )}
          {commercial.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Commercial</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {commercial.map((r, i) => (
                  <Row key={`c-${i}`} row={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Row({ row }: { row: Last24hRow }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-1">
      <span className="text-muted-foreground">{ICON[row.event_type] ?? <Activity className="h-3 w-3" />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-foreground truncate">
          {row.event_type.replace(/_/g, " ")}
        </p>
        <p className="text-[9px] text-muted-foreground">
          {row.count}{row.detail ? ` · ${row.detail}` : ""}
        </p>
      </div>
    </div>
  );
}
