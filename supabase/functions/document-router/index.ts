import { captureEdgeException } from "../_shared/sentry.ts";
import { handleDocumentRouterRequest } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleDocumentRouterRequest(req);
  } catch (error) {
    captureEdgeException(error, { fn: "document-router", req });
    console.error("[document-router] unhandled error", error);
    return new Response(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "Document router request failed.",
        },
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
});
