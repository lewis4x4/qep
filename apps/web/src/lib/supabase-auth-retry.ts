import type { AuthError } from "@supabase/supabase-js";
import { isTransientAuthRecoveryError } from "./auth-recovery";
import { supabase } from "./supabase";

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function signInWithPasswordWithRetry(params: {
  email: string;
  password: string;
}): Promise<{ error: AuthError | null }> {
  let lastError: AuthError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.auth.signInWithPassword(params);
    if (!error) {
      return { error: null };
    }
    lastError = error;
    const retryable = isTransientAuthRecoveryError(error.message ?? "");
    if (!retryable || attempt === MAX_ATTEMPTS - 1) {
      return { error };
    }
    await sleep(350 * (attempt + 1));
  }
  return { error: lastError };
}

export async function signInWithOtpWithRetry(params: {
  email: string;
  options?: { emailRedirectTo?: string };
}): Promise<{ error: AuthError | null }> {
  let lastError: AuthError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.auth.signInWithOtp(params);
    if (!error) {
      return { error: null };
    }
    lastError = error;
    const retryable = isTransientAuthRecoveryError(error.message ?? "");
    if (!retryable || attempt === MAX_ATTEMPTS - 1) {
      return { error };
    }
    await sleep(350 * (attempt + 1));
  }
  return { error: lastError };
}
