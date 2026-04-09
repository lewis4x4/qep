# Wave 7 — Iron: The Operator Companion

**Audience:** Claude Code (build agent). This document is the implementation contract.
**Repo:** `/Users/brianlewis/client-projects/qep`
**Status:** Moonshot spec. Build-ready after Architect signoff.
**Codename:** Iron (evolution of the "Ask Iron Advisor" concept in Wave 6.6; this IS the Iron Advisor, embodied).
**Hotkey:** `Cmd+K` / `Ctrl+K` to summon. `Cmd+Shift+K` to start voice mode. Spacebar (long-press) to push-to-talk while Iron is focused.

---

## 0. Mission Fit Check (mandatory per CLAUDE.md)

- **Mission Fit:** Iron is the operator's co-pilot for every equipment & parts sales+rental workflow. Every click, every flow, every suggestion is tied to a real dealership action — starting rentals, pulling parts, building quotes, logging service, processing trades, drafting follow-ups, checking AR. Zero filler.
- **Transformation:** This is not a chatbot. It is a **flow engine** that replaces multi-page navigation with guided, overlay-rendered, voice-or-type-driven, context-aware workflows. The commodity QRM "go to a page, fill a form, click save" model collapses into "press Cmd+K, say or click what you want, answer 3 questions, done." This is unlocked by (a) a declarative flow DSL, (b) LLM-driven slot filling, (c) pre-captured context, and (d) agentic fallback to the Paperclip pipeline for anything beyond the flow library.
- **Pressure Test:** Must work offline-degraded, mid-form, inside modals, under bad connectivity, with voice input in a noisy shop, for users in every Iron Role (Iron Manager / Advisor / Woman / Man). Must never mutate data without confirmation. Must never lose partial flow state on page reload.
- **Operator Utility:**
  - **Rep in the field:** summons Iron, says "start a rental for John at Maple Construction on the 320 excavator for 3 weeks," Iron confirms, drafts the agreement, attaches the machine, calculates pricing, queues customer signature — 15 seconds instead of 8 minutes.
  - **Parts counter:** "pull 4 of the 6T-4545 filters for WO 8821" → Iron opens pick list, deducts inventory, attaches to work order, prints ticket.
  - **Manager:** "show me every deal over $50K stuck in stage 14 for more than 10 days" → Iron renders a live list with one-click actions on each row.
  - **Owner:** "what's my AR exposure on Anderson Equipment right now" → Iron answers with a sourced number and a "block new financed deals?" inline action.

---

## 1. Scope Boundary

### Ships in v1 (Wave 7.0 — the Foundation)
- The **avatar** — animated character in bottom-right, click target + status indicator.
- The **summoning layer** — hotkey, click, voice wake.
- The **Iron Bar** — command palette overlay with quick actions, search, free-text input.
- The **Flow Engine** — declarative runtime that renders multi-step overlay flows.
- The **Context Engine** — always-on page/entity/state awareness (reuses Flare's ring buffers from Wave 6.11).
- The **Intent Router** — LLM classifier that maps free text or voice to either (a) a Flow, (b) a read-only answer, or (c) a Paperclip pipeline task.
- **10 v1 Flows** (see §7): start-rental, pull-part, start-quote, add-customer, add-equipment, log-service-call, process-trade-in, draft-follow-up-email, check-ar-status, find-similar-deal.
- **Voice I/O** via ElevenLabs (TTS) + browser Web Speech API (STT in v1, upgradeable to ElevenLabs STT later).
- **Iron Memory** — per-user vector store of patterns, preferences, recent entities.
- **Confirmation-before-mutation** rule, enforced at the flow engine level.
- **Edge function `iron-orchestrator`** — single entry point for intent classification + flow dispatch + memory read/write.
- **Supabase schema** — migration 170 (iron_sessions, iron_messages, iron_flow_runs, iron_memory, iron_flow_definitions).

### Ships in v1.1 (Wave 7.1 — Proactive Mode)
- Context-aware proactive nudges ("This quote hasn't been touched in 6 days — want me to draft a follow-up?")
- Learned shortcuts per user ("You usually run this exact flow at 7am on Mondays — want me to pre-stage it?")
- Flow chaining ("I just started the rental. Do you want me to also draft the delivery email?")

### Ships in v1.2 (Wave 7.2 — Flow Marketplace)
- Admin UI to define new flows via YAML without code changes.
- Per-workspace custom flows.
- Flow A/B testing with conversion metrics.

### Explicitly NOT in scope for v1
- Video avatar (we use a 2D animated SVG character, not a rendered 3D head).
- Full agentic autonomy without confirmation — every mutation still requires human click/tap.
- Mobile native app version (web works on mobile browsers; native comes later).
- Third-party flow publishing (workspace-scoped only).
- Voice cloning of real people.

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ USER (any page in QEP OS)                                            │
└──────────────┬───────────────────────────────────────────────────────┘
               │ Cmd+K / click avatar / "Hey Iron"
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ IRON SHELL (React, mounted once at app root)                         │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ Avatar       │  │ Iron Bar     │  │ Flow Overlay               │  │
│  │ (idle/think/ │  │ (cmd palette │  │ (renders current flow step)│  │
│  │  speak/alert)│  │  + freetext) │  │                            │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────────┘  │
│         │                 │                     │                    │
│         └─────────────────┴─────────────────────┘                    │
│                           │                                          │
│                 ┌─────────▼──────────┐                                │
│                 │ Iron Client        │                                │
│                 │ - context builder  │                                │
│                 │ - flow runtime     │                                │
│                 │ - voice I/O        │                                │
│                 │ - memory read      │                                │
│                 └─────────┬──────────┘                                │
└───────────────────────────┼──────────────────────────────────────────┘
                            │ POST /functions/v1/iron-orchestrator
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│ iron-orchestrator EDGE FUNCTION                                      │
│  1. Auth + rate limit                                                │
│  2. Intent classification (LLM)                                      │
│  3. Dispatch:                                                        │
│     a) FLOW_DISPATCH → return flow def + initial slot values         │
│     b) READ_ANSWER → execute SQL/API, return answer                  │
│     c) AGENTIC_TASK → forward to Paperclip CEO agent                 │
│  4. Memory write                                                     │
│  5. Session log                                                      │
└─────────┬──────────────────┬───────────────────┬─────────────────────┘
          │                  │                   │
          ▼                  ▼                   ▼
  ┌──────────────┐   ┌──────────────┐    ┌─────────────────┐
  │ Supabase     │   │ OpenAI /     │    │ Paperclip CEO   │
  │ (RLS, flows, │   │ Claude API   │    │ (agentic tasks) │
  │ memory, log) │   │ (intent+NLU) │    │                 │
  └──────────────┘   └──────────────┘    └─────────────────┘
