-- Fix: chat_conversations.user_id has no default, causing inserts from the
-- frontend (via PostgREST) to fail with NOT NULL violation.
-- auth.uid() is available as a column default in PostgREST contexts.

alter table public.chat_conversations
  alter column user_id set default auth.uid();
