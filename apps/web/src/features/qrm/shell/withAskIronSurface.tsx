/**
 * withAskIronSurface — renders the AskIronSurface chat when the shell_v2
 * flag is on, and falls back to the legacy OperationsCopilotPage board
 * otherwise. Mirrors withTodaySurface / withGraphExplorer / withPulseSurface
 * so all four surfaces flip on the same flag without branching routing.
 */

import { ReactNode } from "react";
import { FLAGS, isFeatureEnabled } from "@/lib/feature-flags";
import { AskIronSurface } from "../components/AskIronSurface";

interface WithAskIronSurfaceProps {
  /** The legacy page rendered when shell_v2 is off. */
  fallback: ReactNode;
}

export function WithAskIronSurface({ fallback }: WithAskIronSurfaceProps) {
  if (isFeatureEnabled(FLAGS.SHELL_V2)) {
    return <AskIronSurface />;
  }
  return <>{fallback}</>;
}