```

---

## 3. File / Directory Layout (exact paths, create these)

```
apps/web/src/lib/iron/
├── IronShell.tsx                      # Root mount — avatar + bar + overlay + hotkeys
├── avatar/
│   ├── IronAvatar.tsx                 # Animated SVG character
│   ├── states.ts                      # idle|thinking|speaking|alert|listening
│   └── animations.ts                  # Lottie/framer-motion keyframes
├── bar/
│   ├── IronBar.tsx                    # Command palette overlay
│   ├── QuickActionList.tsx            # Default list of pinned flows
│   ├── FreeTextInput.tsx              # Type-or-speak input
│   └── ContextBadge.tsx               # "You're viewing Deal #8821" chip
├── flow/
│   ├── FlowEngine.tsx                 # Runtime: step state machine, slot filling, validation
│   ├── FlowOverlay.tsx                # Fullscreen-modal shell
│   ├── FlowStepRenderer.tsx           # Renders a single step based on type
│   ├── steps/
│   │   ├── TextStep.tsx               # "What's the customer name?"
│   │   ├── ChoiceStep.tsx             # Radio/chip picker
│   │   ├── EntityPickerStep.tsx       # Search and pick a customer/equipment/deal
│   │   ├── DatePickerStep.tsx         # Calendar
│   │   ├── NumberStep.tsx             # Integer/money input
│   │   ├── ReviewStep.tsx             # Summary + Confirm button
│   │   └── ResultStep.tsx             # "Done! Rental #R-4451 created [View]"
│   └── validators.ts                  # Shared slot validators
├── context/
│   ├── ContextEngine.ts               # Builds ambient context (page, entities, role)
│   └── entityScanner.ts               # Scrapes data-entity-id/type from DOM
├── voice/
│   ├── VoiceIO.ts                     # Web Speech STT + ElevenLabs TTS wrapper
│   ├── wakePhrase.ts                  # "Hey Iron" detection (optional, v1.1)
│   └── pushToTalk.ts                  # Spacebar long-press handler
├── memory/
│   ├── useIronMemory.ts               # Hook for recent entities, patterns
│   └── memoryClient.ts                # GET/POST to memory endpoint
├── intent/
│   ├── types.ts                       # IntentClassification, FlowDef, Slot
│   └── client.ts                      # POST to iron-orchestrator
├── flows/
│   ├── index.ts                       # Flow registry (imports all flows)
│   ├── startRental.ts                 # Declarative flow spec
│   ├── pullPart.ts
│   ├── startQuote.ts
│   ├── addCustomer.ts
│   ├── addEquipment.ts
│   ├── logServiceCall.ts
│   ├── processTradeIn.ts
│   ├── draftFollowUpEmail.ts
│   ├── checkArStatus.ts
│   └── findSimilarDeal.ts
└── __tests__/
    ├── FlowEngine.test.ts
    ├── ContextEngine.test.ts
    ├── validators.test.ts
    └── intent.test.ts

supabase/functions/iron-orchestrator/
├── index.ts                           # Main handler
├── classifyIntent.ts                  # LLM intent classification
├── resolveFlow.ts                     # Flow resolution + initial slot pre-fill
├── executeReadAnswer.ts               # For READ_ANSWER intents (RPC, SQL)
├── dispatchAgentic.ts                 # Forward to Paperclip CEO
├── memory.ts                          # Read/write iron_memory
└── safe-cors.ts                       # Import from ../_shared/safe-cors.ts

supabase/functions/iron-execute-flow-step/
└── index.ts                           # Per-step server-side execution (DB writes)

supabase/migrations/
└── 170_iron_companion.sql             # All iron_* tables, RLS, indexes, helpers

