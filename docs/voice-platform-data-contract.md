# Voice Platform Data Contract

Status: Phase 2 approval artifact
Scope: Unified voice platform schema and UI data contract for Voice Quote, Field Note, Quote Builder voice input, and future voice modes.
Rule: This document defines the contract only. It does not authorize migrations, edge functions, frontend components, route changes, or endpoint removal.

## Phase 1 Repo Audit Decisions

- Tenancy uses `workspace_id text`, `profiles.active_workspace_id`, and `public.get_my_workspace()`. This contract uses `workspace_id`; it does not introduce `tenant_id uuid`.
- Field Note data currently lives in `public.voice_captures`. No `field_notes` table was found. Field Note migration work must preserve `voice_captures` for at least one release.
- Customer resolution uses `public.crm_companies` and `public.crm_contacts`, not a generic `customers` table.
- Voice Quote equipment scenarios should resolve against `public.qb_equipment_models`, with `machine_display` as the fallback label.
- `public.quote_packages.originating_log_id` remains historical telemetry. `voice_session_id` becomes the first-class platform link.
- Current voice infrastructure is split across `voice-to-qrm`, `qb-ai-scenarios`, `voice-capture`, and `voice-capture-sync`; consolidation is a Phase 3 backend decision.

## Canonical Tables

### `public.voice_sessions`

Primary record for every voice interaction in the app.

```sql
create table public.voice_sessions (
  id uuid primary key default gen_random_uuid(),

  workspace_id text not null default public.get_my_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  mode text not null check (mode in (
    'voice_quote',
    'field_note',
    'quote_builder',
    'service_ticket',
    'parts_lookup'
  )),

  status text not null check (status in (
    'queued_local',
    'syncing',
    'transcribing',
    'extracting',
    'generating_scenarios',
    'ready_for_review',
    'needs_review',
    'completed',
    'failed',
    'archived'
  )),

  language text not null default 'en',

  audio_url text,
  audio_duration_ms integer,
  audio_size_bytes bigint,

  transcript text,
  transcript_raw text,
  transcript_edited boolean not null default false,

  customer_company_id uuid references public.crm_companies(id) on delete set null,
  customer_contact_id uuid references public.crm_contacts(id) on delete set null,
  customer_hint text,

  branch_id uuid references public.branches(id) on delete set null,
  branch_slug text,

  legacy_voice_capture_id uuid unique references public.voice_captures(id) on delete set null,
  legacy_originating_log_id uuid references public.qb_ai_request_log(id) on delete set null,

  error jsonb,
  retry_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,

  started_at timestamptz not null default now(),
  transcribed_at timestamptz,
  extracted_at timestamptz,
  completed_at timestamptz,
  synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (transcript_raw is null or transcript is not null),
  check (retry_count >= 0)
);

create index idx_voice_sessions_user_created
  on public.voice_sessions(user_id, created_at desc);

create index idx_voice_sessions_workspace_created
  on public.voice_sessions(workspace_id, created_at desc);

create index idx_voice_sessions_mode_status
  on public.voice_sessions(mode, status);

create index idx_voice_sessions_customer_company
  on public.voice_sessions(customer_company_id)
  where customer_company_id is not null;

create index idx_voice_sessions_customer_contact
  on public.voice_sessions(customer_contact_id)
  where customer_contact_id is not null;

create index idx_voice_sessions_workspace_branch_slug
  on public.voice_sessions(workspace_id, branch_slug)
  where branch_slug is not null;
```

Notes:

- `audio_url` stores the Supabase Storage path in the existing `voice-recordings` bucket. It is null while a recording is only in IndexedDB.
- `branch_slug` is retained because many existing quote and operations tables use branch slugs. `branch_id` is the resolved canonical branch when available.
- `legacy_voice_capture_id` and `legacy_originating_log_id` are migration trace links, not long-term write targets.

### `public.voice_session_fields`

Structured extraction results. One row per extracted field so the rep can review and correct fields before downstream actions run.

```sql
create table public.voice_session_fields (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voice_sessions(id) on delete cascade,

  field_name text not null,
  value_text text,
  value_structured jsonb,
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  confidence_label text generated always as (
    case
      when confidence >= 0.85 then 'high'
      when confidence >= 0.60 then 'medium'
      else 'low'
    end
  ) stored,
  source_span jsonb,

  edited_by_user boolean not null default false,
  original_value jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (session_id, field_name)
);

create index idx_voice_session_fields_session
  on public.voice_session_fields(session_id);

create index idx_voice_session_fields_confidence
  on public.voice_session_fields(confidence_label, field_name);
```

