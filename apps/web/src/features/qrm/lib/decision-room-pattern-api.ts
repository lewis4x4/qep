/**
 * decision-room-pattern-api — client for the pattern-lookup edge function.
 *
 * Surface is intentionally small: fetchPatternLookup({ dealId }) returns
 * the server's findings verbatim. TanStack Query in the page caches per
 * dealId. The banner component hides itself when no pattern surfaces.
 */
import { supabase } from "@/lib/supabase";

export interface PatternLossReason {
  reason: string;
  count: number;
}

export interface PatternLookupResponse {
  similarCount: number;
  sampleDealNames: string[];
  topLossReasons: PatternLossReason[];
  /** Single-sentence insight the banner renders. Null when there isn't
   *  enough historical signal (<2 similar deals) to justify one. */
  narrative: string | null;
  equipmentClass: string;
  sizeBand: string;
}

export async function fetchPatternLookup(input: { dealId: string }): Promise<PatternLookupResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-pattern-lookup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(input),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `pattern-lookup returned ${res.status}`);
  return payload as PatternLookupResponse;
}

export function patternLookupQueryKey(dealId: string): readonly unknown[] {
  return ["decision-room-simulator", dealId, "pattern-lookup"] as const;
}
