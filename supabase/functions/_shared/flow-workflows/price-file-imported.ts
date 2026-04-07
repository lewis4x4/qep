/**
 * Flagship workflow: price_file.imported → identify affected quotes,
 * notify reps, draft requote suggestions.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const priceFileImported: FlowWorkflowDefinition = {
  slug: "price-file-imported-affected-quotes",
  name: "Price file imported → affected quote analysis",
  description:
    "When a price file is imported, scan open quotes for affected line items and queue requote tasks for the assigned reps.",
  owner_role: "sales",
  trigger_event_pattern: "price_file.imported",
  conditions: [],
  actions: [
    {
      action_key: "create_audit_event",
      params: {
        tag: "price_file_import_processed",
        metadata: {
          file_id: "${event.payload.file_id}",
          rows_imported: "${event.payload.rows_imported}",
        },
      },
    },
    {
      action_key: "create_exception",
      params: {
        source: "price_unmatched",
        title: "Price file imported — review affected quotes",
        severity: "info",
        detail: "${event.payload.rows_imported} rows imported. Review the impact report and trigger requotes where applicable.",
      },
    },
  ],
  affects_modules: ["quotes", "qrm"],
};
