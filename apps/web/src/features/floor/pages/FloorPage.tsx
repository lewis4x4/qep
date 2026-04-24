/**
 * FloorPage — the /floor route root.
 *
 * Orchestrates the five zones described in docs/floor/visual-language.md:
 *   TopBar (56px) → Narrative (48px) → Quick-action hero (140px) →
 *   Widget grid (up to 6) → Footer (36px).
 *
 * Forces dark mode on the document so the Floor always renders with the
 * charcoal palette regardless of the user's theme preference — the brand
 * is dark, and the Floor is the canonical team-facing surface.
 */
import { useEffect, useMemo } from "react";
import type { UserRole } from "@/lib/database.types";
import { getEffectiveIronRole } from "@/features/qrm/lib/iron-roles";
import { useIronRoleBlend } from "@/features/qrm/lib/useIronRoleBlend";

import { FloorTopBar } from "../components/FloorTopBar";
import { FloorNarrative } from "../components/FloorNarrative";
import { FloorHero } from "../components/FloorHero";
import { FloorWidgetGrid } from "../components/FloorWidgetGrid";
import { FloorFooter } from "../components/FloorFooter";
import { FloorZoneLabel } from "../components/FloorZoneLabel";
import { useFloorLayout } from "../hooks/useFloorLayout";
import { useFloorNarrative } from "../hooks/useFloorNarrative";
import { useFloorAttentionSignals } from "../hooks/useFloorAttentionSignals";
import { applyAttentionPinning } from "../lib/attention";
import { FLOOR_WIDGET_REGISTRY, resolveFloorWidget } from "../lib/floor-widget-registry";

export interface FloorPageProps {
  userId: string;
  userRole: UserRole;
  /** `profiles.full_name` is nullable in the schema — default to empty
   *  string and fall through to the role label in the top bar. */
  userFullName: string | null;
  ironRoleFromProfile?: string | null;
}

const ADMIN_ROLES: UserRole[] = ["admin", "manager", "owner"];

export function FloorPage({
  userId,
  userRole,
  userFullName,
  ironRoleFromProfile,
}: FloorPageProps) {
  // Dominant role resolution — same policy the existing DashboardRouter uses.
  const { blend } = useIronRoleBlend(userId);
  const ironRole = getEffectiveIronRole(userRole, blend, ironRoleFromProfile);

  // Layout for this role (workspace-scoped via RLS).
  const { layout, updatedAt, isLoading } = useFloorLayout(ironRole.role, userId);

  // Dark-only on The Floor. We force the class but don't persist the
  // preference — the user's chosen theme elsewhere is unchanged.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  const displayName = userFullName ?? "";
  const firstName = displayName.split(" ").filter(Boolean)[0] ?? "";
  const isAdmin = ADMIN_ROLES.includes(userRole);
  const narrative = useFloorNarrative(ironRole.role, firstName);
  const attentionSignals = useFloorAttentionSignals(ironRole.role, userId);

  const serialActionBand = useMemo(() => {
    const firstWidget = layout.widgets[0];
    if (ironRole.role !== "iron_parts_counter" || firstWidget?.id !== "parts.serial-first") {
      return null;
    }
    const descriptor = resolveFloorWidget(firstWidget.id);
    if (!descriptor) return null;
    const Component = descriptor.component;
    return <Component />;
  }, [ironRole.role, layout.widgets]);

  const floorWidgets = useMemo(
    () =>
      serialActionBand
        ? layout.widgets.filter((widget, index) => !(index === 0 && widget.id === "parts.serial-first"))
        : layout.widgets,
    [layout.widgets, serialActionBand],
  );

  const visibleWidgets = useMemo(
    () =>
      applyAttentionPinning(
        floorWidgets,
        FLOOR_WIDGET_REGISTRY,
        attentionSignals.data ?? null,
      ),
    [floorWidgets, attentionSignals.data],
  );

  const hasQuickActions = layout.quickActions.length > 0 || !!serialActionBand;

  return (
    <div className="floor-texture flex min-h-screen flex-col bg-[hsl(var(--qep-deck))] text-foreground antialiased">
      <FloorTopBar
        userDisplayName={displayName || ironRole.display}
        roleDisplayName={ironRole.display}
      />

      {layout.showNarrative && !isLoading && (
        <>
          <FloorZoneLabel index="01" label="NARRATIVE" />
          <FloorNarrative
            role={ironRole.role}
            userFirstName={firstName}
            text={narrative.text}
            fresh={narrative.fresh}
          />
        </>
      )}

      {hasQuickActions && (
        <>
          <FloorZoneLabel index="02" label="ACTIONS" className="mt-2" />
          <FloorHero actions={layout.quickActions} actionBand={serialActionBand} />
        </>
      )}

      <FloorZoneLabel index="03" label="THE FLOOR" className="mt-4" />
      <FloorWidgetGrid widgets={visibleWidgets} isLoading={isLoading} />

      <FloorFooter showOfficeLink={isAdmin} layoutUpdatedAt={updatedAt} />
    </div>
  );
}
