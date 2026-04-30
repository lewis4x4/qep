/**
 * QRM Command Center — frontend fetch wrapper.
 *
 * Calls the `qrm-command-center` edge function with the caller's session
 * JWT (handled automatically by `supabase.functions.invoke`). Uses the
 * standard POST-body invocation pattern that matches the rest of the
 * codebase (see `exec-summary-generator`, `flow-synthesize`, etc.) —
 * NOT a query-string-in-name hack.
 *
 * The React Query key for this call MUST include `scope` so switching
 * scopes does not return a stale payload from a different scope's cache.
 */

import { supabase } from "@/lib/supabase";
import type {
  CommandCenterResponse,
  CommandCenterScope,
} from "./commandCenter.types";

export async function getCommandCenter(
  scope: CommandCenterScope,
): Promise<CommandCenterResponse> {
  const { data, error } = await supabase.functions.invoke<CommandCenterResponse>(
    "qrm-command-center",
    { body: { scope } },
  );

  if (error) {
    const message = error.message ?? "Failed to load QRM Command Center";
    throw new Error(message);
  }
  if (!data) {
    throw new Error("QRM Command Center returned no data");
  }
  return data;
}
