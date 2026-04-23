import { createAdminClient } from "../_shared/dge-auth.ts";
import { requireAuthenticatedUser } from "../_shared/service-auth.ts";
import { handleCrmAuthAuditRequest } from "./handler.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const authHeader = req.headers.get("Authorization")?.trim() ?? null;
  const auth = authHeader
    ? await requireAuthenticatedUser(authHeader, req.headers.get("origin"))
    : null;

  return handleCrmAuthAuditRequest(req, {
    admin: createAdminClient(),
    actorUserId: auth?.ok ? auth.userId : null,
  });
});
