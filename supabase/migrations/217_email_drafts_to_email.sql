-- Migration 217: Add to_email column to email_drafts for direct sending.
--
-- Go-live blocker: the draft inbox needs a normalized recipient email
-- to enable one-click sending via Resend. Currently the recipient is
-- buried in the context JSON and not queryable.

ALTER TABLE public.email_drafts
  ADD COLUMN IF NOT EXISTS to_email text;

-- Backfill from context JSON where possible
UPDATE public.email_drafts
SET to_email = context->>'recipient_email'
WHERE to_email IS NULL
  AND context->>'recipient_email' IS NOT NULL;

-- Index for filtering drafts by recipient
CREATE INDEX IF NOT EXISTS idx_email_drafts_to_email
  ON public.email_drafts (to_email)
  WHERE to_email IS NOT NULL;

COMMENT ON COLUMN public.email_drafts.to_email IS
  'Recipient email address for direct sending via Resend. Populated at draft creation from contact lookup.';
