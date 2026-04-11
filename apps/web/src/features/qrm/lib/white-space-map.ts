import type { Account360FleetItem, Account360PartsRollup, Account360ServiceJob } from "./account-360-api";
import type { CustomerFleetUnit, CustomerProfileResponse } from "@/features/dge/types";

export type WhiteSpaceOpportunityType =
  | "replacement"
  | "attachment"
  | "service_coverage"
  | "parts_penetration";

export type WhiteSpaceConfidence = "high" | "medium" | "low";

export interface WhiteSpaceEquipmentSignal {
  equipmentId: string;
  attachmentCount: number;
  currentMarketValue: number | null;
  replacementCost: number | null;
}

export interface WhiteSpaceOpportunity {
  id: string;
  type: WhiteSpaceOpportunityType;
  title: string;
  detail: string;
  confidence: WhiteSpaceConfidence;
  estimatedRevenue: number | null;
  equipmentId: string | null;
  evidence: string[];
}

export interface WhiteSpaceMapBoard {
  summary: {
    total: number;
    replacement: number;
    attachment: number;
    serviceCoverage: number;
    partsPenetration: number;
  };
  opportunities: WhiteSpaceOpportunity[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function matchPrediction(machine: Account360FleetItem, predictions: CustomerFleetUnit[]): CustomerFleetUnit | null {
  const serial = normalize(machine.serial_number);
  if (serial) {
    const direct = predictions.find((item) => normalize(item.equipment_serial) === serial);
    if (direct) return direct;
  }
  const make = normalize(machine.make);
  const model = normalize(machine.model);
  return (
    predictions.find((item) =>
      normalize(item.make) === make &&
      normalize(item.model) === model &&
      item.year === machine.year,
    ) ?? null
  );
}

function machineLabel(machine: Account360FleetItem): string {
  const parts = [machine.year, machine.make, machine.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : machine.name;
}

function replacementConfidence(value: number | null | undefined): WhiteSpaceConfidence {
  if ((value ?? 0) >= 0.75) return "high";
  if ((value ?? 0) >= 0.5) return "medium";
  return "low";
}

export function buildWhiteSpaceMapBoard(input: {
  fleet: Account360FleetItem[];
  service: Account360ServiceJob[];
  parts: Account360PartsRollup;
  profile: CustomerProfileResponse | null;
  predictions: CustomerFleetUnit[];
  equipmentSignals: WhiteSpaceEquipmentSignal[];
  nowTime?: number;
}): WhiteSpaceMapBoard {
  const nowTime = input.nowTime ?? Date.now();
  const equipmentById = new Map(input.equipmentSignals.map((row) => [row.equipmentId, row]));
  const opportunities: WhiteSpaceOpportunity[] = [];

  for (const machine of input.fleet) {
    const prediction = matchPrediction(machine, input.predictions);
    const equipment = equipmentById.get(machine.id);
    const replacementAt = parseTime(prediction?.predicted_replacement_date ?? null);
    const deltaDays = replacementAt == null ? null : Math.ceil((replacementAt - nowTime) / 86_400_000);
    if (deltaDays != null && deltaDays <= 180) {
      opportunities.push({
        id: `replacement:${machine.id}`,
        type: "replacement",
        title: `${machineLabel(machine)} replacement whitespace`,
        detail: deltaDays <= 0
          ? "This unit is already in a modeled replacement window with no explicit replacement route on the account surface."
          : `This unit enters a modeled replacement window in ${deltaDays} days.`,
        confidence: replacementConfidence(prediction?.replacement_confidence),
        estimatedRevenue: equipment?.replacementCost ?? equipment?.currentMarketValue ?? null,
        equipmentId: machine.id,
        evidence: [
          prediction?.predicted_replacement_date
            ? `Predicted replacement date ${prediction.predicted_replacement_date}.`
            : "Replacement timing model present.",
          prediction?.replacement_confidence != null
            ? `${Math.round(prediction.replacement_confidence * 100)}% replacement confidence.`
            : "Replacement confidence not available.",
          machine.engine_hours != null ? `${Math.round(machine.engine_hours).toLocaleString()} engine hours.` : "Engine hours not available.",
        ],
      });
    }

    const attachmentCount = equipment?.attachmentCount ?? 0;
    if (attachmentCount === 0) {
      opportunities.push({
        id: `attachment:${machine.id}`,
        type: "attachment",
        title: `${machineLabel(machine)} attachment whitespace`,
        detail: "No registered attachments are tied to this machine, leaving accessory and productivity revenue unclaimed.",
        confidence: machine.engine_hours != null && machine.engine_hours > 0 ? "high" : "medium",
        estimatedRevenue: null,
        equipmentId: machine.id,
        evidence: [
          "Attachment inventory count is zero.",
          machine.engine_hours != null ? `${Math.round(machine.engine_hours).toLocaleString()} engine hours on the unit.` : "Engine-hour signal unavailable.",
        ],
      });
    }
  }

  const serviceContractRate = input.profile?.behavioral_signals?.service_contract_rate ?? null;
  const attachmentRate = input.profile?.behavioral_signals?.attachment_rate ?? null;
  if (input.fleet.length > 0 && (serviceContractRate == null || serviceContractRate < 0.5)) {
    opportunities.push({
      id: "service-coverage",
      type: "service_coverage",
      title: "Service coverage whitespace",
      detail: "Fleet size and service behavior suggest room to capture more planned service or contract revenue.",
      confidence: input.service.length > 0 ? "high" : "medium",
      estimatedRevenue: null,
      equipmentId: null,
      evidence: [
        `${input.fleet.length} owned machine${input.fleet.length === 1 ? "" : "s"} on file.`,
        `Service contract rate ${Math.round((serviceContractRate ?? 0) * 100)}%.`,
        `${input.service.length} service job${input.service.length === 1 ? "" : "s"} currently attached to the account.`,
      ],
    });
  }

  if (input.fleet.length > 0 && (input.parts.order_count === 0 || input.parts.order_count < input.fleet.length)) {
    opportunities.push({
      id: "parts-penetration",
      type: "parts_penetration",
      title: "Parts penetration whitespace",
      detail: "The current parts order footprint is thin relative to the installed fleet, leaving recurring parts revenue under-captured.",
      confidence: input.parts.order_count === 0 ? "high" : "medium",
      estimatedRevenue: null,
      equipmentId: null,
      evidence: [
        `${input.parts.order_count} parts order${input.parts.order_count === 1 ? "" : "s"} against ${input.fleet.length} owned machine${input.fleet.length === 1 ? "" : "s"}.`,
        attachmentRate != null ? `Attachment rate ${Math.round(attachmentRate * 100)}%.` : "Attachment rate unavailable.",
        input.parts.lifetime_total > 0 ? `Lifetime parts revenue ${Math.round(input.parts.lifetime_total).toLocaleString()}.` : "No parts revenue logged yet.",
      ],
    });
  }

  const weight: Record<WhiteSpaceOpportunityType, number> = {
    replacement: 4,
    service_coverage: 3,
    attachment: 2,
    parts_penetration: 1,
  };
  const confidenceWeight: Record<WhiteSpaceConfidence, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  opportunities.sort((a, b) => {
    if (weight[b.type] !== weight[a.type]) return weight[b.type] - weight[a.type];
    if (confidenceWeight[b.confidence] !== confidenceWeight[a.confidence]) {
      return confidenceWeight[b.confidence] - confidenceWeight[a.confidence];
    }
    return (b.estimatedRevenue ?? 0) - (a.estimatedRevenue ?? 0);
  });

  return {
    summary: {
      total: opportunities.length,
      replacement: opportunities.filter((item) => item.type === "replacement").length,
      attachment: opportunities.filter((item) => item.type === "attachment").length,
      serviceCoverage: opportunities.filter((item) => item.type === "service_coverage").length,
      partsPenetration: opportunities.filter((item) => item.type === "parts_penetration").length,
    },
    opportunities,
  };
}
