/**
 * Wave 6.11 Flare — HTTP client for flare-submit + flare-notify-fixed.
 */
import { supabase } from "@/lib/supabase";
import type { FlareSubmitPayload, FlareSubmitResponse } from "./types";
import { enqueueSubmission } from "./submitQueue";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUBMIT_URL = `${SUPABASE_URL}/functions/v1/flare-submit`;
const NOTIFY_FIXED_URL = `${SUPABASE_URL}/functions/v1/flare-notify-fixed`;
const DEDUPE_URL = `${SUPABASE_URL}/functions/v1/flare-submit/dedupe`;

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token ?? ""}`,
    "Content-Type": "application/json",
  };
}

export async function submitFlare(payload: FlareSubmitPayload): Promise<FlareSubmitResponse> {
  // Phase H: queue-on-failure for transient errors (network drop, 5xx,
  // browser offline). 4xx errors (validation, rate limit, auth) are
  // user-actionable and NOT queued — re-trying them won't help.
  try {
    const res = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "submit_failed" }));
      if (res.status === 429) {
        throw new Error(
          `Rate limited — you've submitted 20 flares this hour. Try again in ${(err as { retry_after_seconds?: number }).retry_after_seconds ?? 60} seconds.`,
        );
      }
      // 5xx → transient → queue for retry
      if (res.status >= 500) {
        await enqueueSubmission(payload, `http_${res.status}`);
        throw new Error(`Submit failed (${res.status}) — saved for automatic retry on next page load.`);
      }
      // 4xx → user-actionable, do NOT queue
      throw new Error((err as { error?: string }).error ?? `Submit failed (${res.status})`);
    }
    return res.json() as Promise<FlareSubmitResponse>;
  } catch (err) {
    // Network errors (TypeError from fetch) — definitely transient
    if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
      await enqueueSubmission(payload, err.message);
      throw new Error("Network error — saved for automatic retry on next page load.");
    }
    throw err;
  }
}

/** Lightweight dedupe peek used by the drawer chip. */
export async function peekDedupeCount(route: string, description: string): Promise<number> {
  try {
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: number | null; error: unknown }>;
    }).rpc("flare_dedupe_count", {
      p_route: route,
      p_description: description || " ",
      p_threshold: 0.4,
    });
    if (error) return 0;
    return Number(data ?? 0);
  } catch {
    return 0;
  }
}

export async function notifyFlareFixed(reportId: string): Promise<void> {
  try {
    const res = await fetch(NOTIFY_FIXED_URL, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ report_id: reportId }),
    });
    if (!res.ok) {
      console.warn("[flare] notify-fixed failed:", await res.text());
    }
  } catch (err) {
    console.warn("[flare] notify-fixed error:", err);
  }
}

void DEDUPE_URL; // reserved for future GET /dedupe endpoint
