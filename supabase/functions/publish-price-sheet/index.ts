// deno-lint-ignore-file no-import-prefix no-explicit-any
/**
 * Retired catalog-only publisher.
 *
 * OEM publication must enter through oem-price-feeds/publish so catalog
 * mutations and quote-impact persistence share one PostgreSQL transaction.
 * Keeping this authenticated endpoint as an explicit failure gives old clients
 * a safe migration error instead of silently creating an untracked catalog.
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError } from "../_shared/safe-cors.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const auth = await requireServiceUser(
    req.headers.get("authorization"),
    origin,
  );
  if (!auth.ok) return auth.response;
  if (!["admin", "manager", "owner"].includes(auth.role)) {
    return safeJsonError(
      "Price sheet publish requires admin, manager, or owner role",
      403,
      origin,
    );
  }

  return safeJsonError(
    "Direct catalog-only publication is disabled. Use oem-price-feeds/publish so catalog and quote impacts commit together.",
    409,
    origin,
  );
});
