/**
 * QRM Reminder Dispatcher Edge Function (Tier 4 rename — Phase 2)
 *
 * New canonical name for crm-reminder-dispatcher. Re-imports the same
 * handler. Existing cron schedules continue to fire against the legacy
 * URL until they are reconfigured.
 */
import "../crm-reminder-dispatcher/index.ts";
