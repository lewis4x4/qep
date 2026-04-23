import { supabase } from "@/lib/supabase";
import type { DecisionRoomBoard } from "./decision-room-simulator";

export interface CoachReadResponse {
  read: string;
  generatedAt: string;
}

export function coachReadSnapshotKey(board: DecisionRoomBoard): string {
  return board.seats
    .map((s) => `${s.id}:${s.status}:${s.stance}:${s.confidence}:${Math.round(s.vetoWeight * 100)}`)
    .join("|");
}

export function coachReadQueryKey(board: DecisionRoomBoard): readonly unknown[] {
  return ["decision-room", "coach-read", board.dealId, coachReadSnapshotKey(board)] as const;
}

export async function fetchCoachRead(board: DecisionRoomBoard): Promise<CoachReadResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-coach-read`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        dealId: board.dealId,
        dealName: board.dealName,
        companyName: board.companyName,
        seats: board.seats.map((s) => ({
          status: s.status,
          archetype: s.archetype,
          archetypeLabel: s.archetypeLabel,
          name: s.name,
          title: s.title,
          stance: s.stance,
          powerWeight: s.powerWeight,
          vetoWeight: s.vetoWeight,
          evidence: s.evidence.map((e) => e.label),
        })),
        scores: {
          decisionVelocity: {
            days: board.scores.decisionVelocity.days,
            confidence: board.scores.decisionVelocity.confidence,
          },
          coverage: {
            value: board.scores.coverage.value,
            filled: board.scores.coverage.filled,
            expected: board.scores.coverage.expected,
            missingArchetypes: board.scores.coverage.missingArchetypes,
          },
          consensusRisk: { level: board.scores.consensusRisk.level },
          latentVeto: {
            level: board.scores.latentVeto.level,
            topGhostArchetype: board.scores.latentVeto.topGhostArchetype,
          },
        },
      }),
    },
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `coach read returned ${res.status}`);
  if (typeof payload.read !== "string" || payload.read.length === 0) {
    throw new Error("coach returned empty read");
  }
  return { read: payload.read, generatedAt: payload.generatedAt };
}
