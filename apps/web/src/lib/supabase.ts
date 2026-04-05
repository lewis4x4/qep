import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

/**
 * Narrow table merges (extensions + generated) still break PostgREST Insert inference for many tables.
 * Prefer `import type { ExtendedDatabase }` / row interfaces at call sites until `database.types.ts` is regenerated from the full schema.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

/** Hostname from VITE_SUPABASE_URL (for operator diagnostics when sign-in fails). */
export function getSupabaseUrlHostname(): string {
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return "(invalid VITE_SUPABASE_URL)";
  }
}
