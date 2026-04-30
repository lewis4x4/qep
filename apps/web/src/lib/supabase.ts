import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

/**
 * The generated schema is current, but the existing app still has legacy JSON casts,
 * nullable view rows, and stale select shapes. Keep the shared client broad until
 * those call sites are migrated slice-by-slice.
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
