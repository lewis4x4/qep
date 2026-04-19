import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { UserRole } from "@/lib/database.types";

/**
 * RequireAdmin — role-gated route wrapper.
 *
 * Fixes Slice-07 audit finding H3 (Rules-of-Hooks violation): admin pages
 * were early-return-with-<Navigate> after some hooks but before others.
 * The pattern risks "rendered different hooks between renders" when profile
 * transitions from null → loaded.
 *
 * This wrapper gates at the component-tree level — the inner page only
 * mounts once the gate passes, so hook order inside the page is stable.
 *
 * Usage:
 *   export function MyAdminPage() {
 *     return <RequireAdmin><MyAdminPageInner /></RequireAdmin>;
 *   }
 *   function MyAdminPageInner() { // all hooks unconditionally }
 *
 * Loading state (Q3=A): a centered spinner instead of flash-of-redirect
 * while auth is still resolving. Matches the loading pattern used in the
 * app shell.
 */

const DEFAULT_ROLES: UserRole[] = ["admin", "manager", "owner"];

export type AccessDecision = "loading" | "redirect" | "allow";

/**
 * Pure access decision — exported for unit testing without a DOM.
 * Encodes the full gate logic so the component is a thin presentation shell.
 */
export function decideAccess(input: {
  loading: boolean;
  profileRole: UserRole | null;
  allowedRoles: readonly UserRole[];
}): AccessDecision {
  if (input.loading) return "loading";
  if (!input.profileRole) return "redirect";
  if (!input.allowedRoles.includes(input.profileRole)) return "redirect";
  return "allow";
}

export interface RequireAdminProps {
  /** Roles allowed to see the children. Default: admin / manager / owner. */
  roles?: UserRole[];
  /** Where to redirect an unauthorized user. Default: /dashboard. */
  fallback?: string;
  children: React.ReactNode;
}

export function RequireAdmin({
  roles = DEFAULT_ROLES,
  fallback = "/dashboard",
  children,
}: RequireAdminProps) {
  const { profile, loading } = useAuth();

  const decision = decideAccess({
    loading,
    profileRole: profile?.role ?? null,
    allowedRoles: roles,
  });

  if (decision === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-[calc(100vh-4rem)] items-center justify-center"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (decision === "redirect") {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
