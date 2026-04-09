import type { UserRole } from "@/lib/database.types";
import { getEffectiveIronRole } from "../../qrm/lib/iron-roles";
import { useIronRoleBlend } from "../../qrm/lib/useIronRoleBlend";
import { IronManagerDashboard } from "./IronManagerDashboard";
import { IronAdvisorDashboard } from "./IronAdvisorDashboard";
import { IronWomanDashboard } from "./IronWomanDashboard";
import { IronManDashboard } from "./IronManDashboard";

interface DashboardRouterProps {
  userId: string;
  userRole: UserRole;
  ironRoleFromProfile?: string | null;
}

export function DashboardRouter({ userId, userRole, ironRoleFromProfile }: DashboardRouterProps) {
  // Phase 0 P0.5 — blend-aware dominant role resolution.
  // The dashboard router uses the SAME dominant-role pick as the Command
  // Center: a manager covering an advisor still routes to the manager
  // dashboard because that's their primary surface. The advisor cover only
  // changes downstream ranking weights, not which dashboard renders.
  const { blend: blendRows } = useIronRoleBlend(userId);
  const ironRole = getEffectiveIronRole(userRole, blendRows, ironRoleFromProfile);

  switch (ironRole.role) {
    case "iron_manager":
      return <IronManagerDashboard />;
    case "iron_advisor":
      return <IronAdvisorDashboard userId={userId} />;
    case "iron_woman":
      return <IronWomanDashboard />;
    case "iron_man":
      return <IronManDashboard />;
    default:
      return <IronAdvisorDashboard userId={userId} />;
  }
}
