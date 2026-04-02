# QEP OS — Full System Context Document

> This document describes the complete state of QEP OS as of April 2, 2026.
> It is intended as a handoff artifact for any engineer, AI model, or stakeholder
> who needs to understand what has been built, how it works, and where the
> boundaries are.

---

## 1. Mission

> "Create a Moonshot Application built around equipment and parts, sales and
> rental, for the employees, salesmen, company corporate operations, and
> management. Identify, design, and pressure-test transformational AI application
> ideas that are not fully possible today but will be unlocked by
> superintelligence."

QEP OS is an AI-powered dealership operations platform for **Quality Equipment
& Parts** — a heavy equipment dealer selling and renting excavators, wheel
loaders, skid steers, compact track loaders, backhoes, and attachments. The
platform replaces HubSpot as the company CRM and layers AI intelligence on
top of every workflow.

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 3, Radix UI primitives, shadcn/ui components, React Router 6, TanStack React Query 5 |
| Backend | Supabase (PostgreSQL 15, Edge Functions on Deno, Auth, Storage, Realtime) |
| AI | OpenAI GPT-5.4-mini (chat, briefings, extraction, summarization), GPT-5.4-mini vision (equipment analysis), Whisper (transcription), text-embedding-3-small (1536-dim vectors) |
| Hosting | Netlify (frontend), Supabase Cloud (backend) |
| Package Manager | Bun (monorepo), Deno (edge functions) |
| Repository | GitHub — `lewis4x4/qep` on `main` branch |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Netlify CDN                       │
│              React SPA (Vite build)                  │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────┐
│              Supabase Edge Functions                 │
│  chat, voice-capture, equipment-vision, ingest,      │
│  morning-briefing, anomaly-scan, prep-sheet,         │
│  embed-crm, crm-router, + 16 more (25 total)        │
└──────────┬────────────────────┬─────────────────────┘
           │                    │
  ┌────────▼────────┐  ┌───────▼────────┐
  │   PostgreSQL    │  │ OpenAI APIs    │
  │  64 migrations  │  │ GPT-5.4-mini   │
  │  63 tables      │  │ Whisper        │
  │  RLS on all     │  │ Embeddings     │
  │  Vector search  │  │ Vision         │
  └────────┬────────┘  └────────────────┘
           │
  ┌────────▼────────┐
  │ Supabase Storage│
  │ voice-recordings│
  │ equipment-photos│
  │ document-originals│
  └─────────────────┘
