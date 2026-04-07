import { useEffect, useRef, useState } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { UserRole } from "../lib/database.types";
import {
  isTransientAuthRecoveryError,
  messageSuggestsCorruptLocalAuthStorage,
  readCachedProfile,
  writeCachedProfile,
} from "../lib/auth-recovery";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  iron_role: string | null;
  iron_role_display: string | null;
  is_support: boolean;
  active_workspace_id: string;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
}

const AUTH_REQUEST_TIMEOUT_MS = 8000;
const AUTH_TIMEOUT_RETRIES = 2;
const PROFILE_REQUEST_TIMEOUT_MS = 2500;
const PROFILE_TIMEOUT_RETRIES = 1;

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    loading: true,
    error: null,
  });

  const initializedRef = useRef(false);

  const hadStoredTokenRef = useRef(
    Object.keys(localStorage).some(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
    )
  );

  useEffect(() => {
    const hadStoredToken = hadStoredTokenRef.current;

    function hasStoredSupabaseToken(): boolean {
      return Object.keys(localStorage).some(
        (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
      );
    }

    // Only Supabase token keys count: stale sessionStorage profile cache after
    // logout must not force the outage banner on anonymous bootstrap.
    function hasRecoverableClientState(): boolean {
      return hadStoredToken || hasStoredSupabaseToken();
    }

    function applyProfileState(session: Session, profile: Profile | null, error: string | null): void {
      if (profile) {
        writeCachedProfile(profile);
      }
      setState({ user: session.user, session, profile, loading: false, error });
    }

    function applyCachedProfileIfAvailable(session: Session): boolean {
      const cachedProfile = readCachedProfile(session.user.id);
      if (!cachedProfile) {
        return false;
      }
      setState({ user: session.user, session, profile: cachedProfile, loading: false, error: null });
      return true;
    }

    // Get initial session
    withTimeoutRetries(
      () => supabase.auth.getSession(),
      AUTH_REQUEST_TIMEOUT_MS,
      "Initial auth session load timed out",
      AUTH_TIMEOUT_RETRIES,
    )
      .then(async ({ data: { session }, error: sessionReadError }) => {
        if (sessionReadError) {
          const readMsg = sessionReadError.message ?? "";
          if (isTransientAuthRecoveryError(readMsg)) {
            await supabase.auth.signOut();
            setState({ user: null, session: null, profile: null, loading: false, error: null });
            return;
          }
          await supabase.auth.signOut();
          setState({
            user: null,
            session: null,
            profile: null,
            loading: false,
            error:
              "Your session token is invalid or expired. Please sign in again.",
          });
          return;
        }
        if (session?.user) {
          applyCachedProfileIfAvailable(session);
          // Validate the token with the server when possible, but do not throw
          // away a freshly recovered local session on a transient network miss.
          const sessionValidation = await validateSessionToken();
          if (sessionValidation === "expired") {
            // Token is stale/invalid — sign out to clear storage and
            // surface an expiry error so App.tsx shows SessionExpiredModal.
            await supabase.auth.signOut();
            setState({
              user: null, session: null, profile: null, loading: false,
              error: "Your session token is invalid or expired. Please sign in again.",
            });
            return;
          }

          return fetchProfile(session.user.id)
            .then(({ profile, error }) => {
              if (!profile && error && applyCachedProfileIfAvailable(session)) {
                return;
              }
              applyProfileState(session, profile, error);
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : "Failed to load your profile.";
              if (applyCachedProfileIfAvailable(session)) {
                return;
              }
              applyProfileState(session, null, message);
            });
        } else {
          // No session — use pre-getSession() snapshot to detect tokens
          // that Supabase silently cleaned up during parsing.
          const stillHasToken = hasStoredSupabaseToken();
          if (hadStoredToken || stillHasToken) {
            Object.keys(localStorage)
              .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
              .forEach((k) => localStorage.removeItem(k));
            await supabase.auth.signOut();
            setState({
              user: null, session: null, profile: null, loading: false,
              error: "Your session token is invalid or expired. Please sign in again.",
            });
          } else {
            setState((s) => ({ ...s, loading: false }));
          }
        }
      })
      .catch((err: unknown) => {
        const raw = err instanceof Error ? err.message : String(err);
        const lower = raw.toLowerCase();
        const timedOut =
          raw === "Initial auth session load timed out" ||
          raw === "Auth token validation timed out";
        const transientAuthFailure = isTransientAuthRecoveryError(raw);
        const looksAuth =
          lower.includes("auth") ||
          lower.includes("jwt") ||
          lower.includes("token") ||
          lower.includes("session") ||
          messageSuggestsCorruptLocalAuthStorage(raw);
        const shouldSilenceAnonymousBootstrapError =
          !hasRecoverableClientState() && (timedOut || transientAuthFailure || !looksAuth);
        if (shouldSilenceAnonymousBootstrapError) {
          setState({ user: null, session: null, profile: null, loading: false, error: null });
          return;
        }
        // Stale local token + network blip (e.g. Safari "Load failed"): never imply auth is down.
        if (transientAuthFailure) {
          void supabase.auth.signOut();
          setState({ user: null, session: null, profile: null, loading: false, error: null });
          return;
        }
        if (looksAuth && !timedOut && !transientAuthFailure) {
          void supabase.auth.signOut();
        }
        const message = looksAuth && !timedOut
          ? "Your session token is invalid or expired. Please sign in again."
          : "We can't reach the authentication service. Try refreshing the page.";
        setState({ user: null, session: null, profile: null, loading: false, error: message });
      })
      .finally(() => {
        initializedRef.current = true;
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        if (!initializedRef.current) return;
        void (async () => {
          try {
            if (session?.user) {
              applyCachedProfileIfAvailable(session);
              const sessionValidation = await validateSessionToken();
              if (sessionValidation === "expired") {
                await supabase.auth.signOut();
                setState({
                  user: null,
                  session: null,
                  profile: null,
                  loading: false,
                  error:
                    "Your session token is invalid or expired. Please sign in again.",
                });
                return;
              }
              const { profile, error } = await fetchProfile(session.user.id);
              if (!profile && error && applyCachedProfileIfAvailable(session)) {
                return;
              }
              applyProfileState(session, profile, error);
            } else {
              setState((prev) => ({
                user: null, session: null, profile: null, loading: false,
                error: prev.error,
              }));
            }
          } catch (err: unknown) {
            const raw = err instanceof Error
              ? err.message
              : "We had trouble updating your session. Refresh the page or sign in again.";
            const transientAuthFailure = isTransientAuthRecoveryError(raw);
            const message = raw === "Auth token validation timed out"
              ? "We can't reach the authentication service. Try refreshing the page."
              : raw;
            setState((prev) => {
              const shouldSilenceAnonymousBootstrapError =
                !hasRecoverableClientState() &&
                !prev.user &&
                !prev.session &&
                !prev.profile &&
                (raw === "Auth token validation timed out" || transientAuthFailure);
              return {
                user: prev.user,
                session: prev.session,
                profile: prev.profile,
                loading: false,
                error: shouldSilenceAnonymousBootstrapError ? null : message,
              };
            });
          }
        })();
      }, 0);
    });

    return () => subscription.unsubscribe();
  }, []);

  return state;
}

