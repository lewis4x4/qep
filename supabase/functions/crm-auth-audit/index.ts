import { createAdminClient, createCallerClient } from "../_shared/dge-auth.ts";
import { handleCrmAuthAuditRequest } from "./handler.ts";

async function resolveActorUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader) {
    return null;
  }

  const caller = createCallerClient(authHeader);
  const { data, error } = await caller.auth.getUser();
  if (error) {
    console.error("[crm-auth-audit] auth resolution failed", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return data.user?.id ?? null;
}

Deno.serve(async (req: Request): Promise<Response> =>
  handleCrmAuthAuditRequest(req, {
    admin: createAdminClient(),
    resolveActorUserId,
  })
);
