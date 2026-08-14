/**
 * QEP Moonshot Command Center — exec-summary-generator (Slice 5)
 *
 * Produces a role-specific executive briefing in markdown by reading
 * `analytics_kpi_snapshots` + `analytics_alerts` for the given role and
 * shaping them into a structured "what's good / what needs attention"
 * narrative.
 *
 * v1: deterministic template-driven generation (no LLM call) so the
 *     surface is functional without API costs and LLM upgrade is one
 *     branch swap away.
 * v2: optional LLM rewrite gated on a `mode=ai` query param.
 *
 * Auth:
 *   - JWT must belong to a profile with role in ('admin', 'manager', 'owner')
 *   - Cron callers may pre-warm via x-internal-service-secret
 */
import { handleExecSummaryGenerator } from "./handler.ts";

Deno.serve(handleExecSummaryGenerator);
