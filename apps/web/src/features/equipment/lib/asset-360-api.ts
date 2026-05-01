import { supabase } from "@/lib/supabase";
import { parseAsset360, type Asset360Response } from "@/lib/asset-rpc";

export type { Asset360Response } from "@/lib/asset-rpc";

/** Single round-trip composite for the Asset 360 page header + tabs. */
export async function fetchAsset360(equipmentId: string): Promise<Asset360Response | null> {
  const { data, error } = await supabase.rpc("get_asset_360", { p_equipment_id: equipmentId });
  if (error) throw new Error(error.message ?? "Failed to load Asset 360");
  return parseAsset360(data);
}
