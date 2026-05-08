import { crmSupabase } from "./qrm-supabase";
import { normalizeTimeBankRows, type TimeBankRow } from "./time-bank";

export async function fetchTimeBankRows({
  workspaceId,
  defaultBudgetDays = 14,
}: {
  workspaceId: string;
  defaultBudgetDays?: number;
}): Promise<TimeBankRow[]> {
  const { data, error } = await crmSupabase.rpc("qrm_time_bank", {
    p_workspace_id: workspaceId,
    p_default_budget_days: defaultBudgetDays,
  });

  if (error) {
    throw new Error(error.message || "Failed to load Time Bank.");
  }

  return normalizeTimeBankRows(data);
}
