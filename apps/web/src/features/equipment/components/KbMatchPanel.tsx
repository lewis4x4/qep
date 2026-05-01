import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { BookOpen, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Database, Json } from "@/lib/database.types";

type ServiceKnowledgeRpcRow = Database["public"]["Functions"]["match_service_knowledge"]["Returns"][number];

interface KbEntry {
  id: string;
  make: string | null;
  model: string | null;
  fault_code: string | null;
  symptom: string;
  solution: string;
  parts_used: Array<{ part_number?: string; description?: string }> | null;
  verified: boolean;
  use_count: number;
  updated_at: string;
}

function parsePartsUsed(value: Json): KbEntry["parts_used"] {
  if (!Array.isArray(value)) return null;

  const parts = value.flatMap((item): NonNullable<KbEntry["parts_used"]> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const partNumber = typeof item.part_number === "string" ? item.part_number.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!partNumber && !description) return [];
    return [{
      ...(partNumber ? { part_number: partNumber } : {}),
      ...(description ? { description } : {}),
    }];
  });

  return parts.length > 0 ? parts : null;
}

function mapKbEntry(row: ServiceKnowledgeRpcRow): KbEntry {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    fault_code: row.fault_code,
    symptom: row.symptom,
    solution: row.solution,
    parts_used: parsePartsUsed(row.parts_used),
    verified: row.verified,
    use_count: row.use_count,
    updated_at: row.updated_at,
  };
}

interface KbMatchPanelProps {
  make: string | null;
  model: string | null;
  faultCode?: string | null;
  className?: string;
}

/**
 * "What solved this last time" panel — institutional memory surface.
 * Reads from match_service_knowledge RPC (mig 163). Drops onto Asset 360
 * Commercial Action tab to replace the placeholder card.
 */
export function KbMatchPanel({ make, model, faultCode, className = "" }: KbMatchPanelProps) {
  const { data, isLoading } = useQuery<KbEntry[]>({
    queryKey: ["kb-match", make, model, faultCode],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("match_service_knowledge", {
        p_make: make,
        p_model: model,
        p_fault_code: faultCode ?? null,
        p_limit: 5,
      });
      if (error) return [] as KbEntry[];
      return (data ?? []).map(mapKbEntry);
    },
    enabled: !!(make || model || faultCode),
    staleTime: 5 * 60_000,
  });

  if (!make && !model && !faultCode) return null;

  const entries = data ?? [];

  return (
    <Card className={`p-3 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <BookOpen className="h-4 w-4 text-qep-orange" aria-hidden />
        <h3 className="text-sm font-bold text-foreground">What solved this last time</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">institutional memory</span>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted/20" />
          ))}
        </div>
      )}

      {!isLoading && entries.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No matching entries yet. Technicians contribute solutions from the Service Job page —
          the next match for a {make ?? "machine"} {model ?? ""} will surface here.
        </p>
      )}

      {!isLoading && entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((kb) => (
            <div key={kb.id} className="rounded-md border border-border bg-muted/20 p-2.5">
              <div className="flex items-start gap-2">
                {kb.verified && <Check className="h-3 w-3 mt-0.5 shrink-0 text-emerald-400" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">{kb.symptom}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{kb.solution}</p>
                  {kb.parts_used && kb.parts_used.length > 0 && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Parts: {kb.parts_used.map((p) => p.part_number ?? p.description).filter(Boolean).join(", ")}
                    </p>
                  )}
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    Used {kb.use_count}× · {kb.fault_code ?? "no fault code"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
