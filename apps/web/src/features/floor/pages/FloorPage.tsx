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
import { useEffect } from "react";
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
  const { layout, updatedAt, isLoading } = useFloorLayout(ironRole.role);

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

  const hasQuickActions = layout.quickActions.length > 0;

  return (
    <div className="floor-texture flex min-h-screen flex-col bg-[hsl(var(--qep-deck))] text-foreground antialiased">
      <FloorTopBar
        userDisplayName={displayName || ironRole.display}
        roleDisplayName={ironRole.display}
        isAdmin={isAdmin}
      />

      {layout.showNarrative && !isLoading && (
        <>
          <FloorZoneLabel index="01" label="NARRATIVE" />
          <FloorNarrative role={ironRole.role} userFirstName={firstName} />
        </>
      )}

      {hasQuickActions && (
        <>
          <FloorZoneLabel index="02" label="ACTIONS" className="mt-2" />
          <FloorHero actions={layout.quickActions} />
        </>
      )}

      <FloorZoneLabel index="03" label="THE FLOOR" className="mt-4" />
      <FloorWidgetGrid widgets={layout.widgets} isAdmin={isAdmin} />

      <FloorFooter showOfficeLink={isAdmin} layoutUpdatedAt={updatedAt} />
    </div>
  );
}
