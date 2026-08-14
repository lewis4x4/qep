import { handleDemoAdminRequest } from "./handler.ts";

const DEMO_ADMIN_SECRET = Deno.env.get("DEMO_ADMIN_SECRET");

Deno.serve((req) =>
  handleDemoAdminRequest(req, {
    demoAdminSecret: DEMO_ADMIN_SECRET,
  })
);
