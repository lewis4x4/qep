import { captureEdgeException } from "../_shared/sentry.ts";
import { handleDocumentTwinRequest } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleDocumentTwinRequest(req);
  } catch (error) {
    captureEdgeException(error, { fn: "document-twin", req });
    console.error("[document-twin] unhandled error", error);
    return new Response(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "Document twin request failed.",
        },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
