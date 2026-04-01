-- Server-side chat conversation history
-- Replaces localStorage-only persistence with a real DB-backed conversation store.

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id text not null default 'default',
  title text not null default 'New conversation',
  context jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_conversations enable row level security;

create policy "chat_conversations_own" on public.chat_conversations
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "chat_conversations_service" on public.chat_conversations
  for all using (auth.role() = 'service_role');

-- Managers/owners can view their team's conversations for coaching
create policy "chat_conversations_elevated_select" on public.chat_conversations
  for select using (public.get_my_role() in ('manager', 'owner'));

create index idx_chat_conversations_user on public.chat_conversations(user_id, updated_at desc);

create trigger set_chat_conversations_updated_at
  before update on public.chat_conversations
  for each row execute function public.set_updated_at();

-- Individual messages within a conversation
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  trace_id text,
  feedback text check (feedback is null or feedback in ('up', 'down')),
  feedback_comment text,
  retrieval_meta jsonb,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

create policy "chat_messages_own" on public.chat_messages
  for all using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id
      and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id
      and c.user_id = auth.uid()
    )
  );

create policy "chat_messages_service" on public.chat_messages
  for all using (auth.role() = 'service_role');

create policy "chat_messages_elevated_select" on public.chat_messages
  for select using (public.get_my_role() in ('manager', 'owner'));

create index idx_chat_messages_conversation on public.chat_messages(conversation_id, created_at asc);
create index idx_chat_messages_feedback on public.chat_messages(feedback)
  where feedback is not null;
