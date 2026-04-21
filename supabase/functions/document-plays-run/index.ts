import { captureEdgeException } from "../_shared/sentry.ts";
import { handleRunRequest } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleRunRequest(req);
  } catch (error) {
    captureEdgeException(error, { fn: "document-plays-run", req });
    console.error("[document-plays-run] unhandled error", error);
    return new Response(
      JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "Document plays run failed." },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
