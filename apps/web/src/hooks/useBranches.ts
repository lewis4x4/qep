import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";

export interface Branch {
  id: string;
  workspace_id: string;
  slug: string;
  display_name: string;
  short_code: string | null;
  is_active: boolean;

  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;

  phone_main: string | null;
  phone_parts: string | null;
  phone_service: string | null;
  phone_sales: string | null;
  fax: string | null;
  email_main: string | null;
  email_parts: string | null;
  email_service: string | null;
  email_sales: string | null;
  website_url: string | null;

  general_manager_id: string | null;
  sales_manager_id: string | null;
  service_manager_id: string | null;
  parts_manager_id: string | null;

  business_hours: Array<{ dow: number; open: string; close: string }>;

  logo_url: string | null;
  header_tagline: string | null;
  doc_footer_text: string | null;

  tax_id: string | null;
  default_tax_rate: number;
  license_numbers: Array<{ type: string; number: string; expiry?: string }>;

  capabilities: string[];
  max_service_bays: number | null;
  rental_yard_capacity: number | null;
  parts_counter: boolean;

  delivery_radius_miles: number | null;
  timezone: string;

  notes: string | null;
  metadata: Record<string, unknown>;

  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type BranchUpsertPayload = Partial<Omit<Branch, "id" | "created_at" | "updated_at" | "deleted_at">> & {
  slug: string;
  display_name: string;
};

const QUERY_KEY = ["branches"];

export function useBranches() {
  const wsQ = useMyWorkspaceId();
  const ws = wsQ.data;

  return useQuery<Branch[]>({
    queryKey: [...QUERY_KEY, ws],
    enabled: !!ws,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("branches")
          .select("*")
          .eq("workspace_id", ws!)
          .is("deleted_at", null)
          .order("display_name");
        if (error) throw error;
        return (data ?? []) as Branch[];
      } catch {
        return [];
      }
    },
  });
}

export function useActiveBranches() {
  const wsQ = useMyWorkspaceId();
  const ws = wsQ.data;

  return useQuery<Branch[]>({
    queryKey: [...QUERY_KEY, ws, "active"],
    enabled: !!ws,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("branches")
          .select("*")
          .eq("workspace_id", ws!)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("display_name");
        if (error) throw error;
        return (data ?? []) as Branch[];
      } catch {
        return [];
      }
    },
  });
}

export function useBranchBySlug(slug: string | null | undefined) {
  const wsQ = useMyWorkspaceId();
  const ws = wsQ.data;

  return useQuery<Branch | null>({
    queryKey: [...QUERY_KEY, ws, "slug", slug],
    enabled: !!ws && !!slug,
    staleTime: 120_000,
    queryFn: async () => {
      if (!ws || !slug) return null;
      try {
        const { data, error } = await supabase
          .from("branches")
          .select("*")
          .eq("workspace_id", ws)
          .eq("slug", slug)
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;
        return (data as Branch) ?? null;
      } catch {
        return null;
      }
    },
  });
}

export function useSaveBranch() {
  const qc = useQueryClient();
  const wsQ = useMyWorkspaceId();
  const ws = wsQ.data;

  return useMutation({
    mutationFn: async (payload: BranchUpsertPayload & { id?: string }) => {
      if (!ws) throw new Error("Workspace not resolved");
      const row = {
        ...payload,
        workspace_id: ws,
        updated_at: new Date().toISOString(),
      };
      if (payload.id) {
        const { error } = await supabase
          .from("branches")
          .update(row)
          .eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("branches")
          .upsert(row, { onConflict: "workspace_id,slug" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useDeleteBranch() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("branches")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
