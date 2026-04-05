import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface CustomerResult {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
}

export function useCustomerSearch(query: string) {
  return useQuery({
    queryKey: ["customer-search", query],
    queryFn: async (): Promise<CustomerResult[]> => {
      const { data, error } = await supabase
        .from("crm_companies")
        .select("id, name, phone, city, state")
        .ilike("name", `%${query.trim()}%`)
        .is("deleted_at", null)
        .order("name")
        .limit(8);
      if (error) throw error;
      return (data ?? []) as CustomerResult[];
    },
    enabled: query.trim().length >= 2,
    staleTime: 15_000,
  });
}

export interface EquipmentResult {
  id: string;
  make: string;
  model: string;
  serial_number: string;
  year: number | null;
  customer_id: string | null;
}

export function useCustomerEquipment(customerId: string | null) {
  return useQuery({
    queryKey: ["customer-equipment", customerId],
    queryFn: async (): Promise<EquipmentResult[]> => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from("crm_equipment")
        .select("id, make, model, serial_number, year, customer_id")
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .order("make")
        .limit(20);
      if (error) throw error;
      return (data ?? []) as EquipmentResult[];
    },
    enabled: !!customerId,
    staleTime: 30_000,
  });
}

export function useEquipmentSearch(query: string) {
  return useQuery({
    queryKey: ["equipment-search", query],
    queryFn: async (): Promise<EquipmentResult[]> => {
      const { data, error } = await supabase
        .from("crm_equipment")
        .select("id, make, model, serial_number, year, customer_id")
        .or(
          `serial_number.ilike.%${query.trim()}%,make.ilike.%${query.trim()}%,model.ilike.%${query.trim()}%`,
        )
        .is("deleted_at", null)
        .limit(8);
      if (error) throw error;
      return (data ?? []) as EquipmentResult[];
    },
    enabled: query.trim().length >= 2,
    staleTime: 15_000,
  });
}