apps/web/src/assets/iron/
├── iron-idle.svg                      # Or .lottie
├── iron-thinking.svg
├── iron-speaking.svg
├── iron-alert.svg
└── iron-listening.svg
```

Mount `<IronShell />` in `apps/web/src/App.tsx` inside the auth-gated tree, as a sibling to `<FlareProvider>`. Both live at app shell level; neither can break the other.

---

## 4. The Avatar (the thing users see)

Iron is a **2D animated character** (not a photo, not a 3D model). Design brief: a friendly industrial-looking character — think hard-hat silhouette, gear-toothed halo, confident stance. **We generate this via a commissioned illustrator or a commissioned AI art pass, not at runtime.** Five static poses + 2–3 loop animations. Delivered as Lottie (`.lottie`) or layered SVG.

**Avatar states** (drive with `useIronState()`):

| State | Trigger | Visual |
|---|---|---|
| `idle` | default | Slow breathing loop, eyes blink every ~5s |
| `thinking` | LLM call in flight | Gear turns, subtle glow |
| `speaking` | TTS playing | Mouth lip-sync to audio waveform |
| `listening` | STT active | Ear animates, blue pulse ring |
| `alert` | Proactive nudge / unread suggestion | Small red dot + gentle attention-getter bob |
| `flow_active` | A flow is mid-run | Hard-hat glow, "on task" expression |

**Position:** bottom-right, `fixed`, `z-index: 9998` (Flare drawer is 9999 so bug reports always win). Draggable by the user (position persisted in localStorage). Snap-to-corner.

**Size:** 72×72px idle, scales up to 96×96 when active. Collapsible to a 24px chip via double-click if the user wants him out of the way.

**Accessibility:** every avatar state has an `aria-label`; the character is not required to use Iron — all actions are also reachable via `Cmd+K`. Motion-reduced mode disables the bob/breathe loops.

---

## 5. The Iron Bar (command palette)

Opens on: click avatar, `Cmd+K`, or voice "Hey Iron" (v1.1).

**Layout:**
```
┌────────────────────────────────────────────────────────┐
│  [Iron avatar]  Hey Speedy — what do you need?         │
│                                                        │
│  [🎤]  Type or speak...                         [↵]    │
│                                                        │
│  Context: Deal #8821 · Anderson Equipment · Stage 14   │
│                                                        │
│  ──────── Quick actions (pinned) ────────              │
│  ⚡ Start a rental                                     │
│  🔧 Pull a part                                        │
│  📋 Start a quote                                      │
│  👤 Add a customer                                     │
│  🚜 Add equipment                                      │
│  📞 Log a service call                                 │
│  💸 Process a trade-in                                 │
│  ✉️  Draft a follow-up email                          │
│  💰 Check AR status                                    │
│  🔍 Find a similar deal                                │
│                                                        │
│  ──────── Recent ────────                              │
│  • Rental R-4451 · started 2m ago                      │
│  • Quote Q-8120 · drafted yesterday                    │
│                                                        │
│  ──────── Suggestions ────────                         │
│  💡 This deal hasn't been touched in 6 days —          │
│     draft a follow-up email?                           │
└────────────────────────────────────────────────────────┘
```

**Behavior:**
- Autofocus on the input.
- Typing filters the quick actions AND performs real-time intent classification (debounced 300ms). If the text matches a flow with high confidence, show "Press ↵ to run **Start a rental**" hint below input.
- Pressing `↵` with text commits to the top-ranked action (flow OR read-answer OR agentic).
- `Esc` closes the bar.
- `↑↓` navigates quick actions and suggestions.
- Quick actions are pinned by default but user can reorder and pin their own (v1.1).
- Context badge is clickable → narrows all intent classification to that entity scope.

---

## 6. The Flow Engine (the real innovation)

### Flow definition (declarative, TypeScript)

```typescript
// apps/web/src/lib/iron/flow/types.ts

export interface FlowDef {
  id: string;                            // 'start_rental'
  label: string;                         // 'Start a rental'
  icon: string;                          // lucide icon name
  roles_allowed: IronRole[];             // RBAC
  trigger_phrases: string[];             // ["start a rental", "rent ", "new rental"]
  slots: FlowSlot[];                     // ordered step defs
  review: FlowReviewDef;                 // summary before mutation
  execute: FlowExecuteDef;               // the actual DB write(s)
  on_success: FlowSuccessDef;            // what to show + next actions
  estimated_duration_sec: number;        // for progress UI
}

export type FlowSlot =
  | { id: string; type: 'text'; label: string; required: boolean; validator?: string }
  | { id: string; type: 'number'; label: string; min?: number; max?: number; unit?: string }
  | { id: string; type: 'money'; label: string; currency: 'USD' }
  | { id: string; type: 'choice'; label: string; options: Array<{ value: string; label: string }> }
  | { id: string; type: 'entity'; label: string; entity: 'customer'|'equipment'|'deal'|'part'|'work_order'; filters?: Record<string, unknown> }
  | { id: string; type: 'date'; label: string; min?: 'today'|'tomorrow'; max?: string }
  | { id: string; type: 'date_range'; label: string }
  | { id: string; type: 'multi_entity'; label: string; entity: 'part'; allow_quantity: true };

export interface FlowReviewDef {
  title: string;
  template: string;                      // Mustache: "Rent {{equipment.name}} to {{customer.name}} for {{date_range.start}} to {{date_range.end}}"
}

export interface FlowExecuteDef {
  server_action: string;                 // name of server handler in iron-execute-flow-step
  // All mutations go through that function — NEVER from client directly.
}

export interface FlowSuccessDef {
  toast: string;
  next_actions: Array<{ label: string; flow_id?: string; url?: string }>;
}
```

### Flow runtime (client)

```typescript
// FlowEngine.tsx (pseudocode)