```

---

## 4. User Roles

| Role | Access |
|------|--------|
| `rep` | Own contacts, deals, activities, voice notes, equipment, quotes, knowledge chat |
| `admin` | Everything reps can do + user management, document admin, integration settings |
| `manager` | Everything reps can do + all reps' data, team analytics, competitive intel, knowledge gaps |
| `owner` | Full access to everything including finance-level documents and owner-only settings |

Roles are enforced at both the API level (Edge Function auth checks) and the
database level (Row Level Security policies on every user-facing table).

---

## 5. Features — What Has Been Built

### 5.1 Dashboard (Sales Command Center)

**File:** `apps/web/src/components/SalesCommandCenter.tsx`

The main landing page after login. Layout order:

1. **Personalized greeting** with AI-generated status line (e.g., "4 follow-ups overdue — let's get on them")
2. **AI Morning Briefing** — GPT-generated daily action plan with pipeline snapshot, priority actions, deals to watch, quick wins
3. **Metric cards** — Pipeline value, Open Deals, Follow-ups (with overdue count), Activity (7d)
4. **Deal Momentum** — Top deals by value in a 2×4 responsive grid with heat badges (Hot / Warm / Cold / At Risk)
5. **Action Queue** — Pill-based category triage (Overdue / Today / This Week). Tap a pill to reveal up to 3 items. Default auto-selects the most urgent category.
6. **Field Intelligence** — Recent voice captures with transcript previews

### 5.2 CRM Hub (AI Intelligence Center)

**File:** `apps/web/src/features/crm/pages/CrmHubPage.tsx`

Distinct from the Dashboard — focused on CRM-wide analytics rather than daily personal ops.

- **Pipeline stats** — Total pipeline, open deals, avg AI deal score, activity count
- **Pipeline Health Bar** — Visual distribution of deals by heat (hot/warm/cold/at-risk)
- **Anomaly Alerts** — Proactive risk signals (stalling deals, overdue follow-ups, activity gaps) with acknowledge button
- **Quick Actions** — Record Voice, Ask AI, Scan Equipment, View Pipeline
- **AI Deal Scoreboard** — Top deals ranked by predictive deal score (0-100) with factor breakdown
- **Competitive Intel** — Competitor mentions extracted from voice notes (manager+ only)
- **Knowledge Gaps** — Questions the AI couldn't answer (manager+ only)
- **CRM Navigation Grid** — Activities, Deals, Contacts, Companies, Equipment + Admin tools
- **Deal Momentum** — Grid of top deals by value

### 5.3 CRM Module

**Files:** `apps/web/src/features/crm/`

Full CRM replacing HubSpot:

- **Contacts** — List, detail, edit, archive, merge duplicates, company associations, tag management, territory assignment
- **Companies** — List, detail, edit, parent/child hierarchy with cycle detection, equipment fleet view
- **Deals** — Pipeline board view with drag-and-drop stages, deal detail with AI scoring, equipment associations, margin tracking
- **Activities** — Timeline view across contacts/deals/companies. Types: note, call, email, meeting, task. Templates system. Task completion tracking.
- **Equipment** — Full equipment records with make/model/year/serial/condition/hours/availability/pricing. AI Vision analysis. Photo gallery.
- **Follow-up Sequences** — Automated follow-up step sequences with scheduling
- **Activity Templates** — Reusable activity templates for common workflows
- **Duplicate Detection** — Automated duplicate candidate scoring with merge capability
- **Custom Fields** — Admin-defined custom fields on contacts, companies, deals

**Database views:**
- `crm_deals_weighted` — Deals with stage probability, weighted amount, contact/company names
- `crm_deals_rep_safe` — Rep-scoped deal view respecting RLS

### 5.4 Knowledge Base Chat

**Files:** `apps/web/src/components/ChatPage.tsx`, `supabase/functions/chat/index.ts`

AI-powered Q&A over all company data:

- **Multi-source retrieval pipeline:**
  - Semantic vector search across uploaded documents (via `chunks` + embeddings)
  - Semantic vector search across CRM embeddings (contacts, deals, activities, voice notes, equipment)
  - Keyword/fulltext search across documents AND CRM embeddings
  - Token-based broad CRM search (activities, voice transcripts, contacts, companies, deals, equipment, quotes, market valuations, auction results, competitor listings, customer profiles, fleet intelligence, financing rates, outreach queue)
  - Proper name extraction for compound name searches (e.g., "John Smith")
  - Contact-enrichment: when a contact is found, automatically pulls their deals, activities, and voice notes

- **OpenAI Function Calling (Tools):** The chat model can execute live CRM queries and actions:
  - `searchContacts`, `searchDeals`, `searchEquipment`, `getDealDetails`, `getContactDetails`, `getEquipmentDetails`
  - `getPipelineSummary`, `getDealsClosingThisWeek`, `getOverdueFollowUps`
  - `createFollowUpTask`, `logActivity`, `updateDealStage`
  - `draftEmail`, `getDealCoaching`, `generatePrepSheet`
  - `getAnomalyAlerts`, `getCompetitiveIntelligence`, `getVoiceNoteInsights`

- **Conversation persistence** — Chat history saved to `chat_conversations` / `chat_messages` with source citations and trace IDs
- **Feedback** — Thumbs up/down on messages
- **Export** — Download conversation as markdown
- **Knowledge Gap Detection** — When no evidence is found for a substantial question, it's logged to `knowledge_gaps` for admin review

### 5.5 Voice Capture

**Files:** `apps/web/src/components/VoiceCapturePage.tsx`, `supabase/functions/voice-capture/index.ts`

Mobile-first voice-to-CRM pipeline:

1. **Record** — Browser MediaRecorder API captures audio
2. **Transcribe** — OpenAI Whisper API
3. **Extract** — GPT extracts structured CRM data: contact name, company, equipment interest, budget, next steps, sentiment, competitor mentions
4. **Persist** — Saves to `voice_captures` table with transcript, extracted data, audio file in Storage
5. **CRM Link** — Auto-creates CRM activity notes linked to matched deals/contacts
6. **Intelligence** — Post-processing links mentions to existing CRM contacts/companies/deals, extracts competitive mentions, flags for manager attention
7. **HubSpot Sync** — Optional sync to HubSpot as engagement notes (when connected)

**Voice History Page** (`VoiceHistoryPage.tsx`):
- Searchable, filterable list of all voice notes
- Sentiment filter, manager-attention filter
- Audio playback via signed URLs
- Pagination

### 5.6 Equipment Vision

**Files:** `apps/web/src/components/EquipmentVision.tsx`, `supabase/functions/equipment-vision/index.ts`

AI-powered equipment identification:

1. **Upload photo** of any piece of equipment
2. **GPT Vision** identifies make, model, year, category, condition, estimated hours
3. **Auto-fill** — Populates CRM equipment record fields
4. **Photo persistence** — Saves to `equipment-photos` Storage bucket
5. **CRM matching** — Cross-references analysis with existing inventory

### 5.7 Document Management

**Files:** `apps/web/src/components/AdminPage.tsx`, `supabase/functions/ingest/index.ts`

- **Upload** — PDF, DOCX, XLSX, TXT, CSV, MD with real progress bar (XHR upload tracking)
- **Parse** — Extracts text from all formats (pdf-parse, mammoth, XLSX)
- **Chunk** — Splits into overlapping chunks for embedding
- **Embed** — OpenAI text-embedding-3-small (1536-dim)
- **Summarize** — GPT generates 2-3 sentence AI summary on upload
- **Audience control** — Documents scoped by audience: company_wide, finance, leadership, admin_owner, owner_only
- **Status** — Draft / Published / Archived lifecycle
- **OneDrive sync** — Delta sync for connected OneDrive accounts
- **Governance** — Full audit trail via `document_audit_events`

### 5.8 Morning Briefing

**Files:** `apps/web/src/components/SalesCommandCenter.tsx`, `supabase/functions/morning-briefing/index.ts`

- AI-generated personalized daily briefing
- Pulls pipeline data, overdue follow-ups, closing deals, recent voice notes
- Generates markdown with Pipeline Snapshot, Priority Actions, Deals to Watch, Quick Wins
- Stored in `morning_briefings` table (one per user per day)
- Can be triggered manually or via scheduled cron

### 5.9 Anomaly Detection

**File:** `supabase/functions/anomaly-scan/index.ts`

Proactive intelligence engine running on schedule:

- **Stalling Deals** — Deals with no activity in 7+ days
- **Overdue Follow-ups** — Missed follow-up dates
- **Activity Gaps** — Reps with no activity in 3+ days
- **Pipeline Risk** — Deals past expected close date still open
- **Predictive Deal Scoring** — Computes 0-100 win probability score based on activity frequency, stage velocity, deal size vs average, follow-up adherence. Stored on `crm_deals.deal_score`.

### 5.10 Prep Sheets

**File:** `supabase/functions/prep-sheet/index.ts`

Pre-meeting intelligence briefs:

- Gathers all CRM data for a company or contact (deals, activities, equipment, voice notes, valuations, competitive mentions)
- GPT synthesizes into a structured markdown prep sheet
- Role-gated (rep, admin, manager, owner only)
- Input sanitized to prevent PostgREST injection

### 5.11 Quote Builder

**Files:** `apps/web/src/components/QuoteBuilderPage.tsx`, `QuoteBuilderGate.tsx`

3-step equipment quote wizard:

1. **Customer Info** — Name, company, contact details
2. **Equipment Selection** — Browse catalog by category, add machines and attachments
3. **Proposal Review** — Line items, pricing, print-ready proposal

**Current state:** Fully built UI (1,500+ lines) running against a mock equipment catalog.
**Gate:** Shows "Coming Soon" until IntelliDealer/Telapath integration credentials are configured.
**AI features:** Customer Insight Card (pricing persona, deal history) and Market Valuation Card integrated into the flow.

### 5.12 CRM Embedding Pipeline

**File:** `supabase/functions/embed-crm/index.ts`

Background job that maintains vector embeddings for CRM data:

- Processes contacts, companies, deals, equipment, voice captures, activities
- Generates text summaries per entity, embeds with OpenAI
- Upserts into `crm_embeddings` table (HNSW indexed)
- Scheduled to run every 15 minutes via pg_cron

### 5.13 Integrations

**Files:** `apps/web/src/components/IntegrationHub.tsx`, various edge functions

- **HubSpot** — OAuth flow, contact/company/deal import, activity sync, webhook receiver, follow-up sequence automation
- **OneDrive** — OAuth flow, document delta sync
- **IntelliDealer** — Connection check (gate for Quote Builder), not yet live
- **Integration Hub UI** — Status dashboard showing connection health, last sync, test results

---

## 6. Database Schema Summary

**63 tables** across 64 migrations. Key tables:

| Domain | Tables |
|--------|--------|
| Auth/Users | `profiles` |
| CRM Core | `crm_contacts`, `crm_companies`, `crm_deals`, `crm_deal_stages`, `crm_activities`, `crm_equipment`, `crm_tags`, `crm_territories` |
| CRM Relations | `crm_contact_companies`, `crm_contact_tags`, `crm_contact_territories`, `crm_deal_equipment`, `crm_external_id_map` |
| CRM Extensions | `crm_custom_field_definitions`, `crm_custom_field_values`, `crm_duplicate_candidates`, `crm_activity_templates` |
| CRM Automation | `crm_reminder_instances`, `crm_in_app_notifications`, `crm_merge_audit_events`, `crm_auth_audit_events` |
| Quotes | `quotes`, `crm_quote_audit_events` |
| Documents | `documents`, `chunks` |
| Voice | `voice_captures`, `competitive_mentions` |
| AI/Intelligence | `crm_embeddings`, `morning_briefings`, `anomaly_alerts`, `knowledge_gaps` |
| Chat | `chat_conversations`, `chat_messages` |
| HubSpot | `hubspot_connections`, `follow_up_sequences`, `follow_up_steps`, `sequence_enrollments`, `activity_log`, `hubspot_webhook_receipts`, `workspace_hubspot_portal` |
| DGE (Market Intel) | `customer_profiles_extended`, `customer_deal_history`, `market_valuations`, `auction_results`, `competitor_listings`, `fleet_intelligence`, `outreach_queue`, `manufacturer_incentives`, `financing_rate_matrix`, `deal_scenarios`, `deal_feedback`, `margin_waterfalls`, `pricing_persona_models` |
| Integrations | `integration_status`, `integration_status_credential_audit_events`, `onedrive_sync_state` |
| Economic | `economic_indicators`, `economic_sync_runs` |
| Platform | `rate_limit_log`, `analytics_events`, `document_audit_events` |

**Security:**
- RLS enabled on every user-facing table
- Helper functions: `get_my_role()`, `get_my_workspace()`
- Role-based access patterns throughout
- `crm_embeddings` and `competitive_mentions` restricted to service_role or elevated roles

**Vector Search:**
- HNSW index on `chunks.embedding` and `crm_embeddings.embedding` (cosine distance)
- `retrieve_document_evidence` function: semantic search on documents + CRM embeddings + keyword search on both

---

## 7. Edge Functions (25 deployed)

| Function | Purpose |
|----------|---------|
| `chat` | Knowledge base Q&A with multi-source retrieval and function calling |
| `voice-capture` | Audio transcription → AI extraction → CRM persistence |
| `voice-capture-sync` | HubSpot sync for voice captures |
| `equipment-vision` | Photo → AI equipment identification → CRM auto-fill |
| `ingest` | Document upload, parsing, chunking, embedding, summarization |
| `embed-crm` | Background CRM data embedding pipeline |
| `morning-briefing` | AI daily briefing generation |
| `anomaly-scan` | Proactive risk detection + deal scoring |
| `prep-sheet` | Pre-meeting intelligence brief generation |
| `document-admin` | Document lifecycle management (publish, archive, delete) |
| `crm-router` | CRM CRUD operations router |
| `crm-hubspot-import` | HubSpot data import pipeline |
| `crm-reminder-dispatcher` | Follow-up reminder scheduling and dispatch |
| `hubspot-oauth` | HubSpot OAuth flow handler |
| `hubspot-webhook` | HubSpot webhook receiver |
| `hubspot-scheduler` | HubSpot follow-up sequence automation |
| `onedrive-oauth` | OneDrive OAuth flow handler |
| `integration-availability` | Integration connection status check |
| `integration-test-connection` | Integration health test |
| `admin-users` | User management operations |
| `demo-admin` | Demo environment management |
| `customer-profile` | Customer DNA profile retrieval |
| `customer-dna-update` | Customer profile update pipeline |
| `market-valuation` | Equipment market valuation lookup |
| `economic-sync` | Economic indicator sync |

---

## 8. Frontend Structure

```
apps/web/src/
├── main.tsx                    # Entry point
├── App.tsx                     # Router, auth, layout shell
├── index.css                   # Tailwind base styles
├── assets/                     # Logo, hero images
├── hooks/                      # useAuth, useTheme, use-toast
├── lib/                        # Supabase client, types, utilities
├── components/                 # Route-level pages + shared components
│   ├── ui/                     # shadcn/ui primitives (Button, Card, Badge, etc.)
│   ├── SalesCommandCenter.tsx  # Dashboard
│   ├── ChatPage.tsx            # Knowledge base chat
│   ├── ChatMessage.tsx         # Chat message renderer
│   ├── ChatEmptyState.tsx      # Chat welcome screen
│   ├── VoiceCapturePage.tsx    # Voice recording
│   ├── VoiceHistoryPage.tsx    # Voice notes history
│   ├── AdminPage.tsx           # Document + user admin
│   ├── QuoteBuilderPage.tsx    # Equipment quoting
│   ├── IntegrationHub.tsx      # Integration management
│   ├── EquipmentVision.tsx     # AI equipment analysis
│   ├── LoginPage.tsx           # Authentication
│   └── ...
└── features/
    ├── crm/                    # CRM module
    │   ├── pages/              # 13 CRM page components
    │   ├── components/         # 18 CRM UI components
    │   ├── hooks/              # CRM mutation hooks
    │   └── lib/                # CRM API adapters, types
    └── dge/                    # Dealership Growth Engine
        ├── components/         # Customer insight, market valuation cards
        ├── hooks/              # Profile + valuation hooks
        └── lib/                # DGE API adapter
