import type { ExecRoleTab } from "./types";

export interface ExecPacketPreset {
  id: string;
  label: string;
  description: string;
  boardReady: boolean;
}

export const EXEC_PACKET_PRESETS: Record<ExecRoleTab, ExecPacketPreset[]> = {
  ceo: [
    {
      id: "daily-brief",
      label: "Daily Brief",
      description: "Fast morning packet for today’s posture and the next moves.",
      boardReady: false,
    },
    {
      id: "weekly-board",
      label: "Weekly Board",
      description: "Board-ready version with condensed scorecard and top risks.",
      boardReady: true,
    },
  ],
  cfo: [
    {
      id: "daily-brief",
      label: "Daily Brief",
      description: "Finance posture for today’s exceptions, AR, deposits, and leakage.",
      boardReady: false,
    },
    {
      id: "weekly-board",
      label: "Weekly Board",
      description: "Board-ready finance packet with condensed risk and compliance posture.",
      boardReady: true,
    },
  ],
  coo: [
    {
      id: "daily-brief",
      label: "Daily Brief",
      description: "Execution-first packet for service, logistics, readiness, and recovery.",
      boardReady: false,
    },
    {
      id: "weekly-board",
      label: "Weekly Board",
      description: "Board-ready operations packet with condensed blockers and throughput view.",
      boardReady: true,
    },
  ],
};

export function getPacketPreset(role: ExecRoleTab, presetId: string | null | undefined): ExecPacketPreset {
  const presets = EXEC_PACKET_PRESETS[role];
  return presets.find((preset) => preset.id === presetId) ?? presets[0];
}
