import { createClient } from "@supabase/supabase-js";
import type { ExtendedDatabase } from "./database-extensions.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

// Uses ExtendedDatabase which includes all tables from migrations 068-091.
// After running `supabase gen types`, switch back to Database and delete database-extensions.types.ts.
export const supabase = createClient<ExtendedDatabase>(supabaseUrl, supabaseAnonKey);

/** Hostname from VITE_SUPABASE_URL (for operator diagnostics when sign-in fails). */
export function getSupabaseUrlHostname(): string {
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return "(invalid VITE_SUPABASE_URL)";
  }
}
