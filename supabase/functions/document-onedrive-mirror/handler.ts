/**
 * document-onedrive-mirror
 *
 * Slice VIII substrate: a zero-blocking OneDrive adapter whose sole job
 * today is to surface integration health honestly. When OAuth + Graph
 * API calls ship in a follow-up pass, this same function extends with a
 * POST /sync that walks the mirrored folder tree and upserts
 * document_folders (source_type='onedrive_mirror') + documents
 * (external_source_id = tenant_id:drive_id:item_id).
 *
 * The /health endpoint is the zero-blocking primitive: it returns one
 * of four tiers the UI + Exception Inbox can consume without caring
 * about the implementation:
 *
 *   "live"         — token usable, Graph API reachable, last sync recent
 *   "demo"         — no token configured, but the workspace has opted in
 *                    for a mirror and we're in demo/fixture mode
 *   "manual-safe"  — token expired or Graph unreachable; uploads keep
 *                    flowing through native upload paths
 *   "unconfigured" — no mirror configured for this workspace (default)
 *
 * Per CLAUDE.md: missing external credentials must fall back safely and
 * keep workflows usable. This function ships the health tier first so
 * the Integration Hub and Document Center can render an honest banner
 * from day one; the actual sync lands later without breaking the shape.
 */

import {
  crmFail,
  crmOk,
  crmOptionsResponse,
  safeText,
} from "../_shared/crm-router-http.ts";
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";

export type MirrorHealthTier = "live" | "demo" | "manual-safe" | "unconfigured";

export interface MirrorHealthResult {
  workspaceId: string | null;
  tier: MirrorHealthTier;
  reason: string;
  tokenConfigured: boolean;
  mirrorConfigured: boolean;
  lastSyncAt: string | null;
  checkedAt: string;
}

function normalizePath(pathname: string): string {
  if (pathname.startsWith("/document-onedrive-mirror")) {
    return pathname.slice("/document-onedrive-mirror".length) || "/";
  }
  return pathname;
}

function mapError(origin: string | null, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "UNAUTHORIZED") {
    return crmFail({ origin, status: 401, code: "UNAUTHORIZED", message: "Missing auth." });
  }
  if (message === "FORBIDDEN") {
    return crmFail({ origin, status: 403, code: "FORBIDDEN", message: "Caller not authorized." });
  }
  return crmFail({
    origin,
    status: 500,
    code: "INTERNAL_ERROR",
    message: "OneDrive mirror request failed.",
    details: message.length > 0 ? message.slice(0, 500) : undefined,
  });
}

export async function handleOnedriveMirrorRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return crmOptionsResponse(origin);

  try {
    const url = new URL(req.url);
    const path = normalizePath(url.pathname);

    const admin = createAdminClient();
    const caller = await resolveCallerContext(req, admin);
    const isServiceRole = caller.isServiceRole;
    const isAdminCaller =
      !!caller.userId && ["admin", "manager", "owner"].includes(caller.role ?? "");

    if (!isServiceRole && !isAdminCaller) {
      throw new Error(caller.userId ? "FORBIDDEN" : "UNAUTHORIZED");
    }

    if (req.method === "GET" && (path === "/health" || path === "/" || path === "")) {
      const workspaceId = safeText(url.searchParams.get("workspace_id")) ?? caller.workspaceId;

      // Health probe reads hub_knowledge_source (the actual mirror ledger
      // in this repo). Any row with drive_file_id set counts as a
      // mirrored item; MAX(synced_at) is our freshness signal. Token
      // presence is inferred from recency — a sync in the last 24h
      // implies a usable token at sync time. When the real OneDrive
      // OAuth adapter ships, it writes a dedicated config row we can
      // read directly for tokenConfigured.
      let mirrorConfigured = false;
      let tokenConfigured = false;
      let lastSyncAt: string | null = null;
      let reason = "no mirror configured for this workspace";

      if (workspaceId) {
        const { data: sourceRows } = await admin
          .from("hub_knowledge_source")
          .select("id, drive_file_id, synced_at")
          .eq("workspace_id", workspaceId)
          .not("drive_file_id", "is", null)
          .is("deleted_at", null)
          .order("synced_at", { ascending: false, nullsFirst: false })
          .limit(1);
        const top = ((sourceRows ?? []) as Array<{ synced_at: string | null }>)[0];
        if (top) {
          mirrorConfigured = true;
          lastSyncAt = top.synced_at ?? null;
          const staleMs = lastSyncAt ? Date.now() - new Date(lastSyncAt).getTime() : Number.POSITIVE_INFINITY;
          tokenConfigured = staleMs < 24 * 60 * 60 * 1000;
          reason = tokenConfigured
            ? "mirror live; synced within 24h"
            : "mirror configured but last sync stale (manual-safe)";
        }
      }

      let tier: MirrorHealthTier;
      if (!mirrorConfigured) tier = "unconfigured";
      else if (!tokenConfigured) tier = "manual-safe";
      else if (!lastSyncAt) tier = "demo";
      else {
        const staleMs = Date.now() - new Date(lastSyncAt).getTime();
        tier = staleMs > 24 * 60 * 60 * 1000 ? "manual-safe" : "live";
        if (tier === "manual-safe") reason = "last sync >24h ago";
      }

      const result: MirrorHealthResult = {
        workspaceId,
        tier,
        reason,
        tokenConfigured,
        mirrorConfigured,
        lastSyncAt,
        checkedAt: new Date().toISOString(),
      };
      return crmOk(result, { origin });
    }

    if (req.method === "POST" && path === "/sync") {
      // Intentional placeholder. The real sync lands in a follow-up slice
      // once OneDrive OAuth + delta-query plumbing is in place. Returning
      // 501 here is the honest answer — the surface exists; the guts do
      // not. The Integration Hub renders the response code to the user.
      return crmFail({
        origin,
        status: 501,
        code: "NOT_IMPLEMENTED",
        message:
          "OneDrive sync is not yet implemented. Health endpoint /health is active; native uploads continue to work (zero-blocking).",
      });
    }

    return crmFail({
      origin,
      status: 404,
      code: "NOT_FOUND",
      message: "Unknown document-onedrive-mirror resource.",
    });
  } catch (error) {
    return mapError(origin, error);
  }
}
