import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import {
  normalizeCrossReferenceFallbackRows,
  normalizeSubstituteRows,
  type SubstituteRow,
} from "../lib/parts-row-normalizers";

export type { SubstituteRow } from "../lib/parts-row-normalizers";

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
        if (!error && data) return normalizeSubstituteRows(data);
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

        const rows = [
          ...normalizeCrossReferenceFallbackRows(outbound, "outbound"),
          ...normalizeCrossReferenceFallbackRows(inbound, "inbound"),
        ];
        return rows.sort((a, b) => b.confidence - a.confidence);
      } catch {
        return [];
      }
    },
  });
}
