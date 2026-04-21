/**
 * withTodaySurface — renders the TodaySurface when the shell_v2 flag is on,
 * and falls back to the legacy today feed otherwise. Mirrors the pattern of
 * withGraphExplorer so both surfaces flip on the same flag.
 */

import { ReactNode } from "react";
import { FLAGS, isFeatureEnabled } from "@/lib/feature-flags";
import { TodaySurface } from "../components/TodaySurface";

interface WithTodaySurfaceProps {
  /** The legacy page rendered when shell_v2 is off. */
  fallback: ReactNode;
}

export function WithTodaySurface({ fallback }: WithTodaySurfaceProps) {
  if (isFeatureEnabled(FLAGS.SHELL_V2)) {
    return <TodaySurface />;
  }
  return <>{fallback}</>;
}