export function FlowEngine({ flowDef, initialSlots, onClose }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [slots, setSlots] = useState(initialSlots);
  const [isExecuting, setIsExecuting] = useState(false);

  const currentSlot = flowDef.slots[currentStep];
  const allSlotsFilled = currentStep >= flowDef.slots.length;

  async function advance(value: any) {
    // Validate
    const ok = validateSlot(currentSlot, value);
    if (!ok.valid) { showInlineError(ok.error); return; }
    setSlots({ ...slots, [currentSlot.id]: value });
    setCurrentStep(currentStep + 1);
  }

  async function execute() {
    setIsExecuting(true);
    const result = await ironClient.executeFlow(flowDef.id, slots);
    if (result.ok) {
      showSuccess(flowDef.on_success);
    } else {
      showError(result.error);
    }
    setIsExecuting(false);
  }

  if (allSlotsFilled && !isExecuting) {
    return <ReviewStep flowDef={flowDef} slots={slots} onConfirm={execute} onEdit={(stepId) => setCurrentStep(findStep(stepId))} />;
  }

  if (isExecuting) {
    return <ExecutingStep flowDef={flowDef} />;
  }

  return (
    <FlowStepRenderer
      slot={currentSlot}
      value={slots[currentSlot.id]}
      onSubmit={advance}
      onBack={() => setCurrentStep(Math.max(0, currentStep - 1))}
    />
  );
}
```

### Flow overlay UX

- Slides up from the bottom, covers the center of the screen with a dimmed backdrop.
- Height auto-grows with step content. Max 80vh.
- Top shows progress bar: `● ● ● ○ ○` (filled = completed, current = pulsing).
- Escape or backdrop click → "Save draft and close?" confirm prompt.
- Partial flow state persisted to `iron_flow_runs` on every slot change. Reload-safe: if user refreshes mid-flow, Iron detects open run on next Cmd+K and offers to resume.
- Voice mode: every step's question is spoken via ElevenLabs; user answers by voice (STT); confirmation always requires a click or a spoken "yes" (not passive).

### Hard rule: mutation always goes through `iron-execute-flow-step`

No flow step writes to Supabase directly from the client. The ReviewStep's Confirm button calls `POST /functions/v1/iron-execute-flow-step` with `{ flow_id, run_id, slots }`. The edge function:

1. Validates JWT + workspace + role.
2. Looks up the flow definition server-side (authoritative copy in `iron_flow_definitions`).
3. Re-validates every slot server-side.
4. Dispatches to the named `server_action` handler (e.g., `createRental`, `pullPart`).
5. Wraps in a Postgres transaction.
6. Writes audit row to `iron_flow_runs` with outcome.
7. Returns `{ ok: true, entity_id, entity_url }` or `{ ok: false, error }`.

**Clients cannot bypass this.** If a bug in the FE ever tried to hit Supabase directly, RLS would block it (because the iron flow tables are service-role-only).

---

## 7. The 10 v1 Flows (spec each one)

Each flow file in `apps/web/src/lib/iron/flows/` exports a `FlowDef` constant. Below is the shape Claude Code should build to. **Full slot lists + server actions listed for every flow.**

### 7.1 `startRental.ts`
- **Trigger phrases:** "start a rental", "new rental", "rent to", "rental agreement"
- **Slots:**
  1. `customer` (entity:customer) — pre-filled from page context if on a customer page
  2. `equipment` (entity:equipment, filter: availability='available') — pre-filled if on an equipment page
  3. `date_range` (date_range)
  4. `delivery_option` (choice: 'customer_pickup'|'we_deliver'|'we_deliver_and_pickup')
  5. `delivery_address` (text, required if delivery_option != customer_pickup, pre-fill from customer.address)
  6. `rate_period` (choice: 'daily'|'weekly'|'monthly', default from equipment.default_rate_period)
  7. `insurance_on_file` (choice: 'yes'|'request_coi') — if 'request_coi', auto-queue COI request email
- **Review template:** "Rent {{equipment.name}} to {{customer.name}} from {{date_range.start}} to {{date_range.end}} ({{rental_days}} days) at {{rate.amount}}/{{rate_period}}. Delivery: {{delivery_option}}. Total: {{total.formatted}}."
- **Server action:** `createRental` → inserts `rental_agreements`, `rental_agreement_lines`, updates `crm_equipment.availability='on_rent'`, optionally queues `email_drafts` row for COI request, optionally creates `delivery_jobs` row.
- **On success:** "Rental R-{{id}} created. [View agreement] [Send to customer for e-signature] [Schedule delivery]"

### 7.2 `pullPart.ts`
- **Trigger phrases:** "pull a part", "pull parts", "grab parts for", "pick list"
- **Slots:**
  1. `work_order` (entity:work_order, optional — if skipped, parts go to counter sale)
  2. `parts` (multi_entity:part, allow_quantity=true) — voice-friendly: "four 6T-4545 filters and two hydraulic hoses"
  3. `customer` (entity:customer, auto from work_order if present)
- **Review template:** "Pull {{parts.count}} items totaling {{total.formatted}} for {{work_order.number or customer.name}}."
- **Server action:** `pullParts` → decrements `parts_inventory.quantity_on_hand`, inserts `parts_transactions`, attaches to WO if present, generates pick ticket PDF.
- **On success:** "Pick ticket PPT-{{id}} created. [Print] [Mark pulled] [Attach to another WO]"

### 7.3 `startQuote.ts`
- **Trigger phrases:** "start a quote", "quote for", "new quote"
- **Slots:**
  1. `customer` (entity:customer) — pre-filled
  2. `equipment_items` (multi_entity:equipment, allow_quantity=true)
  3. `delivery_zip` (text, pattern: `^\d{5}$`) — used for tax jurisdiction lookup (Wave 5A.3)
  4. `finance_or_cash` (choice: 'cash'|'finance'|'rental_purchase_option'|'trade_in_involved')
  5. `notes` (text, optional)
- **Review:** summary with line items, subtotal, tax (from Wave 5A.3 tax-calculator), incentives auto-applied (Wave 5A.3), total.
- **Server action:** `createQuote` → inserts `quotes` + `quote_line_items` + runs quote-incentive-resolver.
- **On success:** "Quote Q-{{id}} drafted. [Open in builder] [Email to customer] [Convert to deal]"

### 7.4 `addCustomer.ts`
- **Slots:** name, phone, email (optional), company_type (individual|business), billing_address, default_branch.
- **Server action:** `createCustomer` → inserts `crm_companies` + `crm_contacts`.
- **On success:** "{{name}} added. [Open profile] [Start a quote for them] [Start a rental]"

### 7.5 `addEquipment.ts`
- **Slots:** make (entity:make or text), model, year, serial_number, category (choice), hours (number), branch_location, status (choice: owned_inventory|customer_owned|consigned).
- **Server action:** `createEquipment` → inserts `crm_equipment`.
- **On success:** "{{make}} {{model}} added as E-{{id}}. [Open record] [Add photos] [Put in inventory]"

### 7.6 `logServiceCall.ts`
- **Slots:** customer, equipment (filter to that customer), issue_description (text, voice-heavy), priority (choice: low|normal|high|down), preferred_date.
- **Server action:** `createServiceJob` → inserts `service_jobs`, routes to dispatcher queue.
- **On success:** "Service job SJ-{{id}} created. [View in dispatch board] [Notify customer] [Assign tech]"

### 7.7 `processTradeIn.ts`
- **Slots:** customer, incoming_equipment (text + make + model + year + hours + condition choice), requested_allowance (money), linked_deal (entity:deal, optional).
- **Server action:** `createTradeIn` → inserts `trade_ins` + links to deal if present + routes to Iron Advisor role for valuation signoff.
- **On success:** "Trade-in T-{{id}} logged. Awaiting valuation. [View] [Assign valuer]"

### 7.8 `draftFollowUpEmail.ts`
- **Slots:** deal_or_customer (entity picker), scenario (choice: 'check_in'|'budget_cycle'|'price_increase'|'tariff'|'requote'|'trade_up'|'custom'), tone (choice: 'warm'|'direct'|'urgent'), custom_notes (text, optional).
- **Server action:** calls `draft-email` edge function (Wave 5A.2) directly with the chosen scenario.
- **On success:** "Draft ready. [Review & edit] [Send]" — note: Iron NEVER sends email without explicit user click.

### 7.9 `checkArStatus.ts`
- **Slots:** customer (entity:customer) — pre-filled.
- **Type:** READ_ANSWER (no mutation).
- **Server action:** `queryArStatus` → returns current balance, aging buckets, last payment date, any active credit blocks.
- **On success (inline answer):** shows AR summary card with action buttons "[Place credit block] [Add payment plan] [Draft dunning email]"

### 7.10 `findSimilarDeal.ts`
- **Slots:** reference_deal (entity:deal) — pre-filled if on a deal page.
- **Type:** READ_ANSWER.
- **Server action:** `findSimilarDeals` → pgvector similarity query on deal embeddings (make/model/financing/customer type/region).
- **On success:** ranked list of 5 similar historical deals with "what we learned" notes per deal (taps institutional memory from the v2 roadmap).

---

## 8. Intent Router (`classifyIntent.ts` in edge function)

Single LLM call. Input: user text + context summary + flow registry metadata. Output: structured classification.

### Prompt shape

```
System: You are Iron, an expert operator for a heavy equipment dealership running QEP OS. Your job is to classify the user's request into exactly one of three categories:

1. FLOW_DISPATCH — the user wants to take an action that matches one of these flows: {{flow_list_with_trigger_phrases}}
2. READ_ANSWER — the user wants a fact, a list, or a status and no mutation is needed
3. AGENTIC_TASK — the user wants something that does not match any flow and requires multi-step reasoning (delegate to the pipeline)

Context: User role={{role}}. Current page={{route}}. Visible entities={{entities}}. Last 3 commands={{recent}}.

User said: "{{text}}"

Return JSON:
{
  "category": "FLOW_DISPATCH" | "READ_ANSWER" | "AGENTIC_TASK",
  "confidence": 0.0-1.0,
  "flow_id": string | null,
  "prefilled_slots": { ... } | null,
  "answer_query": string | null,
  "agentic_brief": string | null,
  "clarification_needed": string | null
}
```

### Model

Use `claude-haiku-4-5-20251001` for classification (fast, cheap, good enough). Fall back to `claude-sonnet-4-6` only if Haiku confidence < 0.7.

### Pre-fill example

User on a Deal page for Anderson Equipment says "rent the 320 excavator to them for 3 weeks."

Classification returns:
```json
{
  "category": "FLOW_DISPATCH",
  "confidence": 0.95,
  "flow_id": "start_rental",
  "prefilled_slots": {
    "customer": { "entity": "customer", "search": "Anderson Equipment", "needs_confirmation": true },
    "equipment": { "entity": "equipment", "search": "320 excavator", "needs_confirmation": true },
    "date_range": { "start": "2026-04-06", "end": "2026-04-27", "source": "relative:3 weeks" }
  }
}
```

Flow engine then shows the first unfilled slot (or review directly if everything is high-confidence pre-filled). User is always the gate on mutation.

---

## 9. Context Engine (`ContextEngine.ts`)

Builds a live `IronContext` object, updated on route change + every 5s while Iron Bar is open.

```typescript
interface IronContext {
  user: { id; email; role; iron_role; workspace_id };
  page: { url; route; title };
  visible_entities: Array<{ type: 'deal'|'customer'|'equipment'|'quote'|'service_job'; id: string; label: string }>;
  recent_entities_24h: Array<{ type; id; label; last_touched_at }>;  // from iron_memory
  active_flow_run: { id; flow_id; step; slots } | null;
  last_commands: string[];                                            // last 5 Iron commands
  feature_flags: Record<string, boolean>;
}
```

Scanner reuses the same `data-entity-id` / `data-entity-type` DOM attribute convention as Flare (Wave 6.11 §4). QEP engineers must decorate key pages with these attrs; if you're touching a deal page in a PR, you add `data-entity-id={deal.id} data-entity-type="deal"` to the root container. This is a 5-minute repo-wide PR — add to Wave 7 kickoff checklist.

---

## 10. Voice I/O

### STT (speech-to-text)
- **v1:** browser Web Speech API (`webkitSpeechRecognition`). Free, on-device, no latency.
- **v1.1:** upgrade to ElevenLabs STT or Deepgram for noisy shop environments.
- **Trigger:** microphone button in IronBar, or push-to-talk spacebar long-press while Iron is focused, or `Cmd+Shift+K` to start voice session directly.

### TTS (text-to-speech)
- **v1:** ElevenLabs (Speedy already has an account). Voice ID configurable in `iron_settings.voice_id`. Default to a confident, clear voice.
- **Usage:** TTS plays flow step prompts, success confirmations, and read-answer responses. **Never auto-plays on first load** — user must click mic once or speak wake word to enable audio. Browsers block autoplay.

### Wake word (v1.1 only)
- "Hey Iron" via Picovoice Porcupine (on-device, free tier). Opt-in per user.

### Voice privacy
- Microphone is NEVER open except while user is actively in a flow step with `input_mode='voice'` or while push-to-talk is held.
- All STT happens in-browser in v1; no audio is streamed to a server.
- TTS audio is generated server-side, cached per-phrase in Cloudflare R2 for 7 days to cut ElevenLabs cost.

---

## 11. Iron Memory

Lightweight pgvector-backed recent-entity + pattern store.

### Tables (in migration 170)

```sql
create table iron_memory (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null check (memory_type in ('recent_entity','shortcut','preference','pattern')),
  entity_type text,
  entity_id uuid,
  content jsonb not null,
  embedding vector(1536),
  last_accessed_at timestamptz not null default now(),
  access_count integer not null default 1,
  created_at timestamptz not null default now()
);

