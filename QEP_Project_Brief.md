# QEP USA — BlackRock AI Platform Project Brief

_Last updated: 2026-04-07_

## 1. Client Overview

**Company:** Quality Equipment & Parts, Inc. (QEP USA)
**Location:** Lake City, Florida
**Founded:** 1986 (dealer for 22+ years)
**Type:** Family-owned heavy equipment dealership, multi-branch
**Industries Served:** Forestry, logging, land clearing, tree care, compact construction, recycling, grapple trucks
**Brands Carried (22+):** Barko, Bandit, Prinoth, ASV, Yanmar, Serco, Shearex, Lamtrac, CMI, and others

## 2. Key Contacts

| Name | Role | Notes |
|---|---|---|
| **Rylee McKenzie** (male) | Sales & Marketing Manager | Primary contact. Active emailer. Has budget influence. **Hates AI-sounding writing** — all client comms must sound human. Asked technical questions about cost, interface, intelligence, security. |
| **Riley** (last name unknown) | Ownership / senior leadership | Brian's childhood friend (little league coach). Strategic relationship asset. Role/title still to be confirmed. |

> **Critical:** Riley ≠ Rylee. Two different people. Never confuse them.

## 3. Current Tech Stack at QEP

| System | Platform | Status |
|---|---|---|
| CRM | HubSpot (with Breeze AI) | Active — REST API ready |
| DMS | IntelliDealer (VitalEdge Technologies) | Active — **API access UNCONFIRMED** |
| Documents | Microsoft OneDrive | Active — confirmed by client |
| SMS | VitalEngage (IntelliDealer native) | Active — no AI layer yet |

**IntelliDealer API is the single most important unknown.** Third-party integrations (FileBound, TARGIT) prove an API exists, but QEP must connect BlackRock AI with their VitalEdge account rep before any inventory/quoting work begins.

**HubSpot Breeze** is already in use — build around it, never against it.

## 4. The Four Core Problems We're Solving

1. Sales reps lose face-time to desk work (proposals, spec lookups, rental contracts, manufacturer program research).
2. Sales admin is buried in warranty activations, invoice closing, financing support, and inventory — can't absorb sales overflow.
3. Every employee interrupts managers for PTO, benefits, and process answers. Inconsistent execution.
4. Ownership has zero real-time visibility into pipeline, margin, or rep activity.

## 5. The Build — 4 Modules

### Module 1 — Company Knowledge Assistant ✅ READY TO BUILD
- RAG over QEP internal docs (handbook, SOPs, PTO, benefits, specs)
- Serves **all** employees, not just sales
- Live OneDrive sync via Microsoft Graph API
- Source citation on every answer
- **No API dependencies** — first to ship
- Demo possible within 1 week of doc receipt

### Module 2 — Field Quote Builder + Proposal Generator ⛔ GATED
- Mobile-first: rep selects machine + attachments + options → branded PDF on-site
- Rental contract auto-fill + e-signature
- Manufacturer incentives surfaced automatically
- **Blocked until IntelliDealer API confirmed**

### Module 3 — HubSpot Follow-Up Automation
- Auto-triggered sequences after every quote
- Stalled-deal alerts to manager
- Rep activity logging
- Complements Breeze; HubSpot REST API ready

### Module 4 — Voice-to-CRM Field Capture
- Rep speaks 60-sec field summary → AI transcribes + extracts → pushes to HubSpot
- Auto-schedules follow-up
- Mobile browser, no app install

### Future Modules (not yet pitched)
HeyGen video follow-up · Customer equipment health portal · AI marketing engine (Rylee's domain) · Used equipment listing generator (IntelliDealer → website + Machinery Pete / IronPlanet) · AI SMS layer over VitalEngage · Parts lookup + upsell · Service-to-sales upgrade alerts · Manager deal coaching dashboard · Owner pipeline dashboard + forecasting

## 6. Tech Stack (Build)

```
Frontend:     React 18, TypeScript (strict), Tailwind v4, shadcn/ui
Backend:      Supabase (PostgreSQL, Edge Functions, Auth, Storage, RLS)
Hosting:      Netlify (CI/CD via GitHub)
AI:           Anthropic Claude API (claude-sonnet-4-6)
Voice:        Whisper or equivalent (Module 4)
Integrations: Microsoft Graph, IntelliDealer REST, HubSpot REST, DocuSign
Platform URL: qep.blackrockai.co (proposed)
```

## 7. Commercial Model

**Value-based pricing — build first, client assigns value after 90-day pilot.**

- Phase 1 estimated range: **$18,000–$28,000** (varies on IntelliDealer API access)
- Monthly infra: **$400–$900/month** (pass-through, no markup)
- Phases 2 & 3 priced separately after Phase 1 validation

Brian's rationale: build credibility and a case study; confident the work commands premium valuation. Do not revert to fixed-price framing.

## 8. Security Posture

- Anthropic Claude API — data **not** used for model training (explicit policy)
- Dedicated infra, not shared
- All data in transit encrypted
- Role-based access: rep / admin / manager / owner
- QEP has cyber insurance — carrier should verify AI tools are covered
- BlackRock AI provides data-handling docs for carrier review

## 9. Breeze vs BlackRock AI Positioning

**What Breeze does well:** email drafting, prospecting agent, predictive lead scoring, native HubSpot integration.

**Where Breeze fails for QEP:** zero IntelliDealer access · no proposal/document generation · knowledge vault built for help desks not dealerships · doesn't serve parts/service/admin · no voice-to-CRM · no rental/document automation · no manufacturer program awareness.

> "Breeze is a feature inside your CRM. We build the AI layer across your entire operation — HubSpot, IntelliDealer, your manufacturer catalog, your SOPs, and your whole team."

## 10. Open Action Items

**BLOCKING**
- [ ] QEP to connect BlackRock AI with VitalEdge/IntelliDealer account rep
- [ ] Rylee to send: employee handbook, SOPs, process docs, PTO/benefits summary

**NON-BLOCKING**
- [ ] Rylee to confirm cyber insurance covers AI tools
- [ ] Confirm Riley's exact role/title/authority
- [ ] Schedule 30-min call with Rylee (and Riley if available)
- [ ] Confirm preferred platform branding/subdomain
- [ ] Confirm financing partners (AgDirect suspected)

**PIPELINE**
- [ ] Docs received → knowledge assistant demo (target: 1 week)
- [ ] IntelliDealer API confirmed → scope Module 2 in detail
- [ ] 90-day pilot complete → value conversation + contract

## 11. Conversation History

1. Inbound call — Rylee/Riley flagged AI opportunity in sales
2. Brian sent discovery questions email
3. QEP confirmed HubSpot + IntelliDealer stack, described 3 core problems
4. Brian sent personal email to Riley — pain points + rapid-fire solutions
5. Brian sent Breeze vs BlackRock AI one-pager (.docx)
6. Rylee responded with 4 technical questions (cost, interface, brain, security)
7. Brian sent value-based offer — build first, pay after 90-day pilot
8. **Current state:** awaiting QEP response to value-based offer

## 12. Project Rules

1. Never generate AI-sounding client communication. Rylee will notice.
2. Riley ≠ Rylee. Always verify which contact.
3. IntelliDealer is gated. Don't scope/build Module 2 until API is confirmed.
4. Don't compete with Breeze — position as complementary.
5. OneDrive is confirmed — use Microsoft Graph API.
6. Value-based pricing is intentional. Don't revert to fixed-price.
7. Match Brian's voice: direct, casual, no fluff.
8. Riley relationship is a strategic asset — handle with care.