Mode field sets:

| Mode | Required field names |
| --- | --- |
| `voice_quote` | `customer`, `contact`, `equipment`, `budget`, `urgency`, `trade_in`, `location`, `delivery_timeline`, `branch`, `attachments` |
| `field_note` | `customer`, `contact`, `company`, `deal_stage`, `equipment_interest`, `budget`, `next_steps`, `sentiment`, `manager_attention` |
| `quote_builder` | `customer`, `equipment`, `attachments`, `trade_in`, `commercial_terms`, `financing`, `delivery_location` |
| `service_ticket` | `customer`, `machine`, `serial_number`, `symptom`, `urgency`, `location`, `requested_date` |
| `parts_lookup` | `customer`, `machine`, `serial_number`, `part_description`, `quantity`, `urgency`, `delivery_method` |

### `public.voice_session_scenarios`

Persisted Voice Quote scenarios. This is what makes recent voice quotes replayable and comparable after the SSE stream ends.

```sql
create table public.voice_session_scenarios (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voice_sessions(id) on delete cascade,

  rank smallint not null check (rank > 0),
  name text not null,

  qb_equipment_model_id uuid references public.qb_equipment_models(id) on delete set null,
  machine_display text,

  total_price numeric(12,2),
  monthly_payment numeric(10,2),
  financing_rate numeric(5,4),
  financing_term_months integer,
  lead_time_min_weeks smallint,
  lead_time_max_weeks smallint,
  trade_credit_applied numeric(12,2) not null default 0,

  justification text,
  recommended boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  raw_payload jsonb,

  created_at timestamptz not null default now(),

  unique (session_id, rank),
  check (financing_term_months is null or financing_term_months > 0)
);

create index idx_voice_session_scenarios_session_rank
  on public.voice_session_scenarios(session_id, rank);

create unique index idx_voice_session_scenarios_one_recommended
  on public.voice_session_scenarios(session_id)
  where recommended = true;
```

Notes:

- Scenario money uses numeric dollars to match current `quote_packages` conventions. Later Quote Builder line-item work may convert this to cents, but this contract mirrors current package storage.
- `raw_payload` stores the full AI/scenario output for debugging and parity checks, not for primary UI rendering.

### `public.voice_session_events`

Append-only audit trail for state transitions, edits, retries, sync attempts, prompt/response snapshots, and downstream handoffs.

```sql
create table public.voice_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voice_sessions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_voice_session_events_session_created
  on public.voice_session_events(session_id, created_at);

create index idx_voice_session_events_type_created
  on public.voice_session_events(event_type, created_at desc);
```

Minimum event types:

| Event type | When written |
| --- | --- |
| `recording_started` | Mic begins capturing audio |
| `recording_paused` | Rep pauses recording |
| `recording_resumed` | Rep resumes recording |
| `recording_stopped` | Audio blob is finalized |
| `queued_local` | Recording is stored only in IndexedDB |
| `sync_started` | Offline queue begins upload |
| `sync_succeeded` | Local queued recording is persisted remotely |
| `sync_failed` | Sync attempt fails |
| `transcript_partial` | Optional sampled live transcript update |
| `transcript_received` | Final ASR transcript is available |
| `transcript_edited` | Rep edits transcript before extraction |
| `extraction_started` | Extraction begins |
| `fields_extracted` | Fields are written to `voice_session_fields` |
| `field_edited` | Rep edits an extracted field |
| `scenario_generation_started` | Voice Quote scenario generation begins |
| `scenarios_generated` | Scenario rows are written |
| `scenario_selected` | Rep selects a scenario |
| `finalize_started` | Downstream handoff begins |
| `finalize_completed` | Downstream entity is created or updated |
| `error` | Any unrecovered error |

## Existing Table Modifications

### `public.quote_packages`

Add a durable link from Quote Builder packages to the voice session that produced them.

```sql
alter table public.quote_packages
  add column if not exists voice_session_id uuid
    references public.voice_sessions(id) on delete set null;

create index if not exists idx_quote_packages_voice_session
  on public.quote_packages(voice_session_id)
  where voice_session_id is not null;
```

Migration behavior:

