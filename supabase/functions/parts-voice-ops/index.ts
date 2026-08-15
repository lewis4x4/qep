/**
 * Parts Voice Ops — Slice 3.2 (Voice-First Counter Operations).
 *
 * Rep at the counter says something like:
 *   "price on 129150"
 *   "add 10 Yanmar oil filters to Thursday's order"
 *   "who ordered this last, the Johnson account?"
 *
 * Browser transcribes via Web Speech API (free, no network hop for STT),
 * posts the transcript here. Claude Sonnet 4.6 classifies intent + calls
 * one or more tools, we execute them against the real catalog/queue/orders,
 * and return a spoken response + structured data for the UI.
 *
 * Tools (Claude decides which to invoke):
 *   1. lookup_part_semantic  — wraps match_parts_hybrid (Slice 3.1)
 *   2. check_part_stock      — exact part_number → catalog row
 *   3. add_to_replenish_queue — draft PO (Slice 2.7 queue)
 *   4. recent_orders_for_part — last N orders of this part (optional customer filter)
 *
 * Auth: admin/manager/owner/rep. Voice is a rep-facing feature.
 */

import { handlePartsVoiceOps } from "./handler.ts";

Deno.serve((req) => handlePartsVoiceOps(req));
