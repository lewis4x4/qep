import { useEffect, useState } from "react";
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

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (session?.user) {
          return fetchProfile(session.user.id)
            .then(({ profile, error }) => {
              setState({ user: session.user, session, profile, loading: false, error });
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : "Failed to load your profile.";
              setState({ user: session.user, session, profile: null, loading: false, error: message });
            });
        } else {
          setState((s) => ({ ...s, loading: false }));
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Authentication service unavailable.";
        setState({ user: null, session: null, profile: null, loading: false, error: message });
      });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (session?.user) {
          const { profile, error } = await fetchProfile(session.user.id);
          setState({ user: session.user, session, profile, loading: false, error });
        } else {
          setState({ user: null, session: null, profile: null, loading: false, error: null });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Authentication state change failed.";
        setState({ user: null, session: null, profile: null, loading: false, error: message });
      }
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
