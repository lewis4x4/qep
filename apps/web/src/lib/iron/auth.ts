import { supabase } from "@/lib/supabase";

interface IronAuthClient {
  auth: {
    getSession: () => Promise<{
      data: { session: { access_token?: string | null; expires_at?: number | null } | null };
      error: { message?: string } | null;
    }>;
    refreshSession: () => Promise<{
      data: { session: { access_token?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
}

export async function requireIronAccessToken(options: {
  forceRefresh?: boolean;
} = {}): Promise<string> {
  const sb = supabase as unknown as IronAuthClient;
  const { data, error } = await sb.auth.getSession();
  if (error) {
    throw new Error(`Iron auth: ${error.message ?? "session lookup failed"}`);
  }
  const session = data?.session;
  if (!session?.access_token) {
    throw new Error("Iron: not signed in. Please reload the page and sign in again.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  const shouldRefresh = options.forceRefresh === true || (expiresAt && expiresAt < nowSeconds + 30);
  if (shouldRefresh) {
    const { data: refreshed, error: refreshError } = await sb.auth.refreshSession();
    if (refreshError || !refreshed?.session?.access_token) {
      throw new Error("Iron: session expired and refresh failed. Please reload the page and sign in again.");
    }
    return refreshed.session.access_token;
  }

  return session.access_token;
}
