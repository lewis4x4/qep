import type { DecisionMagicAction } from "../_shared/decision-magic-link.ts";

export type DecisionActionPatch = Record<string, unknown>;

export interface DecisionActionInput {
  action: DecisionMagicAction;
  ownerRole: string;
  recommendedOption: string | null;
  existingPacket: Record<string, unknown> | null;
  nowIso?: string;
}

export function buildDecisionMagicActionPatch(input: DecisionActionInput): DecisionActionPatch {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const actor = `magic-link:${input.ownerRole}`;
  const actionStamp = {
    action: input.action,
    owner_role: input.ownerRole,
    at: nowIso,
  };
  const packet = {
    ...(input.existingPacket ?? {}),
    magic_link_last_action: actionStamp,
  };

  if (input.action === "approve") {
    return {
      status: "answered",
      answered_by: actor,
      answered_at: nowIso,
      answered_option: input.recommendedOption,
      answered_rationale: `Approved via signed magic link by ${input.ownerRole} at ${nowIso}.`,
      ai_prep_packet: packet,
    };
  }

  if (input.action === "block") {
    return {
      status: "escalated",
      ai_prep_packet: packet,
    };
  }

  return {
    status: "open",
    ai_prep_packet: packet,
  };
}
