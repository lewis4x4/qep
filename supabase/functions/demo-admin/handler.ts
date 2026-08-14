import { captureEdgeException } from "../_shared/sentry.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

export const LIVE_DISABLED_SEED_MESSAGE =
  "Demo seeding is disabled for live environments. Use imported source data only.";
export const LIVE_DISABLED_RESET_MESSAGE =
  "Demo reset is disabled for live environments. Use imported source data only.";

type RequestBody = {
  action?: "seed" | "reset";
};

export type DemoAdminHandlerDeps = {
  demoAdminSecret: string | undefined;
  captureException?: (error: unknown, context: Record<string, unknown>) => void;
};

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-demo-admin-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(payload: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return JSON.stringify({
      message: record.message ?? null,
      details: record.details ?? null,
      hint: record.hint ?? null,
      code: record.code ?? null,
    });
  }
  return String(error);
}

export async function handleDemoAdminRequest(
  req: Request,
  deps: DemoAdminHandlerDeps,
): Promise<Response> {
  const ch = corsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, ch);
  }

  if (!deps.demoAdminSecret) {
    return jsonResponse({ error: "DEMO_ADMIN_SECRET is not configured." }, 500, ch);
  }

  const providedSecret = req.headers.get("x-demo-admin-secret");
  if (!providedSecret || providedSecret !== deps.demoAdminSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401, ch);
  }

  try {
    const body = await req.json() as RequestBody;
    const action = body.action ?? "seed";

    if (action !== "seed" && action !== "reset") {
      return jsonResponse({ error: "Unsupported action" }, 400, ch);
    }

    if (action === "seed") {
      return jsonResponse({ error: LIVE_DISABLED_SEED_MESSAGE }, 410, ch);
    }

    return jsonResponse({ error: LIVE_DISABLED_RESET_MESSAGE }, 410, ch);
  } catch (error) {
    (deps.captureException ?? captureEdgeException)(error, { fn: "demo-admin", req });
    console.error("[demo-admin] failed:", error);
    return jsonResponse(
      { error: describeError(error) },
      500,
      ch,
    );
  }
}
