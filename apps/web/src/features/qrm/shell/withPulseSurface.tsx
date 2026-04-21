/**
 * withPulseSurface — renders the PulseSurface when the shell_v2 flag is on,
 * and falls back to the legacy exceptions page otherwise. Mirrors the
 * withTodaySurface / withGraphExplorer wrappers so all three surfaces flip
 * on the same flag without branching routing logic.
 */

import { ReactNode } from "react";
import { FLAGS, isFeatureEnabled } from "@/lib/feature-flags";
import { PulseSurface } from "../components/PulseSurface";

interface WithPulseSurfaceProps {
  /** The legacy page rendered when shell_v2 is off. */
  fallback: ReactNode;
}

export function WithPulseSurface({ fallback }: WithPulseSurfaceProps) {
  if (isFeatureEnabled(FLAGS.SHELL_V2)) {
    return <PulseSurface />;
  }
  return <>{fallback}</>;
}
