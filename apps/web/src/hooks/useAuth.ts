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
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchProfile(session.user.id).then(({ profile, error }) => {
          setState({ user: session.user, session, profile, loading: false, error });
        });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { profile, error } = await fetchProfile(session.user.id);
        setState({ user: session.user, session, profile, loading: false, error });
      } else {
        setState({ user: null, session: null, profile: null, loading: false, error: null });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return state;
}

async function fetchProfile(userId: string): Promise<{ profile: Profile | null; error: string | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Profile fetch error:", error);
    return {
      profile: null,
      error: "Your account was authenticated but your profile could not be loaded. Contact your administrator.",
    };
  }

  return { profile: data, error: null };
}