1. Keep `originating_log_id`; do not drop or rewrite it.
2. For new Voice Quote finalization, set both `voice_session_id` and, when applicable, `originating_log_id`.
3. For historical packages with `originating_log_id`, backfill `voice_session_id` only when a `voice_sessions.legacy_originating_log_id` can be reconstructed with high confidence.
4. It is acceptable for pre-platform packages to keep `voice_session_id = null`.

### `public.voice_captures`

Current Field Note records remain the legacy storage source during the migration window.

```sql
alter table public.voice_captures
  add column if not exists voice_session_id uuid
    references public.voice_sessions(id) on delete set null;

create index if not exists idx_voice_captures_voice_session
  on public.voice_captures(voice_session_id)
  where voice_session_id is not null;
```

Migration behavior:

1. For every existing `voice_captures` row with `transcript`, `audio_storage_path`, or `extracted_data`, create a `voice_sessions` row with `mode = 'field_note'`.
2. Copy `voice_captures.user_id`, `audio_storage_path`, `duration_seconds`, `transcript`, `sync_status`, `sync_error`, linked CRM IDs, and extracted metadata into the matching session.
3. Set `voice_sessions.legacy_voice_capture_id = voice_captures.id`.
4. Set `voice_captures.voice_session_id = voice_sessions.id`.
5. Leave `voice_captures.transcript`, `audio_storage_path`, `extracted_data`, and sync columns in place as read-only legacy for one release.
6. Drop legacy duplication only in a follow-up migration after row-count and spot-check verification.

## RLS Contract

### Parent access: `voice_sessions`

- `SELECT`: allowed when `user_id = auth.uid()`, or the row is in `public.get_my_workspace()` and `public.get_my_role()` is `admin`, `manager`, or `owner`.
- `INSERT`: allowed when `user_id = auth.uid()` and `workspace_id = public.get_my_workspace()`.
- `UPDATE`: allowed when `user_id = auth.uid()` and `workspace_id = public.get_my_workspace()`. Admin/manager correction flows require a separate product-approved policy.
- `DELETE`: allowed when `user_id = auth.uid()`, or when `workspace_id = public.get_my_workspace()` and `public.get_my_role()` is `admin` or `owner`.
- `service_role`: full access for edge functions and migrations.

### Child access: fields, scenarios, events

Child rows inherit access through their parent session.

```sql
exists (
  select 1
  from public.voice_sessions s
  where s.id = session_id
    and (
      s.user_id = auth.uid()
      or (
        s.workspace_id = public.get_my_workspace()
        and public.get_my_role() in ('admin', 'manager', 'owner')
      )
    )
)
```

Child `INSERT` / `UPDATE` writes are normally service-role writes from edge functions. User field edits are allowed only when the parent session belongs to the user and the mutation is limited to editable review fields.

## Lifecycle Mapping

| `voice_sessions.status` | Voice Quote step | Field Note step | Notes |
| --- | --- | --- | --- |
| `queued_local` | Record | Record | Audio is only in IndexedDB; `audio_url` is null. |
| `syncing` | Record | Record | Offline queue is uploading. |
| `transcribing` | Review transcript | Review transcript | Live transcript streams from endpoint; final transcript persists. |
| `extracting` | Review transcript | Review details | Extraction writes `voice_session_fields`. |
| `generating_scenarios` | Compare scenarios | Not applicable | Voice Quote only. |
| `ready_for_review` | Review transcript, review fields, or compare scenarios | Review details | UI sub-step is derived from available transcript, fields, and scenarios. |
| `needs_review` | Review fields | Review details | Low confidence, missing customer, failed sync, or ambiguous equipment. |
| `completed` | Open in Quote Builder | Synced to QRM | Downstream action succeeded. |
| `failed` | Error | Error | `error` jsonb contains stage and retry guidance. |
| `archived` | Recent sessions | Recent sessions | Hidden from default active lists. |

## UI Data Source Matrix