async function fetchProfile(userId: string): Promise<{ profile: Profile | null; error: string | null }> {
  // Guard against the query hanging indefinitely (e.g. RLS stall on fresh session
  // after page reload before the JWT is fully propagated to PostgREST).
  let result: { data: Profile | null; error: { message?: string } | null };
  try {
    result = await withTimeoutRetries(
      () => Promise.resolve(
        supabase
          .from("profiles")
          .select("id, full_name, email, role, iron_role, iron_role_display, is_support, active_workspace_id")
          .eq("id", userId)
          .single()
      ),
      PROFILE_REQUEST_TIMEOUT_MS,
      "Profile load timed out",
      PROFILE_TIMEOUT_RETRIES,
    );
  } catch (err) {
    const timedOut = err instanceof Error && err.message === "Profile load timed out";
    console.error("Profile fetch error:", err);
    return {
      profile: null,
      error: timedOut
        ? "Session could not be verified. Please sign in again."
        : "Your account was authenticated but your profile could not be loaded. Contact your administrator.",
    };
  }

  const { data, error } = result;

  if (error) {
    console.error("Profile fetch error:", error);
    return {
      profile: null,
      error: "Your account was authenticated but your profile could not be loaded. Contact your administrator.",
    };
  }

  return { profile: data, error: null };
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function withTimeoutRetries<T>(
  factory: () => PromiseLike<T>,
  timeoutMs: number,
  message: string,
  retries: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(factory(), timeoutMs, message);
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || error.message !== message || attempt === retries) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(message);
}

type SessionValidationResult = "valid" | "expired" | "unreachable";

async function validateSessionToken(): Promise<SessionValidationResult> {
  try {
    const { error } = await withTimeoutRetries(
      () => supabase.auth.getUser(),
      AUTH_REQUEST_TIMEOUT_MS,
      "Auth token validation timed out",
      AUTH_TIMEOUT_RETRIES,
    );
    if (!error) {
      return "valid";
    }

    if (isTransientAuthRecoveryError(error.message)) {
      return "unreachable";
    }
    return isAuthValidationFailure(error.message) ? "expired" : "unreachable";
  } catch (error) {
    if (error instanceof Error && isTransientAuthRecoveryError(error.message)) {
      return "unreachable";
    }
    if (error instanceof Error && isAuthValidationFailure(error.message)) {
      return "expired";
    }

    return "unreachable";
  }
}

function isAuthValidationFailure(message: string): boolean {
  return /auth|jwt|token|session|expired|refresh token|invalid/i.test(message);
}
