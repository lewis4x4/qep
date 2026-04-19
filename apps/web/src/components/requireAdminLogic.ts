import type { UserRole } from "@/lib/database.types";

export type AccessDecision = "loading" | "redirect" | "allow";

/**
 * Pure access-decision helper for RequireAdmin. Lives in its own file
 * (not co-located in RequireAdmin.tsx) so unit tests can import it
 * without pulling in the React/useAuth/auth-recovery module graph —
 * which matters because other test files mock auth-recovery partially
 * and those mocks can cross-contaminate the module loader.
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
