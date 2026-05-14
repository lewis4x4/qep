# Iron Agent Quote Intake Architecture

## Target Behavior Principles
- **Iron as the Desk Assistant:** Iron acts as a trainer, manager, and admin assistant for desk personnel. It understands the context of the workflow rather than acting as a simple command-line redirect or search box.
- **Natural Language Competence:** Sales reps can use messy, natural-language requests (e.g., "start a quote for big oak underbrushing with a CTL and mulcher"). Iron must preserve the full spoken context, separating the work/equipment request from the customer name.
- **Contextual Handoff:** Iron identifies the intent, asks the right questions if necessary, and starts the workflow in the right place. For quote intake, it seeds the Quote Builder with the raw intake notes and customer identity, preventing the rep from starting with a blank page.

## Quote Intake Ideal Flow
1. **Intent Detection:** The user provides text or voice input via the Iron interface (`IronBar.tsx`). The system locally parses action-oriented quote phrases (e.g., "start," "build," "create") while allowing informational queries (e.g., "show pending quotes") to fall through to the Iron Knowledge service.
2. **Context Extraction & Customer Resolution:** The intake module extracts target terms and uses them to generate CRM customer search candidates. It performs a best-effort customer match without blocking the primary flow if a strict match isn't found.
3. **Durable Handoff Persistence:** A structured handoff payload (containing the raw text, resolved CRM IDs, and search queries) is securely written to short-lived local storage (`sessionStorage`), keyed by a unique handoff ID. 
4. **Hydrated Quote Builder Launch:** The user is deterministically navigated to Quote Builder (`/quote-v2`) with the handoff ID as a URL parameter. The Quote Builder (`QuoteBuilderV2Page.tsx`) intercepts this ID, reads the handoff payload, and seeds the draft state (customer fields and `voiceSummary` intake notes) for the rep to verify before configuring equipment.

## Guardrails & Failure Behavior
- **Graceful Customer Search Failure:** If customer search yields no results or throws a network error, Iron still writes the handoff payload and navigates to the Quote Builder. The user receives a message such as, "Opening Quote Builder with your quote intake notes," ensuring the process is never blocked by flaky mobile networks.
- **Deterministic Routing Over Edge Functions:** To avoid mobile network drops and auth refresh timing issues (`iron-orchestrator` / `iron-knowledge`), quote creation commands bypass the server-side AI stream and execute entirely on the frontend.
- **State Protection:** The handoff hydration logic is strictly gated. It will not overwrite an existing saved quote, a deep-linked deal, or a populated local draft.
- **PII Safety:** Quote handoff payloads are strictly maintained in `sessionStorage` (not `localStorage`) with a max-age limit to ensure temporary customer data is destroyed alongside the active tab session.

## Phased Implementation Slices

**Phase 1: Deterministic Frontend Handoff (Current Focus)**
- Build pure, stateless TypeScript utility modules (`quote-intake.ts`) for natural-language intent detection and candidate generation.
- Implement short-lived handoff storage (`iron-quote-handoff.ts`).
- Route matching intents in `IronBar.tsx` directly to the Quote Builder, bypassing brittle edge-function AI streaming.
- Hydrate the new draft in `QuoteBuilderV2Page.tsx` with the handoff IDs and raw intake text.

**Phase 2: Auth & Streaming Stabilization**
- Centralize session refresh logic (`auth.ts`) across both the standard API invocation path and the `useIronKnowledgeStream` path, resolving edge-case HTTP 401/403 errors on mobile.

**Phase 3: Conversational Slot Filling (Future Slices)**
- Once the deterministic frontend handoff is proven, introduce a true `start_quote` backend flow in `iron-flows.ts`.
- Allow Iron to engage in multi-turn qualification dialogues (asking clarifying questions about equipment options or timeframe) via `iron-orchestrator` before dispatching the final slot-filled payload to Quote Builder.