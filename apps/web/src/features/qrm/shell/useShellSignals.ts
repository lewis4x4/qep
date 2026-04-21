/**
 * useShellSignals — live pressure counts feeding the top-nav badges.
 *
 * Each surface gets a single, honest number:
 *   TODAY  — overdue deal follow-ups (next_follow_up_at is in the past).
 *            Tone escalates with count.
 *   GRAPH  — aged inventory units on the lot (≥ 90 days, still available
 *            or reserved). Mirrors the Inventory Pressure "aged" lane.
 *   PULSE  — open rental recovery cases (rental_returns not yet completed).
 *            These are the highest-pressure "something changed, do the
 *            work" signals feeding the Pulse surface.
 *   ASK    — ambient agent, no number.
 *
 * Policy for bad data: if a feeder query fails, the count for that surface
 * degrades silently to 0 (tone "cool") rather than breaking the shell. A
 * single bad table never takes the nav dark.
 *
 * Cadence: 60s staleTime + 2min refetch. Cheap head:true counts so we do
 * not pull rows from the server.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ShellSignal {
  count: number;
  tone: "hot" | "warm" | "active" | "live" | "cool";
}

export interface ShellSignals {
  today: ShellSignal;
  graph: ShellSignal;
  pulse: ShellSignal;
  ask: ShellSignal;
}

const DEFAULT_SIGNALS: ShellSignals = {
  today: { count: 0, tone: "cool" },
  graph: { count: 0, tone: "cool" },
  pulse: { count: 0, tone: "cool" },
  ask: { count: 0, tone: "cool" },
};

function toneForOverdue(count: number): ShellSignal["tone"] {
  if (count >= 10) return "hot";
  if (count >= 3) return "warm";
  if (count > 0) return "active";
  return "cool";
}

function toneForAged(count: number): ShellSignal["tone"] {
  if (count >= 20) return "hot";
  if (count >= 5) return "warm";
  if (count > 0) return "active";
  return "cool";
}

function toneForPulse(count: number): ShellSignal["tone"] {
  if (count >= 5) return "hot";
  if (count > 0) return "live";
  return "cool";
}

async function fetchShellSignals(): Promise<ShellSignals> {
  const nowIso = new Date().toISOString();
  const agedCutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const [overdueRes, agedRes, recoveryRes] = await Promise.allSettled([
    supabase
      .from("crm_deals")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .is("closed_at", null)
      .not("next_follow_up_at", "is", null)
      .lt("next_follow_up_at", nowIso),
    supabase
      .from("crm_equipment")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .in("availability", ["available", "reserved"])
      .lt("created_at", agedCutoff),
    supabase
      .from("rental_returns")
      .select("id", { count: "exact", head: true })
      .neq("status", "completed"),
  ]);

  const overdueCount =
    overdueRes.status === "fulfilled" && !overdueRes.value.error ? overdueRes.value.count ?? 0 : 0;
  const agedCount =
    agedRes.status === "fulfilled" && !agedRes.value.error ? agedRes.value.count ?? 0 : 0;
  const recoveryCount =
    recoveryRes.status === "fulfilled" && !recoveryRes.value.error
      ? recoveryRes.value.count ?? 0
      : 0;

  return {
    today: { count: overdueCount, tone: toneForOverdue(overdueCount) },
    graph: { count: agedCount, tone: toneForAged(agedCount) },
    pulse: { count: recoveryCount, tone: toneForPulse(recoveryCount) },
    ask: { count: 0, tone: "cool" },
  };
}

export function useShellSignals(): ShellSignals {
  const { data } = useQuery({
    queryKey: ["qrm", "shell-signals"],
    queryFn: fetchShellSignals,
    staleTime: 60_000,
    refetchInterval: 120_000,
    // Signals are ambient — never throw them in the user's face on error.
    retry: 1,
  });
  return data ?? DEFAULT_SIGNALS;
}
