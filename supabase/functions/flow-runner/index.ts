/**
 * QEP Flow Engine — flow-runner edge function (Slice 1)
 *
 * Polls `flow_pending_events` for unprocessed flow events, matches them
 * against enabled `flow_workflow_definitions`, and executes the action
 * chain via the registry. Logs every step to `flow_workflow_run_steps`
 * and dead-letters terminal failures into `exception_queue`.
 *
 * Auth and workspace scoping are enforced in handler.ts.
 */
import { handleFlowRunner } from "./handler.ts";

Deno.serve((req) => handleFlowRunner(req));
