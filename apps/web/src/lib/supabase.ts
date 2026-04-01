import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

/** Hostname from VITE_SUPABASE_URL (for operator diagnostics when sign-in fails). */
export function getSupabaseUrlHostname(): string {
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return "(invalid VITE_SUPABASE_URL)";
  }
}
