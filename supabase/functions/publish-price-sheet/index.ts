// deno-lint-ignore-file no-import-prefix no-explicit-any
/**
 * Atomic price-sheet catalog publisher.
 *
 * All catalog rows, applied_at stamps, predecessor supersession, and the sheet
 * status transition are owned by one PostgreSQL RPC. Any invalid or failed row
 * aborts the transaction; an approved-but-unapplied row can never become an
 * authoritative OEM diff.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { emitAdminFlare } from "../_shared/admin-flare.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  const body = asObject(await req.json().catch(() => ({})));
  const priceSheetId = typeof body.priceSheetId === "string"
    ? body.priceSheetId
    : null;
  if (!priceSheetId) return safeJsonError("priceSheetId required", 400, origin);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin.rpc("publish_qb_price_sheet_atomic", {
    p_workspace_id: auth.workspaceId,
    p_price_sheet_id: priceSheetId,
    p_actor_id: auth.userId,
    p_auto_approve: body.auto_approve === true,
  });
  if (error) {
    await emitAdminFlare(admin, {
      source: "publish-price-sheet",
      priceSheetId,
      phase: "publish",
      message: error.message,
    });
    const status = error.code === "42501"
      ? 403
      : ["22023", "22P02"].includes(error.code ?? "")
      ? 400
      : ["40001", "55000", "23505", "21000"].includes(error.code ?? "")
      ? 409
      : 500;
    return safeJsonError(
      `Atomic price-sheet publish failed: ${error.message}`,
      status,
      origin,
    );
  }

  const payload = asObject(data);
  if (
    Number(payload.itemsSkipped ?? 0) !== 0 ||
    Number(payload.programsSkipped ?? 0) !== 0
  ) {
    // Defensive contract guard. The SQL publisher never returns partial counts.
    return safeJsonError(
      "Atomic publisher returned a partial result",
      500,
      origin,
    );
  }
  return safeJsonOk(payload, origin);
});
