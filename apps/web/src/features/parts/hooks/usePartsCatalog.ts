import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function usePartsCatalog() {
  return useQuery({
    queryKey: ["parts-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_catalog")
        .select("*")
        .is("deleted_at", null)
        .order("part_number");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}
