import { Navigate } from "react-router-dom";
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
  /** Slice: The Floor — when true, the user opted into the simplified
   *  Floor surface and should never land on the legacy Iron dashboards.
   *  Renders a Navigate to /floor. */
  floorMode?: boolean | null;
}

export function DashboardRouter({
  userId,
  userRole,
  ironRoleFromProfile,
  floorMode,
}: DashboardRouterProps) {
  // Slice: The Floor — short-circuit when the profile opted into The Floor.
  // This is the /dashboard → /floor promotion path; the home-route
  // resolver (lib/home-route.ts) also honors this flag on first login,
  // so users with floor_mode=true never see the Iron dashboards.
  if (floorMode) {
    return <Navigate to="/floor" replace />;
  }

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
    // ── Slice: The Floor role extensions ──
    // The three QEP-specific roles have no dedicated Iron dashboard, so
    // they fall back to the advisor dashboard when floor_mode is off.
    // When floor_mode is on (the intended path for these roles), the
    // short-circuit above already sent them to /floor.
    case "iron_owner":
    case "iron_parts_counter":
    case "iron_parts_manager":
      return <IronAdvisorDashboard userId={userId} />;
    default:
      return <IronAdvisorDashboard userId={userId} />;
  }
}
