/**
 * withGraphExplorer — renders the GraphExplorer when the shell_v2 flag is on,
 * and falls back to the legacy list page otherwise. Keeps routing untouched
 * so the feature flag can be flipped per-user without code changes.
 *
 * Each wrapper sets `defaultLens` so the chip row lands on the right entity
 * when the operator arrives at /qrm/contacts vs /qrm/companies vs /qrm/deals.
 */

import { ReactNode } from "react";
import { FLAGS, isFeatureEnabled } from "@/lib/feature-flags";
import { GraphExplorer } from "../components/GraphExplorer";
import type { QrmSearchEntityType } from "../lib/types";

interface WithGraphExplorerProps {
  defaultLens?: "all" | QrmSearchEntityType;
  title?: string;
  subtitle?: string;
  /** The legacy page rendered when shell_v2 is off. */
  fallback: ReactNode;
}

export function WithGraphExplorer({
  defaultLens,
  title,
  subtitle,
  fallback,
}: WithGraphExplorerProps) {
  if (isFeatureEnabled(FLAGS.SHELL_V2)) {
    return <GraphExplorer defaultLens={defaultLens} title={title} subtitle={subtitle} />;
  }
  return <>{fallback}</>;
}
