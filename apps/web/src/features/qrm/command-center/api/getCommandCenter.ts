/**
 * QRM Command Center — frontend fetch wrapper.
 *
 * Calls the `qrm-command-center` edge function with the caller's session
 * JWT (handled automatically by `supabase.functions.invoke`). The query key
 * for React Query MUST include `scope` so switching scopes does not return
 * a stale payload from a different scope's cache.
 */

import { supabase } from "@/lib/supabase";
import type {
  CommandCenterResponse,
  CommandCenterScope,
} from "./commandCenter.types";

interface InvokeResult {
  data: CommandCenterResponse | null;
  error: { message?: string } | null;
}

export async function getCommandCenter(scope: CommandCenterScope): Promise<CommandCenterResponse> {
  const { data, error } = await (
    supabase.functions as unknown as {
      invoke: (
        name: string,
        opts: { method: "GET" | "POST"; body?: Record<string, unknown> },
      ) => Promise<InvokeResult>;
    }
  ).invoke(`qrm-command-center?scope=${encodeURIComponent(scope)}`, {
    method: "GET",
  });

  if (error) {
    const message = error.message ?? "Failed to load QRM Command Center";
    throw new Error(message);
  }
  if (!data) {
    throw new Error("QRM Command Center returned no data");
  }
  return data;
}
