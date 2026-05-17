/**
 * WAVE phase 2: Thin wrapper that hosts the existing VoiceCapturePage
 * inside SalesShell at /sales/field-note. The page itself remains in
 * src/components/VoiceCapturePage.tsx so the 40+ links and tests that
 * import from that path continue to work. This wrapper reads the
 * current auth profile and forwards the props the underlying page
 * expects, so /sales/field-note no longer needs a duplicate route in
 * App.tsx with inline role gating.
 */

import { Navigate } from "react-router-dom";
import { VoiceCapturePage } from "@/components/VoiceCapturePage";
import { useAuth } from "@/hooks/useAuth";

export function FieldNotePage() {
  const { profile } = useAuth();
  if (!profile) return null;
  const allowedRoles = ["rep", "admin", "manager", "owner"] as const;
  if (!allowedRoles.includes(profile.role as (typeof allowedRoles)[number])) {
    return <Navigate to="/dashboard" replace />;
  }
  return <VoiceCapturePage userRole={profile.role} userEmail={profile.email} />;
}
