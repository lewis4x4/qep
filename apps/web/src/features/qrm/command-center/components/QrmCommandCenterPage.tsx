/**
 * QRM Moonshot Command Center — page entry.
 *
 * Canonical QRM command center served at `/qrm`.
 * The legacy QRM hub has been retired from the live route.
 */

import { useCallback, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import type { UserRole } from "@/lib/database.types";
import { canUseElevatedQrmScopes } from "@/lib/home-route";
import { isIronRole, resolveIronRoleAndBlend } from "../../lib/iron-roles";
import { useIronRoleBlend } from "../../lib/useIronRoleBlend";
import type {
  CommandCenterScope,
  IronRole,
  RecommendationCardPayload,
} from "../api/commandCenter.types";
import { useCommandCenter } from "../hooks/useCommandCenter";
import { getRoleHeadline } from "../lib/roleVariant";
import { RoleVariantShell } from "./RoleVariantShell";

interface QrmCommandCenterPageProps {
  userRole: UserRole;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  ironRoleFromProfile?: string | null;
}

export function QrmCommandCenterPage({
  userRole,
  userId,
  ironRoleFromProfile,
}: QrmCommandCenterPageProps) {
  // Phase 0 P0.5 — load blend; falls through to legacy single-role on empty.
  // Single-pass: resolveIronRoleAndBlend parses the blend rows once and
  // returns both the dominant role info AND the parsed blend, instead of
  // calling getIronRoleBlend + getEffectiveIronRole separately (which would
  // re-parse the rows twice per render).
  const { blend: blendRows } = useIronRoleBlend(userId);
  const { info: ironRoleInfo, blend } = resolveIronRoleAndBlend(
    userRole,
    blendRows,
    ironRoleFromProfile,
  );
  const ironRole: IronRole = isIronRole(ironRoleInfo.role) ? ironRoleInfo.role : "iron_advisor";
  const elevatedViewer = canUseElevatedQrmScopes(userRole, ironRole);
  // P0.5 W1-2 — when the operator holds a non-trivial blend, render the
  // dominant weight as a percentage on the role badge so the user can see
  // the implicit "60%" alongside the "Also covering: 40%" entries shown
  // by RoleVariantShell. Single-role users (blend.length <= 1) get the
  // unadorned badge — adding a "100%" chip would just be noise.
  const dominantWeightLabel = blend.length > 1
    ? ` · ${Math.round(blend[0].weight * 100)}%`
    : "";
  const headline = getRoleHeadline(ironRole);
  const [scope, setScope] = useState<CommandCenterScope>(
    elevatedViewer ? "team" : "mine",
  );

  const query = useCommandCenter(scope);

  const commandStrip = query.data?.commandStrip;
  const aiChiefOfStaff = query.data?.aiChiefOfStaff;
  const recommendationCount = query.data
    ? query.data.actionLanes.revenueReady.length + query.data.actionLanes.revenueAtRisk.length + query.data.actionLanes.blockers.length
    : 0;
  const commandCenterWhatMattersNow = query.isLoading
    ? "Command-center pressure is loading."
    : commandStrip
      ? `${commandStrip.blockedDeals} blocked deal${commandStrip.blockedDeals === 1 ? "" : "s"}, ${commandStrip.overdueFollowUps} overdue follow-up${commandStrip.overdueFollowUps === 1 ? "" : "s"}, and ${recommendationCount} guided move${recommendationCount === 1 ? "" : "s"} are in play.`
      : "Command-center summary is not available yet.";
  const commandCenterNextMove = query.isLoading
    ? "Preparing the next move."
    : aiChiefOfStaff?.bestMove
      ? aiChiefOfStaff.bestMove.headline
      : commandStrip && commandStrip.blockedDeals > 0
        ? `Clear ${commandStrip.blockedDeals} blocked deal${commandStrip.blockedDeals === 1 ? "" : "s"} before scanning lower-priority work.`
        : "Use this pass to confirm the board is quiet and keep the next action lane clean.";
  const commandCenterRiskIfIgnored = commandStrip && (commandStrip.blockedDeals > 0 || commandStrip.overdueFollowUps > 0 || commandStrip.atRiskRevenue > 0)
    ? "If this page becomes a dashboard instead of a command lane, urgent work will hide in plain sight."
    : "Without a clear top brief, operators spend time scanning instead of deciding.";

  const handleAccept = useCallback((card: RecommendationCardPayload) => {
    // Phase 0 P0.8 — log trace_id for telemetry. Full event emission in Phase 2.
    if (card.traceId) {
      console.info("[QRM] recommendation accepted", { traceId: card.traceId, entityId: card.entityId });
    }
  }, []);

  const handleDismiss = useCallback((card: RecommendationCardPayload) => {
    // Phase 0 P0.8 — log trace_id for telemetry. Full event emission in Phase 2.
    if (card.traceId) {
      console.info("[QRM] recommendation dismissed", { traceId: card.traceId, entityId: card.entityId });
    }
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 sm:px-6 lg:px-8 min-h-full">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-4xl sm:text-5xl font-display font-medium tracking-tight text-white mb-2">{headline.title}</h1>
          <p className="text-lg font-light text-slate-400">{headline.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-qep-orange bg-qep-orange/10 px-3 py-1 rounded-full">
            {ironRoleInfo.display}
            {dominantWeightLabel}
          </span>
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-500 bg-white/5 px-3 py-1 rounded-full">
            Slice 1 · spine
          </span>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What matters now</p>
          <p className="mt-2 text-sm text-foreground">{commandCenterWhatMattersNow}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next move</p>
          <p className="mt-2 text-sm text-foreground">{commandCenterNextMove}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk if ignored</p>
          <p className="mt-2 text-sm text-foreground">{commandCenterRiskIfIgnored}</p>
        </Card>
      </div>

      {query.isLoading && (
        <GlassPanel className="flex items-center justify-center gap-3 py-20 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-qep-orange" />
          Loading QRM Command Center...
        </GlassPanel>
      )}

      {query.isError && (
        <GlassPanel className="flex flex-col items-center gap-3 border-red-500/40 bg-red-500/[0.02] py-20 text-sm text-red-400">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-lg font-light">Could not load Command Center</p>
          <p className="text-xs text-red-400/80 mb-4">
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()} className="rounded-full border-red-500/20 hover:bg-red-500/10">
            Retry
          </Button>
        </GlassPanel>
      )}

      {query.data && (
        <RoleVariantShell
          data={query.data}
          scope={scope}
          ironRole={ironRole}
          isElevatedViewer={elevatedViewer}
          blend={blend}
          onScopeChange={setScope}
          onAccept={handleAccept}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  );
}

export default QrmCommandCenterPage;
