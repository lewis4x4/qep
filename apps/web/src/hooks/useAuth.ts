import { useEffect, useRef, useState } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { UserRole } from "../lib/database.types";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    loading: true,
    error: null,
  });

  // Gate onAuthStateChange handler until getSession() resolves. The
  // INITIAL_SESSION event fires before getSession() completes; without this
  // gate the deferred setTimeout(0) handler would set loading=false (no error)
  // before the getSession() handler can detect corrupt tokens and set the
  // session-expired error for the modal.
  const initializedRef = useRef(false);

  // Snapshot token presence during RENDER — not in useEffect. Supabase's
  // createClient() starts async _initialize() → _recoverSession() which
  // reads "garbage" tokens and removes them from localStorage. By the time
  // useEffect fires (post-paint), the cleanup is already done and the token
  // is gone. Capturing here (first render) beats the async cleanup.
  const hadStoredTokenRef = useRef(
    Object.keys(localStorage).some(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
    )
  );

  useEffect(() => {
    const hadStoredToken = hadStoredTokenRef.current;

    // Get initial session
    supabase.auth.getSession()
      .then(async ({ data: { session }, error: sessionReadError }) => {
        if (sessionReadError) {
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
          // Validate the token with the server — getSession() only reads
          // localStorage and does NOT verify the JWT is still valid.
          const { error: userError } = await supabase.auth.getUser();
          if (userError) {
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
              setState({ user: session.user, session, profile, loading: false, error });
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : "Failed to load your profile.";
              setState({ user: session.user, session, profile: null, loading: false, error: message });
            });
        } else {
          // No session — use pre-getSession() snapshot to detect tokens
          // that Supabase silently cleaned up during parsing.
          const stillHasToken = Object.keys(localStorage).some(
            (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
          );
          if (hadStoredToken || stillHasToken) {
            // Clean up any remaining tokens and force signOut so
            // App.tsx onAuthStateChange fires SIGNED_OUT.
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
        const looksAuth =
          lower.includes("auth") ||
          lower.includes("jwt") ||
          lower.includes("token") ||
          lower.includes("session") ||
          lower.includes("json");
        void supabase.auth.signOut();
        const message = looksAuth
          ? "Your session token is invalid or expired. Please sign in again."
          : "We can't reach the authentication service. Try refreshing the page.";
        setState({ user: null, session: null, profile: null, loading: false, error: message });
      })
      .finally(() => {
        initializedRef.current = true;
      });

    // Listen for auth changes. Defer async work off the Supabase auth callback
    // stack — awaiting getUser()/fetchProfile inside the synchronous listener can
    // deadlock the client on hard refresh (INITIAL_SESSION + getSession race).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        // Skip until getSession() initial handler completes — it handles
        // corrupt-token detection and sets the session-expired error.
        if (!initializedRef.current) return;
        void (async () => {
          try {
            if (session?.user) {
              const { error: userError } = await supabase.auth.getUser();
              if (userError) {
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
              setState({ user: session.user, session, profile, loading: false, error });
            } else {
              // Preserve any existing error (e.g. corrupt-token detection) so
              // App.tsx can still trigger SessionExpiredModal.
              setState((prev) => ({
                user: null, session: null, profile: null, loading: false,
                error: prev.error,
              }));
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "We had trouble updating your session. Refresh the page or sign in again.";
            setState({ user: null, session: null, profile: null, loading: false, error: message });
          }
        })();
      }, 0);
    });

    return () => subscription.unsubscribe();
  }, []);

  return state;
}

async function fetchProfile(userId: string): Promise<{ profile: Profile | null; error: string | null }> {
  const profileFetch = supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", userId)
    .single();

  // Guard against the query hanging indefinitely (e.g. RLS stall on fresh session
  // after page reload before the JWT is fully propagated to PostgREST).
  const timeoutMs = 5000;
  let result: Awaited<typeof profileFetch>;
  try {
    result = await Promise.race([
      profileFetch,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Profile load timed out")), timeoutMs)
      ),
    ]);
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
