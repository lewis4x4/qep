import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { IronRole } from "@/features/qrm/lib/iron-roles";
import { buildStaticNarrative } from "../components/FloorNarrative";

export interface FloorNarrativeResponse {
  narrative_text: string;
  generated_at: string | null;
  expires_at: string | null;
  cached: boolean;
  fallback: boolean;
  model: string | null;
}

export function useFloorNarrative(role: IronRole, firstName: string) {
  const fallbackText = buildStaticNarrative(role, firstName);
  const query = useQuery({
    queryKey: ["floor-narrative", role],
    queryFn: async (): Promise<FloorNarrativeResponse> => {
      const { data, error } = await supabase.functions.invoke<FloorNarrativeResponse>(
        "floor-narrative",
        { body: { iron_role: role } },
      );
      if (error) throw error;
      if (!data?.narrative_text) throw new Error("floor-narrative returned no text");
      return data;
    },
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });

  const expiresAt = query.data?.expires_at ? new Date(query.data.expires_at).getTime() : 0;
  const fresh = !!query.data && !query.data.fallback && expiresAt > Date.now();

  return {
    text: query.data?.narrative_text ?? fallbackText,
    fresh,
    isFallback: query.isError || !query.data || query.data.fallback,
    generatedAt: query.data?.generated_at ?? null,
    model: query.data?.model ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
