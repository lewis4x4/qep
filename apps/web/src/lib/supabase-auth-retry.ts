import type { AuthError } from "@supabase/supabase-js";
import { isTransientAuthRecoveryError } from "./auth-recovery";
import { supabase } from "./supabase";

const MAX_ATTEMPTS = 3;
/**
 * Wall-clock ceiling on any single sign-in attempt. Supabase's
 * /auth/v1/token endpoint usually answers in well under a second; 12s
 * covers a very slow connection without stranding the rep on a
 * "Signing In…" button when the network stalls silently (Safari in
 * particular drops some fetches without ever rejecting).
 */
const AUTH_ATTEMPT_TIMEOUT_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Lightweight AuthError shape — supabase-js's AuthError is a class we can't
 * cheaply construct, so we return a duck-typed object whose `message` +
 * `name` fields are what every caller actually reads.
 */
function buildTimeoutAuthError(): AuthError {
  const err = new Error(
    "We couldn't reach the authentication service. Check your connection and try again.",
  ) as AuthError & { name: string; status: number };
  err.name = "AuthRetryableFetchError";
  err.status = 408;
  return err;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("auth attempt timed out"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Clear any half-loaded sb-*-auth-token row from localStorage before the
 * sign-in call. Occasionally supabase-js gets wedged mid-refresh on a
 * corrupt or algo-mismatched token and signInWithPassword never resolves;
 * flushing storage first breaks the deadlock without forcing a signOut
 * round-trip. Called on first attempt only — subsequent retries don't
 * need to re-flush.
 */
function flushStaleAuthTokens(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // Private mode / quota — ignore; the sign-in attempt can still proceed.
  }
}

export async function signInWithPasswordWithRetry(params: {
  email: string;
  password: string;
}): Promise<{ error: AuthError | null }> {
  let lastError: AuthError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt === 0) flushStaleAuthTokens();
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword(params),
        AUTH_ATTEMPT_TIMEOUT_MS,
      );
      if (!error) {
        return { error: null };
      }
      lastError = error;
      const retryable = isTransientAuthRecoveryError(error.message ?? "");
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        return { error };
      }
    } catch (thrown) {
      // Either our own timeout or a thrown network error. Treat both as
      // retryable until we've exhausted attempts, then surface a clear
      // "couldn't reach auth" error rather than leaving the UI hanging.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          return { error: null };
        }
      } catch {
        // Ignore follow-up session probe failures; the retry path below
        // will surface the original timeout state.
      }
      lastError = buildTimeoutAuthError();
      if (attempt === MAX_ATTEMPTS - 1) {
        return { error: lastError };
      }
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
    if (attempt === 0) flushStaleAuthTokens();
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithOtp(params),
        AUTH_ATTEMPT_TIMEOUT_MS,
      );
      if (!error) {
        return { error: null };
      }
      lastError = error;
      const retryable = isTransientAuthRecoveryError(error.message ?? "");
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        return { error };
      }
    } catch (thrown) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          return { error: null };
        }
      } catch {
        // Ignore follow-up session probe failures; the retry path below
        // will surface the original timeout state.
      }
      lastError = buildTimeoutAuthError();
      if (attempt === MAX_ATTEMPTS - 1) {
        return { error: lastError };
      }
    }
    await sleep(350 * (attempt + 1));
  }
  return { error: lastError };
}
