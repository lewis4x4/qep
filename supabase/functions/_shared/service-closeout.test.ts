const closeoutSource = await Deno.readTextFile(
  new URL("./service-closeout.ts", import.meta.url),
);
const routerSource = await Deno.readTextFile(
  new URL("../service-job-router/index.ts", import.meta.url),
);
const assemblerSource = await Deno.readTextFile(
  new URL("./service-warranty-assembler.ts", import.meta.url),
);

Deno.test("service closeout finalizes pending invoices to sent", () => {
  for (
    const expected of [
      "finalizeServiceInvoiceForJob",
      'update({ status: "sent" })',
      '.eq("status", "pending")',
      "generateInvoiceForServiceJob",
    ]
  ) {
    if (!closeoutSource.includes(expected)) {
      throw new Error(`Expected service-closeout.ts to include ${expected}`);
    }
  }
});

Deno.test("service closeout syncs AR when invoice exists on invoiced and paid_closed", () => {
  for (
    const expected of [
      "syncArOpenItemForInvoice",
      "finalize.invoice_id",
      "service_sync_ar_open_item_for_invoice",
      '"invoiced"',
      '"paid_closed"',
    ]
  ) {
    if (!closeoutSource.includes(expected)) {
      throw new Error(`Expected service-closeout.ts to include ${expected}`);
    }
  }
  if (
    !closeoutSource.includes("if (finalize.invoice_id)") ||
    closeoutSource.indexOf("if (finalize.invoice_id)") >
      closeoutSource.indexOf('params.stage === "paid_closed"')
  ) {
    throw new Error(
      "Expected AR sync from finalize.invoice_id before paid_closed-only warranty block",
    );
  }
});

Deno.test("service closeout queues warranty only on paid_closed", () => {
  for (
    const expected of [
      'params.stage === "paid_closed"',
      "jobHasWarrantyClaimLines",
      "assembleWarrantyClaimForJob",
      "autoQueued: true",
      "service_closeout",
    ]
  ) {
    if (!closeoutSource.includes(expected)) {
      throw new Error(`Expected service-closeout.ts to include ${expected}`);
    }
  }
});

Deno.test("service-job-router wires closeout on invoiced and paid_closed", () => {
  for (
    const expected of [
      "import { executeServiceJobCloseout }",
      'to_stage === "invoiced" || to_stage === "paid_closed"',
      "executeServiceJobCloseout(supabase",
      "closeout: closeoutResult",
    ]
  ) {
    if (!routerSource.includes(expected)) {
      throw new Error(`Expected service-job-router to include ${expected}`);
    }
  }
});

Deno.test("warranty assembler auto-queues draft claims on close", () => {
  for (
    const expected of [
      "jobHasWarrantyClaimLines",
      "assembleWarrantyClaimForJob",
      "auto_queued_on_close",
      "h8_warranty_claim_auto_queued",
      'status: "draft"',
    ]
  ) {
    if (!assemblerSource.includes(expected)) {
      throw new Error(`Expected service-warranty-assembler.ts to include ${expected}`);
    }
  }
});
