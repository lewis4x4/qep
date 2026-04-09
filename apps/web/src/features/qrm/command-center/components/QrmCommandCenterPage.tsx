/**
 * QRM Moonshot Command Center — page entry.
 *
 * Slice 1 ships behind the parallel route `/qrm/command` so the existing
 * `QrmHubPage` at `/qrm` is untouched. Slice 2 will flip the root route to
 * this page and delete the legacy hub.
 */

import { useCallback, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
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
  // P0.5 W1-2 — when the operator holds a non-trivial blend, render the
  // dominant weight as a percentage on the role badge so the user can see
  // the implicit "60%" alongside the "Also covering: 40%" entries shown
  // by RoleVariantShell. Single-role users (blend.length <= 1) get the
  // unadorned badge — adding a "100%" chip would just be noise.
  const dominantWeightLabel = blend.length > 1
    ? ` · ${Math.round(blend[0].weight * 100)}%`
    : "";
  const headline = getRoleHeadline(ironRole);
  const [scope, setScope] = useState<CommandCenterScope>("mine");

  const query = useCommandCenter(scope);

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
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-8 text-foreground">{headline.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{headline.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-qep-orange/30 text-qep-orange">
            {ironRoleInfo.display}
            {dominantWeightLabel}
          </Badge>
          <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            Slice 1 · spine
          </Badge>
        </div>
      </header>

      {query.isLoading && (
        <Card className="flex items-center justify-center gap-3 border-border/60 bg-card/40 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-qep-orange" />
          Loading QRM Command Center...
        </Card>
      )}

      {query.isError && (
        <Card className="flex flex-col items-center gap-3 border-rose-500/40 bg-rose-500/[0.05] p-10 text-sm text-rose-500">
          <AlertTriangle className="h-5 w-5" />
          <p className="font-medium">Could not load Command Center</p>
          <p className="text-xs text-muted-foreground">
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            Retry
          </Button>
        </Card>
      )}

      {query.data && (
        <RoleVariantShell
          data={query.data}
          scope={scope}
          ironRole={ironRole}
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