create index idx_iron_memory_user_type on iron_memory (user_id, memory_type, last_accessed_at desc);
create index idx_iron_memory_embedding on iron_memory using ivfflat (embedding vector_cosine_ops);
```

### What gets remembered
- Every entity the user touched in the last 24h (for Cmd+K autocomplete).
- Every flow the user successfully completed (for "pinned quick action" auto-ranking).
- Time-of-day patterns (seed for v1.1 proactive mode).
- User preferences ("Speedy always picks 'we_deliver' for rentals" → auto-select that default after 5 repetitions).

### Privacy
- Memory is per-user, never shared across users, enforced by RLS.
- Never stores PII beyond entity IDs — labels are re-fetched from source tables at render time.
- 90-day rolling retention; older rows auto-deleted nightly.

---

## 12. Migration 170 — `supabase/migrations/170_iron_companion.sql`

```sql
-- Wave 7 Iron Companion

create extension if not exists vector;

-- Session log (one row per Cmd+K session)
create table iron_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  input_mode text check (input_mode in ('type','voice','click')),
  context_snapshot jsonb,
  created_at timestamptz not null default now()
);

-- Individual messages / commands within a session
create table iron_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references iron_sessions(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','iron')),
  content text not null,
  classification jsonb,
  flow_run_id uuid,
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- Flow definitions (authoritative server copy — clients cannot override)
create table iron_flow_definitions (
  id text primary key,                        -- 'start_rental'
  label text not null,
  version integer not null default 1,
  definition jsonb not null,                  -- full FlowDef as JSON
  roles_allowed text[] not null,
  server_action text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Flow run audit trail — one row per flow invocation
create table iron_flow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references iron_sessions(id) on delete set null,
  flow_id text not null references iron_flow_definitions(id),
  flow_version integer not null,
  status text not null default 'in_progress'
    check (status in ('in_progress','awaiting_review','executing','completed','failed','abandoned')),
  slots jsonb not null default '{}'::jsonb,
  current_step integer not null default 0,
  result_entity_type text,
  result_entity_id uuid,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  input_mode text
);

create index idx_iron_flow_runs_user_status on iron_flow_runs (user_id, status, started_at desc);
create index idx_iron_flow_runs_flow on iron_flow_runs (flow_id, status, started_at desc);

-- Memory
create table iron_memory (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null check (memory_type in ('recent_entity','shortcut','preference','pattern')),
  entity_type text,
  entity_id uuid,
  content jsonb not null,
  embedding vector(1536),
  last_accessed_at timestamptz not null default now(),
  access_count integer not null default 1,
  created_at timestamptz not null default now()
);

create index idx_iron_memory_user_type on iron_memory (user_id, memory_type, last_accessed_at desc);
create index idx_iron_memory_embedding on iron_memory using ivfflat (embedding vector_cosine_ops);

-- Per-user settings
create table iron_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id),
  voice_enabled boolean not null default false,
  voice_id text default 'default',
  wake_phrase_enabled boolean not null default false,
  pinned_flows text[] not null default array['start_rental','pull_part','start_quote','add_customer','add_equipment','log_service_call','process_trade_in','draft_follow_up_email','check_ar_status','find_similar_deal'],
  avatar_position jsonb default '{"x":"right","y":"bottom"}'::jsonb,
  avatar_collapsed boolean not null default false,
  proactive_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table iron_sessions enable row level security;
