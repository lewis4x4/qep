export interface ProfileReadClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/**
 * Uses the caller's JWT client so customer_profiles_extended RLS evaluates the
 * profile against the caller's active workspace before any privileged work.
 */
export async function profileIsVisibleInCallerWorkspace(
  client: ProfileReadClient,
  profileId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("customer_profiles_extended")
    .select("id")
    .eq("id", profileId)
    .maybeSingle();

  return !error && data?.id === profileId;
}
