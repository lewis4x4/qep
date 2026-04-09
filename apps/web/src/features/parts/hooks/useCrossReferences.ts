import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";

export interface SubstituteRow {
  xref_id: string;
  substitute_part_number: string;
  relationship: string;
  confidence: number;
  source: string;
  fitment_notes: string | null;
  price_delta: number | null;
  lead_time_delta_days: number | null;
  qty_available: number;
  available_branch: string | null;
  catalog_description: string | null;
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  interchangeable: "Interchangeable",
  supersedes: "Supersedes",
  superseded_by: "Superseded by",
  aftermarket_equivalent: "Aftermarket equiv.",
  oem_equivalent: "OEM equiv.",
  kit_component: "Kit component",
  kit_parent: "Kit parent",
};

export function relationshipLabel(rel: string): string {
  return RELATIONSHIP_LABELS[rel] ?? rel;
}

export function useCrossReferences(
  partNumber: string | null | undefined,
  branchId?: string | null,
) {
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  return useQuery({
    queryKey: ["parts-cross-references", partNumber, branchId, workspaceId],
    enabled: Boolean(partNumber) && Boolean(workspaceId),
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<SubstituteRow[]> => {
      if (!partNumber || !workspaceId) return [];

      try {
        const params: Record<string, unknown> = {
          p_workspace_id: workspaceId,
          p_part_number: partNumber,
        };
        if (branchId) params.p_branch_id = branchId;

        const { data, error } = await supabase.rpc("find_part_substitutes", params);
        if (!error && data) return data as SubstituteRow[];
      } catch { /* migration not applied */ }

      // Fallback: direct table query (both directions)
      try {
        const pn = partNumber.toLowerCase();
        const [{ data: outbound }, { data: inbound }] = await Promise.all([
          supabase
            .from("parts_cross_references")
            .select("id, part_number_b, relationship, confidence, source, fitment_notes, price_delta, lead_time_delta_days")
            .ilike("part_number_a", pn)
            .eq("is_active", true)
            .is("deleted_at", null)
            .limit(50),
          supabase
            .from("parts_cross_references")
            .select("id, part_number_a, relationship, confidence, source, fitment_notes, price_delta, lead_time_delta_days")
            .ilike("part_number_b", pn)
            .eq("is_active", true)
            .is("deleted_at", null)
            .limit(50),
        ]);

        const rows: SubstituteRow[] = [];
        for (const r of outbound ?? []) {
          rows.push({
            xref_id: r.id,
            substitute_part_number: r.part_number_b as string,
            relationship: r.relationship as string,
            confidence: Number(r.confidence),
            source: r.source as string,
            fitment_notes: r.fitment_notes as string | null,
            price_delta: r.price_delta != null ? Number(r.price_delta) : null,
            lead_time_delta_days: r.lead_time_delta_days != null ? Number(r.lead_time_delta_days) : null,
            qty_available: 0,
            available_branch: null,
            catalog_description: null,
          });
        }
        for (const r of inbound ?? []) {
          rows.push({
            xref_id: r.id,
            substitute_part_number: r.part_number_a as string,
            relationship: r.relationship as string,
            confidence: Number(r.confidence),
            source: r.source as string,
            fitment_notes: r.fitment_notes as string | null,
            price_delta: r.price_delta != null ? -Number(r.price_delta) : null,
            lead_time_delta_days: r.lead_time_delta_days != null ? -Number(r.lead_time_delta_days) : null,
            qty_available: 0,
            available_branch: null,
            catalog_description: null,
          });
        }
        return rows.sort((a, b) => b.confidence - a.confidence);
      } catch {
        return [];
      }
    },
  });
}
