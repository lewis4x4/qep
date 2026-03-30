interface EnvReader {
  get(key: string): string | undefined;
}

export interface CrmHubspotImportEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAnonKey: string;
}

function requireEnv(env: EnvReader, key: string, message?: string): string {
  const value = env.get(key);
  if (!value) {
    throw new Error(message ?? `${key} is required.`);
  }
  return value;
}

export function loadCrmHubspotImportEnv(
  env: EnvReader,
): CrmHubspotImportEnv {
  return {
    supabaseUrl: requireEnv(
      env,
      "SUPABASE_URL",
      "SUPABASE_URL is required for crm-hubspot-import.",
    ),
    supabaseServiceRoleKey: requireEnv(
      env,
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY is required for crm-hubspot-import.",
    ),
    supabaseAnonKey: requireEnv(
      env,
      "SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY is required for caller auth client in crm-hubspot-import.",
    ),
  };
}
