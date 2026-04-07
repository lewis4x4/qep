/**
 * IronDashboardShell — shared layout for every Iron Command Center.
 *
 * Each role's dashboard file picks the right widget set for its role and
 * passes its KPI row through the `kpis` slot. The shell handles:
 *   - Page header (title + subtitle, optional action button)
 *   - The morning brief section (always at the top, always for every role)
 *   - The KPI row (role-specific, kept inline for now)
 *   - The widget grid (role defaults from role-defaults.ts via WidgetGrid)
 *   - An optional `legacy` slot for sections not yet widget-ized
 *
 * The widget grid is the surface that becomes user-customizable in a later
 * slice. For now it's hard-coded to the role defaults.
 */
import type { ReactNode } from "react";
import { MorningBriefSection } from "./MorningBriefSection";
import { WidgetGrid } from "../widgets/WidgetGrid";

interface IronDashboardShellProps {
  title: string;
  subtitle: string;
  headerAction?: ReactNode;
  kpis?: ReactNode;
  widgetIds: string[];
  legacy?: ReactNode;
}

export function IronDashboardShell({
  title,
  subtitle,
  headerAction,
  kpis,
  widgetIds,
  legacy,
}: IronDashboardShellProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {headerAction}
      </div>

      <MorningBriefSection />

      {kpis}

      <WidgetGrid widgetIds={widgetIds} />

      {legacy}
    </div>
  );
}
