import type { Account360FleetItem, Account360ServiceJob } from "./account-360-api";
import type { CustomerFleetUnit } from "@/features/dge/types";

export interface FleetIntelligenceEquipmentMetadata {
  equipmentId: string;
  attachmentCount: number;
}

export interface FleetIntelligenceMachine {
  equipmentId: string;
  label: string;
  serialNumber: string | null;
  ageYears: number | null;
  engineHours: number | null;
  attachmentCount: number;
  hasAttachmentGap: boolean;
  serviceCount: number;
  openServiceCount: number;
  predictedReplacementDate: string | null;
  replacementConfidence: number | null;
  replacementWindow: "now" | "30d" | "60d" | "90d" | "future" | "none";
}

export interface FleetIntelligenceBoard {
  summary: {
    ownedMachines: number;
    avgAgeYears: number | null;
    avgHours: number | null;
    attachmentGaps: number;
    replacementWindowMachines: number;
  };
  machines: FleetIntelligenceMachine[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function openStage(stage: string): boolean {
  return !["closed", "invoiced", "cancelled"].includes(stage);
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function machineLabel(machine: Account360FleetItem): string {
  const titleParts = [machine.year, machine.make, machine.model].filter(Boolean);
  return titleParts.length > 0 ? titleParts.join(" ") : machine.name;
}

function matchPrediction(
  machine: Account360FleetItem,
  predictions: CustomerFleetUnit[],
): CustomerFleetUnit | null {
  const serial = normalize(machine.serial_number);
  if (serial) {
    const direct = predictions.find((row) => normalize(row.equipment_serial) === serial);
    if (direct) return direct;
  }

  const make = normalize(machine.make);
  const model = normalize(machine.model);
  return (
    predictions.find((row) =>
      normalize(row.make) === make &&
      normalize(row.model) === model &&
      row.year === machine.year,
    ) ?? null
  );
}

function replacementWindow(value: string | null, nowTime: number): FleetIntelligenceMachine["replacementWindow"] {
  const parsed = parseTime(value);
  if (parsed == null) return "none";
  const deltaDays = Math.ceil((parsed - nowTime) / 86_400_000);
  if (deltaDays <= 0) return "now";
  if (deltaDays <= 30) return "30d";
  if (deltaDays <= 60) return "60d";
  if (deltaDays <= 90) return "90d";
  return "future";
}

export function buildFleetIntelligenceBoard(input: {
  fleet: Account360FleetItem[];
  service: Account360ServiceJob[];
  predictions: CustomerFleetUnit[];
  equipmentMetadata: FleetIntelligenceEquipmentMetadata[];
  nowTime?: number;
}): FleetIntelligenceBoard {
  const nowTime = input.nowTime ?? Date.now();
  const attachmentByEquipmentId = new Map(
    input.equipmentMetadata.map((row) => [row.equipmentId, row.attachmentCount]),
  );

  const machines = input.fleet.map((machine) => {
    const ageYears = machine.year ? new Date(nowTime).getFullYear() - machine.year : null;
    const prediction = matchPrediction(machine, input.predictions);
    const machineService = input.service.filter((job) => job.machine_id === machine.id);
    const attachmentCount = attachmentByEquipmentId.get(machine.id) ?? 0;
    const predictedReplacementDate = prediction?.predicted_replacement_date ?? null;

    return {
      equipmentId: machine.id,
      label: machineLabel(machine),
      serialNumber: machine.serial_number,
      ageYears,
      engineHours: machine.engine_hours,
      attachmentCount,
      hasAttachmentGap: attachmentCount === 0,
      serviceCount: machineService.length,
      openServiceCount: machineService.filter((job) => openStage(job.current_stage)).length,
      predictedReplacementDate,
      replacementConfidence: prediction?.replacement_confidence ?? null,
      replacementWindow: replacementWindow(predictedReplacementDate, nowTime),
    } satisfies FleetIntelligenceMachine;
  });

  machines.sort((a, b) => {
    const weight = { now: 5, "30d": 4, "60d": 3, "90d": 2, future: 1, none: 0 };
    if (weight[b.replacementWindow] !== weight[a.replacementWindow]) {
      return weight[b.replacementWindow] - weight[a.replacementWindow];
    }
    if ((b.replacementConfidence ?? 0) !== (a.replacementConfidence ?? 0)) {
      return (b.replacementConfidence ?? 0) - (a.replacementConfidence ?? 0);
    }
    if ((b.engineHours ?? 0) !== (a.engineHours ?? 0)) {
      return (b.engineHours ?? 0) - (a.engineHours ?? 0);
    }
    return (b.ageYears ?? 0) - (a.ageYears ?? 0);
  });

  const ageValues = machines.map((item) => item.ageYears).filter((value): value is number => value != null);
  const hourValues = machines.map((item) => item.engineHours).filter((value): value is number => value != null);

  return {
    summary: {
      ownedMachines: machines.length,
      avgAgeYears: ageValues.length > 0 ? ageValues.reduce((sum, value) => sum + value, 0) / ageValues.length : null,
      avgHours: hourValues.length > 0 ? hourValues.reduce((sum, value) => sum + value, 0) / hourValues.length : null,
      attachmentGaps: machines.filter((item) => item.hasAttachmentGap).length,
      replacementWindowMachines: machines.filter((item) => item.replacementWindow !== "none" && item.replacementWindow !== "future").length,
    },
    machines,
  };
}
