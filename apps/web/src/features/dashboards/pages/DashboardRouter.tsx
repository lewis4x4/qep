import type { UserRole } from "@/lib/database.types";
import { getIronRole } from "../../qrm/lib/iron-roles";
import { IronManagerDashboard } from "./IronManagerDashboard";
import { IronAdvisorDashboard } from "./IronAdvisorDashboard";
import { IronWomanDashboard } from "./IronWomanDashboard";
import { IronManDashboard } from "./IronManDashboard";

interface DashboardRouterProps {
  userId: string;
  userRole: UserRole;
}

export function DashboardRouter({ userId, userRole }: DashboardRouterProps) {
  const ironRole = getIronRole(userRole);

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