| UI element | Mode(s) | Source table.column | Computed? | Refresh | RLS notes |
| --- | --- | --- | --- | --- | --- |
| Workflow step indicator | Voice Quote, Field Note | `voice_sessions.status` | Yes, maps status to step | On session fetch, SSE/event transition, and finalize response | Parent session access |
| Voice capture timer | All modes | Client recording start time | Yes | Every second while recording | Local only |
| Max recording duration | All modes | Mode config | Yes | On mode initialization | No database access |
| Waveform visualization | All modes | Client audio analysis | Yes | Animation frame while recording | Local only; not stored |
| Recording state label | All modes | Client recorder state + `voice_sessions.status` | Yes | Immediate local state, then session status update | Parent session access after persistence |
| Live transcript | All modes | Streaming endpoint partials; final `voice_sessions.transcript` | Partly | SSE while transcribing; refetch on completion | Parent session access |
| Raw transcript | All modes | `voice_sessions.transcript_raw` | No | On ASR completion | Parent session access; never user-mutated |
| Edit transcript button state | All modes | `voice_sessions.transcript`, `voice_sessions.transcript_edited`, session status | Yes | After transcription and after transcript edit | Parent update requires owner policy |
| Transcript edit save | All modes | Writes `voice_sessions.transcript`, `transcript_edited = true` | No | On save | Owner update only; event row required |
| Extracted fields | All modes | `voice_session_fields.value_text`, `value_structured` | No | After extraction and after field edit | Child access through parent |
| Confidence chips | All modes | `voice_session_fields.confidence_label` | Yes, generated column | After extraction and field edit | Child access through parent |
| Evidence/source span | All modes | `voice_session_fields.source_span` | No | After extraction | Child access through parent |
| Field edit pencil | All modes | Writes `voice_session_fields.value_text`, `value_structured`, `edited_by_user = true` | No | On save | Owner update only; event row required |
| Scenario cards | Voice Quote | `voice_session_scenarios` rows | No | After scenario generation | Child access through parent |
| RECOMMENDED tag | Voice Quote | `voice_session_scenarios.recommended` | No | After scenario generation | Child access through parent |
| Scenario price | Voice Quote | `voice_session_scenarios.total_price`, `monthly_payment` | No | After scenario generation | Child access through parent |
| Financing terms | Voice Quote | `voice_session_scenarios.financing_rate`, `financing_term_months` | No | After scenario generation | Child access through parent |
| Lead time | Voice Quote | `lead_time_min_weeks`, `lead_time_max_weeks` | No | After scenario generation | Child access through parent |
| Trade credit | Voice Quote | `voice_session_scenarios.trade_credit_applied` | No | After scenario generation | Child access through parent |
| Compare button | Voice Quote | `voice_session_scenarios` rows | Yes, modal table | On click from current scenario data | Child access through parent |
| Open in Quote Builder | Voice Quote | Creates `quote_packages.voice_session_id`; selected scenario event | No | On `voice-finalize` response in Phase 3+ | Must access parent session and created package |
| Generated from voice badge | Quote Builder | `quote_packages.voice_session_id` | Yes | Quote package load | Quote package RLS plus session access |
| Back to Voice Quote | Quote Builder | `quote_packages.voice_session_id` or URL `voice_session_id` | Yes | Quote Builder route load | Session access required to restore |
| Try saying something like | All modes | Mode config examples | Yes | On render or shuffle | No database access |
| Language indicator | All modes | `voice_sessions.language` | No | On session create and language change | Parent session access |
| Offline-ready status | All modes | Browser online status + mode support config | Yes | Online/offline events | Local only |
| Drafts queued counter | All modes | IndexedDB `voice_note_queue` | Yes | Queue mutation and online/offline events | Local only until sync |
| Recent Voice Quotes table | Voice Quote | `voice_sessions` where `mode = 'voice_quote'` | Partly | Initial load, filter changes, finalize/sync events | Parent session access |
| Recent Field Notes table | Field Note | `voice_sessions` where `mode = 'field_note'`; legacy `voice_captures` during migration | Partly | Initial load, filter changes, sync events | Parent session access; legacy RLS during migration |
| Recent row title | Voice Quote, Field Note | `customer_hint`, field rows, `metadata.title` | Yes | Session list fetch | Parent session access |
| Recent row customer | Voice Quote, Field Note | `customer_company_id`, `customer_contact_id`, `customer_hint` | Partly | Session list fetch and CRM join | Session plus CRM RLS |
| Recent row duration | Voice Quote, Field Note | `voice_sessions.audio_duration_ms` | Yes, display format | Session list fetch | Parent session access |
| Recent row created time | Voice Quote, Field Note | `voice_sessions.created_at` | Yes, display format | Session list fetch | Parent session access |
| Play button on recent rows | Voice Quote, Field Note | `voice_sessions.audio_url`; IndexedDB blob if `queued_local` | Partly | On click | Storage policy or local queue ownership |
| Status chips on recent rows | Voice Quote, Field Note | `voice_sessions.status`, `voice_sessions.error` | Yes, display mapping | Session list fetch and sync events | Parent session access |
| Actions column | Voice Quote, Field Note | `voice_sessions.status`, `quote_packages.voice_session_id`, metadata downstream IDs | Yes | Session list fetch and finalize response | Parent plus downstream entity RLS |
| What to Mention sidebar | Voice Quote, Field Note | Mode config | Yes | On mode render | No database access |
| What Happens Next sidebar | Voice Quote, Field Note | Mode config | Yes | On mode render | No database access |
| Field Note match confidence | Field Note | `voice_session_fields.confidence_label`; legacy `voice_captures.extracted_data` during migration | Yes | After extraction or legacy read | Child access through parent; legacy RLS during migration |
| QRM sync destination | Field Note | `metadata.downstream`, `customer_company_id`, `customer_contact_id`, legacy HubSpot fields during migration | Partly | Finalize/sync response | Parent plus CRM RLS |
| Offline audio preview | Field Note, Voice Quote | IndexedDB `voice_note_queue.audioBlob` | Yes | On click before sync | Local only |