alter table iron_messages enable row level security;
alter table iron_flow_definitions enable row level security;
alter table iron_flow_runs enable row level security;
alter table iron_memory enable row level security;
alter table iron_settings enable row level security;

-- Sessions / messages / runs / memory — user can read their own, service role handles writes
create policy iron_sessions_self_read on iron_sessions for select
  using (workspace_id = get_my_workspace() and user_id = auth.uid());
create policy iron_sessions_service_all on iron_sessions for all to service_role using (true) with check (true);

create policy iron_messages_self_read on iron_messages for select
  using (workspace_id = get_my_workspace() and user_id = auth.uid());
create policy iron_messages_service_all on iron_messages for all to service_role using (true) with check (true);

create policy iron_flow_runs_self_read on iron_flow_runs for select
  using (workspace_id = get_my_workspace() and user_id = auth.uid());
create policy iron_flow_runs_service_all on iron_flow_runs for all to service_role using (true) with check (true);

create policy iron_memory_self_all on iron_memory for all
  using (workspace_id = get_my_workspace() and user_id = auth.uid())
  with check (workspace_id = get_my_workspace() and user_id = auth.uid());

-- Flow definitions — everyone in workspace can READ, only service role writes
create policy iron_flow_definitions_read on iron_flow_definitions for select
  using (is_active = true);
create policy iron_flow_definitions_service_all on iron_flow_definitions for all to service_role using (true) with check (true);

-- Settings — user owns their own
create policy iron_settings_self on iron_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Triggers
create trigger trg_iron_flow_definitions_updated_at before update on iron_flow_definitions
  for each row execute function set_updated_at();
create trigger trg_iron_settings_updated_at before update on iron_settings
  for each row execute function set_updated_at();

-- Memory retention cleanup (run from pg_cron nightly)
create or replace function iron_memory_cleanup() returns void language plpgsql as $$
begin
  delete from iron_memory where last_accessed_at < now() - interval '90 days';
end;
$$;

-- Seed the 10 v1 flows (rows are populated in a separate seed script from the apps/web flow files,
-- run as part of the deploy — see Wave 7 kickoff checklist)

comment on table iron_flow_runs is
  'Wave 7 Iron: audit trail of every flow invocation. Source of truth for what mutations were made and by whom.';
```

Rollback: `170_iron_companion_rollback.sql` drops all `iron_*` tables + the memory cleanup function.

---

## 13. Edge Functions

### `supabase/functions/iron-orchestrator/index.ts`

- **Route:** `POST /functions/v1/iron-orchestrator`
- **Auth:** JWT required.
- **Body:**
  ```json
  {
    "session_id": "uuid-or-null-for-new",
    "input_mode": "type|voice|click",
    "text": "rent the 320 to Anderson for 3 weeks",
    "context": IronContext
  }
  ```
- **Response:**
  ```json
  {
    "session_id": "...",
    "message_id": "...",
    "category": "FLOW_DISPATCH|READ_ANSWER|AGENTIC_TASK",
    "flow_id": "start_rental",
    "flow_def": { ... },
    "prefilled_slots": { ... },
    "answer": null,
    "clarification": null,
    "paperclip_issue_id": null
  }
  ```
- **Steps:**
  1. Resolve/create session row.
  2. Write user message row.
  3. Call Claude Haiku with intent-classification prompt (§8).
  4. If FLOW_DISPATCH: resolve slot entities (SQL search against candidate entity tables), return flow def + pre-filled slots.
  5. If READ_ANSWER: execute the read (typed dispatch map, no SQL injection), return answer inline.
  6. If AGENTIC_TASK: POST to Paperclip CEO endpoint with brief + context, return tracking ID.
  7. Write iron message row (role='iron').
  8. Update iron_memory (recent_entities, access patterns).
  9. Return response.

### `supabase/functions/iron-execute-flow-step/index.ts`

- **Route:** `POST /functions/v1/iron-execute-flow-step`
- **Auth:** JWT required.
- **Body:**
  ```json
  {
    "run_id": "uuid",
    "flow_id": "start_rental",
    "slots": { ... }
  }
  ```
- **Steps:**
  1. Load `iron_flow_runs` row, verify user + workspace.
  2. Load `iron_flow_definitions` for authoritative version.
  3. Server-side slot re-validation (never trust client).
  4. Authorize: user role must be in `flow_def.roles_allowed`.
  5. Dispatch to typed handler map:
     ```typescript
     const handlers = {
       createRental, pullParts, createQuote, createCustomer,
       createEquipment, createServiceJob, createTradeIn,
       draftEmailViaFunction, queryArStatus, findSimilarDeals,
     };
     ```
  6. Wrap in PG transaction; on failure, rollback + record error on run row.
  7. On success, mark run completed, write memory entry, return `{ ok, entity_id, entity_url }`.

Zero-blocking: if any downstream service (e.g., tax-calculator, draft-email) is down, the handler returns a partial success with a follow-up action queued. Never silent data loss.

---

## 14. Environment Variables

```
# Edge function secrets
OPENAI_API_KEY=                      # optional fallback
ANTHROPIC_API_KEY=                   # primary for intent classification (Haiku)
ELEVENLABS_API_KEY=                  # TTS
PAPERCLIP_API_KEY=                   # agentic fallback
PAPERCLIP_BASE_URL=

