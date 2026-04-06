import { supabase } from "@/lib/supabase";

const TIMING_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deal-timing-scan`;

export type DealTimingUrgency = "immediate" | "upcoming" | "future";
export type DealTimingAlertType =
  | "budget_cycle"
  | "price_increase"
  | "equipment_aging"
  | "seasonal_pattern"
  | "trade_in_interest";

export interface DealTimingAlert {
  id: string;
  alert_type: DealTimingAlertType;
  urgency: DealTimingUrgency;
  title: string;
  description: string | null;
  recommended_action: string | null;
  trigger_date: string;
  status: string;
  customer_name: string | null;
  assigned_rep_id: string | null;
}

export interface DealTimingDashboard {
  total_alerts: number;
  by_urgency: Record<DealTimingUrgency, number>;
  by_type: Record<DealTimingAlertType, number>;
  alerts: DealTimingAlert[];
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchTimingDashboard(): Promise<DealTimingDashboard> {
  const res = await fetch(TIMING_API_URL, {
    method: "GET",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load timing dashboard" }));
    throw new Error(err.error || `Failed to load timing dashboard (${res.status})`);
  }
  return res.json();
}

export async function runTimingScan(): Promise<{
  ok: boolean;
  alerts_generated: number;
  notifications_sent: number;
}> {
  const res = await fetch(TIMING_API_URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ source: "manual" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Timing scan failed" }));
    throw new Error(err.error || `Timing scan failed (${res.status})`);
  }
  return res.json();
}

/** Update the status of a timing alert (acknowledge, action, dismiss). */
export async function updateAlertStatus(
  alertId: string,
  status: "acknowledged" | "actioned" | "dismissed",
  actionedDealId?: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    actioned_at: new Date().toISOString(),
  };
  if (actionedDealId) updates.actioned_deal_id = actionedDealId;

  const { error } = await (supabase as unknown as {
    from: (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: unknown }>;
      };
    };
  })
    .from("deal_timing_alerts")
    .update(updates)
    .eq("id", alertId);

  if (error) {
    const msg = (error as { message?: string })?.message ?? "Failed to update alert";
    throw new Error(msg);
  }
}
