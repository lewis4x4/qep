import { captureEdgeException } from "../_shared/sentry.ts";
import { handleOnedriveMirrorRequest } from "./handler.ts";

Deno.serve(async (req) => {
  try {
    return await handleOnedriveMirrorRequest(req);
  } catch (error) {
    captureEdgeException(error, { fn: "document-onedrive-mirror", req });
    console.error("[document-onedrive-mirror] unhandled error", error);
    return new Response(
      JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "OneDrive mirror request failed." },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
