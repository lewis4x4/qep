import { Card } from "@/components/ui/card";
import type {
  CommandCenterResponse,
  CommandCenterScope,
  IronRole,
  RecommendationCardPayload,
  SectionKey,
} from "../api/commandCenter.types";
import { getSectionOrder } from "../lib/roleVariant";
import { ActionLanes } from "./ActionLanes";
import { AiChiefOfStaff } from "./AiChiefOfStaff";
import { CommandStrip } from "./CommandStrip";
import { PipelinePressureMap } from "./PipelinePressureMap";

interface RoleVariantShellProps {
  data: CommandCenterResponse;
  scope: CommandCenterScope;
  ironRole: IronRole;
  onScopeChange: (next: CommandCenterScope) => void;
  onAccept?: (card: RecommendationCardPayload) => void;
  onDismiss?: (card: RecommendationCardPayload) => void;
}

export function RoleVariantShell({
  data,
  scope,
  ironRole,
  onScopeChange,
  onAccept,
  onDismiss,
}: RoleVariantShellProps) {
  const order = getSectionOrder(ironRole);

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

  return <div className="space-y-6">{order.map((section) => renderSection(section))}</div>;
}