```

---

## 9. Design System

- **Dark mode only** — Rich dark backgrounds (`bg-qep-bg`)
- **Brand color:** QEP Orange (`qep-orange`) for accents, CTAs, active states
- **Glassmorphism/Crystal** design language — `bg-white/5`, `border-white/10`, `backdrop-blur`
- **Typography:** System font stack, tight tracking on headings
- **Components:** shadcn/ui primitives (Button, Card, Badge, Input, Table, Tabs, Toast, Tooltip, Dialog, Dropdown)
- **Icons:** Lucide React throughout
- **Responsive:** Mobile-first, `sm:` / `lg:` breakpoints, collapsible sections for mobile

---

## 10. What Is NOT Built Yet

| Feature | Status | Notes |
|---------|--------|-------|
| Quote Builder live inventory | Blocked | Waiting for IntelliDealer/Telapath API credentials. Full UI is built with mock data. |
| PDF proposal generation | Not started | Quote Builder can print but doesn't generate downloadable PDFs |
| E-signature on quotes | Not started | Future enhancement |
| Real-time notifications | Partial | `crm_in_app_notifications` table exists but no WebSocket/Realtime push to UI |
| Mobile native app | Not started | Web app is mobile-responsive but not a native app |
| Multi-workspace | Partial | `workspace_id` exists on most tables but only `'default'` workspace is used |
| Email sending | Not built | `draftEmail` tool generates drafts but doesn't send |
| Calendar integration | Not started | No Google/Outlook calendar sync |
| Reporting/analytics dashboards | Not started | No historical reporting beyond what the Dashboard/CRM Hub show |
| Customer portal | Not started | No external-facing customer access |

---

## 11. Environment Variables

Required for production (set in Supabase Dashboard → Edge Function Secrets):

- `OPENAI_API_KEY` — OpenAI API access
- `SUPABASE_URL` — Project URL (auto-set by Supabase)
- `SUPABASE_ANON_KEY` — Public anon key (auto-set)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (auto-set)

Required in frontend (`.env` or Netlify env):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional integrations:

- `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` — HubSpot OAuth
- `HUBSPOT_CRYPTO_KEY` — Token encryption
- `ONEDRIVE_CLIENT_ID` / `ONEDRIVE_CLIENT_SECRET` — OneDrive OAuth
- `INTELLIDEALER_*` — IntelliDealer connection (not yet configured)

---

## 12. Build & Deploy

```bash
# Frontend
cd apps/web
bun install
bun run build          # Vite production build → dist/

# Type checking
npx tsc --noEmit       # Frontend TypeScript
deno check supabase/functions/*/index.ts  # Edge functions

# Database
npx supabase db push   # Apply pending migrations

# Edge Functions
npx supabase functions deploy <name> --no-verify-jwt

# Full deploy
git push origin main   # Netlify auto-deploys frontend from main
```

---

*Generated April 2, 2026. Repository: `lewis4x4/qep` on GitHub.*
