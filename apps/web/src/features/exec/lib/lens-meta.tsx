import type { ComponentType, ReactNode } from "react";
import { Crown, Gauge, Truck, Wallet } from "lucide-react";
import type { ExecRoleTab } from "./types";

export type ExecutiveTab = "overview" | ExecRoleTab;

export interface ExecutiveLensMeta {
  role: ExecRoleTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  detail: string;
}

export interface ExecutiveTabOption {
  key: ExecutiveTab;
  label: string;
  icon: ReactNode;
}

export const EXEC_TABS: ExecutiveTabOption[] = [
  { key: "overview", label: "Overview", icon: <Gauge className="h-3 w-3" /> },
  { key: "ceo", label: "CEO", icon: <Crown className="h-3 w-3" /> },
  { key: "cfo", label: "CFO", icon: <Wallet className="h-3 w-3" /> },
  { key: "coo", label: "COO", icon: <Truck className="h-3 w-3" /> },
];

export const EXEC_LENS_META: Record<ExecRoleTab, ExecutiveLensMeta> = {
  ceo: {
    role: "ceo",
    label: "CEO",
    icon: Crown,
    tone: "border-qep-orange/30 bg-qep-orange/5",
    title: "Growth, risk concentration, and operating leverage",
    detail:
      "Use this lens to pressure-test pipeline quality, branch variance, customer health, and where the business is gaining or leaking momentum.",
  },
  cfo: {
    role: "cfo",
    label: "CFO",
    icon: Wallet,
    tone: "border-emerald-500/30 bg-emerald-500/5",
    title: "Cash discipline, margin integrity, and policy pressure",
    detail:
      "Use this lens to spot AR exposure, margin leakage, deposit misses, payment breakdowns, and the next finance interventions that matter.",
  },
  coo: {
    role: "coo",
    label: "COO",
    icon: Truck,
    tone: "border-sky-500/30 bg-sky-500/5",
    title: "Execution reliability, backlog recovery, and operating throughput",
    detail:
      "Use this lens to run service, logistics, and recovery queues before they turn into customer-facing misses or revenue drag.",
  },
};
