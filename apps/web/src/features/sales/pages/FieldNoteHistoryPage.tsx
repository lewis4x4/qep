/**
 * WAVE phase 2: Thin wrapper for VoiceHistoryPage inside SalesShell at
 * /sales/field-note/history. Same pattern as FieldNotePage.tsx — keep
 * the heavy page where it is, surface it under SalesShell with auth
 * pulled from the hook instead of plumbed as a prop from App.tsx.
 */

import { Navigate } from "react-router-dom";
import { VoiceHistoryPage } from "@/components/VoiceHistoryPage";
import { useAuth } from "@/hooks/useAuth";

export function FieldNoteHistoryPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  const allowedRoles = ["rep", "admin", "manager", "owner"] as const;
  if (!(allowedRoles as readonly string[]).includes(profile.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <VoiceHistoryPage userRole={profile.role} />;
}
