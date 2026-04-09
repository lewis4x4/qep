import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type {
  CommandCenterResponse,
  CommandCenterScope,
  IronRole,
  RecommendationCardPayload,
  SectionKey,
} from "../api/commandCenter.types";
import type { IronRoleBlendEntry } from "../../lib/iron-roles";
import { getSectionOrder } from "../lib/roleVariant";
import { ActionLanes } from "./ActionLanes";
import { AiChiefOfStaff } from "./AiChiefOfStaff";
import { CommandStrip } from "./CommandStrip";
import { PipelinePressureMap } from "./PipelinePressureMap";
import { RevenueRealityBoard } from "./RevenueRealityBoard";

interface RoleVariantShellProps {
  data: CommandCenterResponse;
  scope: CommandCenterScope;
  /**
   * The dominant Iron role driving section order. Resolved upstream from
   * `getEffectiveIronRole(userRole, blendRows, ironRoleFromProfile)` so the
   * shell stays free of fallback logic.
   */
  ironRole: IronRole;
  /**
   * Phase 0 P0.5 — full active blend. When the operator holds more than one
   * role (a manager covering an advisor, etc), the shell renders a
   * "covering" badge for every non-dominant entry. Empty / undefined means
   * single-role legacy mode and no extra badges are shown.
   */
  blend?: IronRoleBlendEntry[];
  onScopeChange: (next: CommandCenterScope) => void;
  onAccept?: (card: RecommendationCardPayload) => void;
  onDismiss?: (card: RecommendationCardPayload) => void;
}

export function RoleVariantShell({
  data,
  scope,
  ironRole,
  blend,
  onScopeChange,
  onAccept,
  onDismiss,
}: RoleVariantShellProps) {
  const order = getSectionOrder(ironRole);

  // The "covering" tail is every blend entry whose role is NOT the dominant
  // one. Sorted by weight DESC so the heaviest cover shows first. Hidden
  // when no blend is provided (legacy single-role render) or when the only
  // entry IS the dominant role.
  const coveringEntries = (blend ?? []).filter((entry) => entry.role !== ironRole);

  function renderSection(section: SectionKey) {
    const freshness = data.freshness[section];
    switch (section) {
      case "commandStrip":
        return (
          <CommandStrip
            key={section}
            payload={data.commandStrip}
            freshness={freshness}
            scope={scope}
            onScopeChange={onScopeChange}
            ironRole={ironRole}
          />
        );
      case "aiChiefOfStaff":
        return (
          <AiChiefOfStaff
            key={section}
            payload={data.aiChiefOfStaff}
            freshness={freshness}
            onAccept={onAccept}
            onDismiss={onDismiss}
          />
        );
      case "actionLanes":
        return (
          <ActionLanes
            key={section}
            payload={data.actionLanes}
            freshness={freshness}
            onAccept={onAccept}
            onDismiss={onDismiss}
          />
        );
      case "pipelinePressure":
        return (
          <PipelinePressureMap
            key={section}
            payload={data.pipelinePressure}
            freshness={freshness}
          />
        );
      case "revenueRealityBoard":
        return (
          <RevenueRealityBoard
            key={section}
            payload={data.revenueRealityBoard}
            freshness={freshness}
          />
        );
      default: {
        const exhaustive: never = section;
        return (
          <Card key={String(exhaustive)} className="border-dashed border-border/60 p-4 text-xs text-muted-foreground">
            Unknown section: {String(exhaustive)}
          </Card>
        );
      }
    }
  }

  return (
    <div className="space-y-6">
      {coveringEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>Also covering:</span>
          {coveringEntries.map((entry) => (
            <Badge
              key={entry.role}
              variant="outline"
              className="border-qep-orange/30 text-qep-orange"
            >
              {entry.display} · {Math.round(entry.weight * 100)}%
            </Badge>
          ))}
        </div>
      )}
      {order.map((section) => renderSection(section))}
    </div>
  );
}
