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
import { useSearchParams } from "react-router-dom";
import type { UserRole } from "@/lib/database.types";
import { getEffectiveIronRole, isIronRole, type IronRole } from "@/features/qrm/lib/iron-roles";
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
import { IRON_ROLE_DISPLAY_NAMES } from "../lib/role-display-names";

export interface FloorPageProps {
  userId: string;
  userRole: UserRole;
  /** `profiles.full_name` is nullable in the schema — default to empty
   *  string and fall through to the role label in the top bar. */
  userFullName: string | null;
  ironRoleFromProfile?: string | null;
}

const ADMIN_ROLES: UserRole[] = ["admin", "manager", "owner"];
const FLOOR_PREVIEW_NAMES = new Set(["brian lewis", "ryan mckenzie", "rylee mckenzie"]);
const FLOOR_PREVIEW_ROLES: Array<{ role: IronRole; label: string }> = [
  { role: "iron_manager", label: "Sales Manager" },
  { role: "iron_advisor", label: "Sales Rep" },
  { role: "iron_parts_counter", label: "Parts Counter" },
  { role: "iron_parts_manager", label: "Parts Manager" },
  { role: "iron_owner", label: "Owner" },
  { role: "iron_woman", label: "Deal Desk" },
  { role: "iron_man", label: "Prep / Service" },
];

export function FloorPage({
  userId,
  userRole,
  userFullName,
  ironRoleFromProfile,
}: FloorPageProps) {
  // Dominant role resolution — same policy the existing DashboardRouter uses.
  const { blend } = useIronRoleBlend(userId);
  const resolvedIronRole = getEffectiveIronRole(userRole, blend, ironRoleFromProfile);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPreviewRole = searchParams.get("previewRole");
  const canPreviewRoles = canUseFloorPreview(userRole, userFullName);
  const previewRole =
    canPreviewRoles && isIronRole(requestedPreviewRole) ? requestedPreviewRole : null;
  const ironRole = previewRole
    ? {
        role: previewRole,
        display: IRON_ROLE_DISPLAY_NAMES[previewRole],
        description: "Previewing a role-home layout",
      }
    : resolvedIronRole;

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
  const previewingDifferentRole = previewRole != null && previewRole !== resolvedIronRole.role;

  const handlePreviewRoleChange = (nextRole: IronRole) => {
    const next = new URLSearchParams(searchParams);
    if (nextRole === resolvedIronRole.role) {
      next.delete("previewRole");
    } else {
      next.set("previewRole", nextRole);
    }
    setSearchParams(next, { replace: false });
  };

  return (
    <div className="floor-texture flex min-h-screen flex-col bg-[hsl(var(--qep-deck))] text-foreground antialiased">
      <FloorTopBar
        userDisplayName={displayName || ironRole.display}
        roleDisplayName={previewingDifferentRole ? `Preview: ${ironRole.display}` : ironRole.display}
        isAdmin={isAdmin}
      />

      {canPreviewRoles && (
        <section className="border-b border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))]/70 px-4 py-2">
          <div className="mx-auto flex max-w-[1600px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.16em] text-[hsl(var(--qep-orange))]">
                Role preview
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Actual role: {resolvedIronRole.display}
                {previewingDifferentRole ? ` · Viewing ${ironRole.display}` : ""}
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.14em]">
                View as
              </span>
              <select
                value={ironRole.role}
                onChange={(event) => handlePreviewRoleChange(event.target.value as IronRole)}
                aria-label="Preview Floor as role"
                className="h-8 rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] px-2 font-kpi text-[11px] font-extrabold uppercase tracking-[0.1em] text-foreground outline-none transition-colors hover:border-[hsl(var(--qep-orange))] focus:border-[hsl(var(--qep-orange))]"
              >
                {FLOOR_PREVIEW_ROLES.map((option) => (
                  <option key={option.role} value={option.role}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

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
      <FloorWidgetGrid widgets={visibleWidgets} isAdmin={isAdmin} isLoading={isLoading} />

      <FloorFooter showOfficeLink={isAdmin} layoutUpdatedAt={updatedAt} />
    </div>
  );
}

function canUseFloorPreview(userRole: UserRole, userFullName: string | null): boolean {
  if (ADMIN_ROLES.includes(userRole)) return true;
  const normalizedName = (userFullName ?? "").trim().toLowerCase();
  return FLOOR_PREVIEW_NAMES.has(normalizedName);
}