# Frontend (public)
VITE_IRON_ENABLED=true
VITE_IRON_VOICE_DEFAULT_ID=          # ElevenLabs voice ID
```

---

## 15. Package Dependencies

```json
{
  "dependencies": {
    "framer-motion": "^11.0.0",
    "@lottiefiles/dotlottie-react": "^0.6.0",
    "cmdk": "^1.0.0",
    "fuse.js": "^7.0.0"
  }
}
```

`framer-motion` for avatar + overlay animation, `@lottiefiles/dotlottie-react` for the character, `cmdk` for the command palette baseline (we wrap it), `fuse.js` for client-side fuzzy matching of quick actions.

---

## 16. Test Plan

### Unit
- `FlowEngine.test.ts` — slot validation, back/next navigation, reload-resume, review-then-edit.
- `validators.test.ts` — every slot type's validator (money min/max, date range order, regex patterns).
- `ContextEngine.test.ts` — entity scraping, 5s refresh behavior, memory merge.
- `intent.test.ts` — mock Haiku classifier, verify routing to FLOW/READ/AGENTIC.

### Integration
- Start a flow, fill all slots, confirm review, verify edge function call, verify DB row created, verify success toast.
- Start a flow, abandon mid-way, reload page, verify Iron offers resume, verify state restored.
- Trigger a READ_ANSWER, verify inline answer renders with source citations.
- Trigger an AGENTIC_TASK, verify Paperclip issue created, verify tracking card shown.

### E2E
- Cmd+K on 10 different pages; verify bar opens, context badge shows correct entity.
- Voice flow: mic click → speak "start a rental for Anderson" → flow pre-fills customer → verify flow advances.
- Rate limit: fire 50 intent classifications in a minute → verify 429 + graceful throttle.

### Security
- Client cannot bypass `iron-execute-flow-step` (try direct Supabase insert, expect RLS fail).
- User in role 'rep' cannot run a flow with `roles_allowed: ['manager','owner']`.
- Memory RLS: user A cannot read user B's iron_memory rows.

### Manual smoke
- End-to-end rental creation via voice on a phone browser in a noisy shop.
- End-to-end parts pull with multi-part voice input ("four 6T-4545 and two 9T-1010").
- End-to-end quote with tax + incentives auto-apply (depends on Wave 5A.3 being live).

---

## 17. Build Gate (per CLAUDE.md §Build and Release Gates)

1. `bun run migrations:check` — migration 170 applies + rolls back cleanly.
2. `bun run build` (repo root).
3. `bun run build` in `apps/web`.
4. `bun run test` — all iron/__tests__ green.
5. Edge function contract tests for iron-orchestrator + iron-execute-flow-step.
6. RLS check on all 6 new tables.
7. Zero-blocking check: with ANTHROPIC_API_KEY cleared, Iron gracefully disables LLM features and still allows direct quick-action clicks.
8. Mission check: hotkey works, 10 v1 flows all complete end-to-end on staging.

---

## 18. Pipeline Routing (Paperclip handoff)

| Agent | Deliverable |
|---|---|
| **Architect** | Review §§1–7, confirm flow DSL schema, approve server handler contract in §13 |
| **Data & Integration** | Migration 170, seed iron_flow_definitions rows from flow files, pgvector extension verify |
| **Engineer (BE)** | iron-orchestrator + iron-execute-flow-step + the 10 server-action handlers |
| **Engineer (FE)** | IronShell, Avatar, Bar, FlowEngine, FlowOverlay, steps, voice I/O, memory hook |
| **Engineer (Design)** | Commission or design the Iron avatar asset (5 states, Lottie delivery) |
| **Security** | Audit RLS policies, mutation gate, memory isolation, voice privacy, LLM prompt injection defense in the classifier |
| **QA** | Execute §16 test plan |
| **DevOps** | Deploy migration, edge functions, seed flows, set secrets, end-to-end smoke on staging |
| **Quality Review** | Verify DoD per §17 |

Estimated effort: **~18 engineer-days**. Splits as ~7 FE, ~6 BE, ~1 migration, ~2 design (avatar), ~2 QA. Parallelizable to ~8 calendar days with FE + BE + Data working simultaneously.

---

## 19. Dependencies on Prior Waves

- **Wave 5A.2 (draft-email edge function):** required for `draftFollowUpEmail` flow.
- **Wave 5A.3 (tax-calculator + incentive resolver):** required for `startQuote` flow tax/incentive auto-apply.
- **Wave 5C (nervous system + health score + AR blocking):** `checkArStatus` flow depends on the AR query RPC.
- **Wave 6.11 (Flare):** shared ring buffers and entity scanner are reused by the Context Engine.

If any of these haven't shipped when Wave 7 starts, stub the corresponding handler to return `{ ok: false, reason: 'dependency_not_ready', fallback_url: '/original/page' }` and the flow gracefully degrades to "take me to the classic page."

---

## 20. Definition of Done

- [ ] Migration 170 deployed to staging + production.
- [ ] pgvector extension enabled.
- [ ] All 10 v1 flows complete end-to-end on staging.
- [ ] Iron avatar renders, has 5 states, is draggable, remembers position.
- [ ] Cmd+K summons the bar on every page including inside modals.
- [ ] Voice mode works: mic click → STT → flow → TTS confirmation.
- [ ] Reload mid-flow resumes correctly.
- [ ] Pre-fill from page context works: on a deal page, "start a rental" pre-fills customer.
- [ ] iron-execute-flow-step rejects direct client writes (RLS proven).
- [ ] Zero-blocking: with all external APIs down, Iron still opens, quick actions still run classic routes.
- [ ] Mission check signed off by Speedy.

---

**End of Wave 7 Iron Companion build spec.**

This is the flagship. Ship the foundation, then watch every operator workflow in QEP OS collapse from "find the page, fill the form, click save" into "press Cmd+K, talk, confirm, done."