## Legacy Backfill Rules

### `voice_captures` to `voice_sessions`

Field mapping:

| `voice_captures` | `voice_sessions` |
| --- | --- |
| `id` | `legacy_voice_capture_id` |
| `user_id` | `user_id` |
| derived from row / `get_my_workspace()` | `workspace_id` |
| `audio_storage_path` | `audio_url` |
| `duration_seconds * 1000` | `audio_duration_ms` |
| `transcript` | `transcript`, `transcript_raw` |
| `linked_company_id` | `customer_company_id` |
| `linked_contact_id` | `customer_contact_id` |
| `sync_status` | `status` mapping |
| `sync_error` | `error` |
| `extracted_data` and intelligence fields | `metadata.legacy_voice_capture` |

Status mapping:

| `voice_captures.sync_status` | `voice_sessions.status` |
| --- | --- |
| `pending` | `needs_review` |
| `processing` | `syncing` |
| `synced` | `completed` |
| `failed` | `failed` |

### `qb_ai_request_log` to `voice_sessions`

Backfill is best-effort only.

- Rows with `prompt_source = 'voice'` can create `voice_sessions` with `mode = 'voice_quote'` when a corresponding quote package or saved handoff can be identified.
- Copy `raw_prompt` into `transcript` and `transcript_raw` only when it is known to be an ASR transcript, not a typed prompt.
- Copy `confidence` into initial `voice_session_fields` rows when it can be safely mapped by field name.
- Link `voice_sessions.legacy_originating_log_id` to `qb_ai_request_log.id`.
- Do not infer customer/company IDs unless an existing resolved CRM link is available.

## Offline Contract

- IndexedDB store: existing `sales_companion.voice_note_queue`.
- While offline, a recording creates a local queued item with audio blob, mode, duration, language, optional customer/deal context, and a client-generated id.
- Server `voice_sessions.status = 'queued_local'` exists only after a local session shell has been created or synced. If no server row exists yet, the UI derives queued state from IndexedDB.
- Sync writes `sync_started`, `sync_succeeded`, or `sync_failed` events once a server session exists.
- Failed sync retries use exponential backoff. After five failures, the session displays `needs_review` or `failed` depending on whether the audio is still safely queued.
- Local queued audio must be playable before sync.

## Phase 3 Handoff Gaps

- Voice Quote does not currently persist a replayable `voice_sessions` row or scenario rows.
- Voice Quote does not use the existing `voice_note_queue` IndexedDB path.
- Confidence exists in `qb_ai_request_log.confidence` and Field Note extracted evidence, but Voice Quote does not surface it as editable field confidence.
- Scenario generation streams through `qb-ai-scenarios`; generated scenarios are not durable unless a quote is saved.
- Quote Builder currently receives Voice Quote selections through `sessionStorage`, not `quote_packages.voice_session_id` or a `voice_session_id` route param.
- Field Note and Voice Quote use separate frontend recorder implementations.
- The consolidated backend function contract, ASR streaming behavior, prompt registry, cost budget, and endpoint migration plan belong to Phase 3.

## Approval Stop

Phase 2 is complete when this document is reviewed and accepted. Do not begin Phase 3 backend planning, migrations, edge function work, or frontend shared component work until the data contract is approved.
