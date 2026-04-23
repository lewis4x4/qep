# The Floor — Visual Language

**Purpose:** A build-ready spec for the most beautiful dealership dashboard in the industry. Every decision below is a constraint; every constraint exists because the alternative adds density or lowers contrast or dilutes the brand.

**Core idea:** *Cockpit meets forge.* Rugged and precise. Never corporate. Never playful. The Floor is what a dealership's control tower would look like if you built it from scratch in 2026.

---

## 1. Layout anatomy

```
┌────────────────────────────────────────────────────────────────┐
│ [QEP] The Floor           Rylee McKenzie · Sales Manager   ⏻   │  <-- Top bar (56px)
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Three quotes waiting approval. One stale deal. Acme cleared.   │  <-- Narrative strip (48px)
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │             │  │             │  │             │              │
│  │ NEW QUOTE   │  │ APPROVALS   │  │ PIPELINE    │              │  <-- Quick-action hero (140px)
│  │             │  │             │  │             │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │ Approval queue   │  │ Pipeline by rep  │                     │
│  │                  │  │                  │                     │
│  │ [widget body]    │  │ [widget body]    │                     │  <-- Widget grid (max 6)
│  └──────────────────┘  └──────────────────┘                     │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │ Aging fleet      │  │ Commission MTD   │                     │
│  │                  │  │                  │                     │
│  │ [widget body]    │  │ [widget body]    │                     │
│  └──────────────────┘  └──────────────────┘                     │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│   online · synced 14s ago                        Office view →  │  <-- Footer (36px)
└────────────────────────────────────────────────────────────────┘
```

**Total zones:** 5. Top bar, narrative, hero, grid, footer. Nothing else. No left nav on The Floor v1 — if you need another module you tap through the top bar or a quick action.

## 2. Color tokens

Locked to the QEP brand guide. Single-accent discipline — only one orange, only on what matters.

```css
:root {
  /* Base */
  --qep-charcoal:    #111111;  /* primary background */
  --qep-surface:     #1a1a1a;  /* card/widget base */
  --qep-surface-2:   #242424;  /* raised elements, hover, input bg */
  --qep-divider:     #2a2a2a;  /* hairline borders */

  /* Accent — orange is sacred */
  --qep-orange:      #F28A07;  /* primary action, hero buttons, key metric */
  --qep-orange-hover:#FFA02E;  /* +10% luminance for hover */
  --qep-orange-soft: #F28A07cc; /* 80% alpha — used for pulse glows only */

  /* Type */
  --qep-white:       #FFFFFF;  /* display + primary text on dark */
  --qep-gear-gray:   #BFBFBF;  /* secondary text, icons */
  --qep-muted:       #707070;  /* tertiary, disabled */

  /* Support */
  --qep-brown:       #2A2421;  /* rugged texture accents */

  /* Semantic (sparse — avoid painting statuses by default) */
  --floor-emerald:   #10b981;  /* healthy / done */
  --floor-rose:      #f43f5e;  /* error / blocked (RESERVED — rare) */
  --floor-amber:     #f59e0b;  /* warning (RESERVED — rare) */
}
```

**Rule of thumb:** if you're reaching for a color that isn't charcoal, gray, white, or orange — you're introducing chrome. Justify it.

## 3. Typography scale

Three typefaces. No italics anywhere on The Floor. No condensed fonts except Bebas Neue for display.

| Role | Typeface | Weight | Size | Transform | Usage |
|---|---|---|---|---|---|
| **Display** | Bebas Neue | 700 | 48–96pt | UPPERCASE | Hero button labels, big-number displays, section titles |
| **Subhead** | Montserrat | 800 | 18–24pt | UPPERCASE | Secondary headings, widget KPI labels |
| **Body** | Inter | 400–600 | 12–15pt | sentence | All prose, widget content, form labels |
| **KPI number** | Montserrat | 700 | 36–72pt | tabular-nums | Win probability %, deal count, dollar amounts |
| **Label** | Inter | 600 | 10–11pt | UPPERCASE, letter-spacing 0.14em | Widget headers, section labels |

**Loading:** Use `@fontsource/bebas-neue`, `@fontsource/montserrat`, `@fontsource/inter`. No Google Fonts CDN (per brand guide + handoff ADR-style privacy).

## 4. Spacing — 8pt grid

Every margin, padding, gap is a multiple of 4px. Primary rhythm is 8px.

| Token | Value |
|---|---|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px (default widget padding) |
| `space-6` | 24px (widget gap) |
| `space-8` | 32px (section gap) |
| `space-12` | 48px (zone gap) |

**Widget radius:** 12px (`rounded-xl`). Zone radius: 0 — zones are full-bleed bands.

## 5. Top bar — the identity row

- **Height:** 56px fixed.
- **Left:** Small QEP gear mark (orange, 24×24px), followed by "The Floor" in Bebas Neue 16pt white.
- **Right:** user name in Inter 14 semibold white, then a faint divider, then role label in Inter 12 `--qep-gear-gray` UPPERCASE, then a small sign-out icon.
- **Background:** `--qep-surface` with a 1px bottom border of `--qep-divider`.
- **No nav links here in v1.** The Floor is a landing page, not a navigation chrome.

## 6. Narrative strip — one sentence, always

- **Height:** 48px fixed.
- **Content:** A single sentence, generated server-side at dawn + on-demand refresh.
  - Inter 15 semibold `--qep-white`
  - Preceded by a tiny orange dot (6×6px `--qep-orange`) pulsing on a 2.5s cycle if the sentence is fresh (<15 min)
  - Truncate with ellipsis after one line — details live in widgets
- **Background:** `--qep-charcoal` (same as page), with `--qep-divider` top + bottom hairlines.
- **Fallback copy when there's nothing interesting:** "No open approvals. Pipeline is calm. You're caught up." (no filler, no emoji, no exclamation)

## 7. Quick-action hero — 2 or 3 buttons, no more

- **Height:** 140px total. Buttons: 100px tall, 16px gap between them.
- **Layout:** `flex gap-4` — 2 on mobile, 3 on desktop.
- **Button style:**
  - Background: `--qep-surface-2`, 1px border `--qep-divider`
  - **Primary action** gets the orange accent: 4px left-rule in `--qep-orange`
  - On hover: border becomes `--qep-orange`, transform scale 1.01, 150ms ease-out
  - On active: scale 0.99, 80ms ease-out
  - Icon: Lucide 32×32 in `--qep-orange` for primary, `--qep-white` for others
  - Label: Bebas Neue 20pt UPPERCASE `--qep-white`, letter-spacing 0.04em
  - Sub-label (optional): Inter 11 semibold `--qep-gear-gray`

Example: *Juan's primary action*

```
  ┌──────────────────────┐
  │ ▐                    │   ← orange left-rule
  │ ▐  ⚡                 │
  │ ▐                    │
  │ ▐  NEW PARTS QUOTE   │   ← Bebas Neue
  │ ▐  Start from serial │   ← Inter 11 gear-gray
  │                      │
  └──────────────────────┘
```

## 8. Widget cards — the ruggedly-beautiful unit

Widget frame (one component, reused for all 14+ registered widgets via a new `FloorWidget` wrapper):

- **Background:** `--qep-surface`
- **Border:** 1px `--qep-divider`; on hover, becomes `--qep-gear-gray` alpha 40%
- **Radius:** 12px
- **Padding:** 16px
- **Inner shadow (subtle):** `inset 0 1px 0 0 rgba(255,255,255,0.02)` — suggests a physical bevel on the card
- **Drop shadow:** `0 1px 0 0 rgba(0,0,0,0.4)` — anchors it to the page

**Header row:**
- Widget icon (Lucide, 14×14, `--qep-gear-gray`)
- Title (Inter 13 semibold `--qep-white`)
- Optional `action` slot right-aligned (small ghost button)

**Body:** widget content. Widgets should favor one big number + a sparkline or a short list of rows over tables.

**Loading state:** `Loader2` spinner + "Loading…" in Inter 12 `--qep-muted`. No skeletons (skeletons are busy).

**Empty state:** Lucide icon (32×32, `--qep-muted`), Inter 13 semibold `--qep-gear-gray` one-line message, optional small Inter 11 subtitle. No CTA buttons in empty states — the Floor isn't the place to sell features.

**Error state:** `AlertTriangle` in `--floor-amber` (not rose — errors aren't emergencies), one-line message, small "retry" ghost link.

## 9. Motion — subtle, mechanical

The Floor feels like precision machinery, not a UI-toolkit animation demo.

- **Page enter:** widgets fade in staggered at 20ms intervals, translateY(4px) → 0. 180ms ease-out.
- **Narrative pulse:** orange dot opacity cycles 60%→100%→60% over 2.5s ease-in-out when narrative is <15min old. Stops when stale.
- **Quick-action hover:** scale 1.01, 150ms ease-out. Border-color transition same duration.
- **Widget hover:** only the border lightens — no lift, no transform. (Widgets are work, not features.)
- **Layout changes (composer):** 220ms ease-out for position; opacity 120ms for add/remove.

**No parallax. No gradient washes. No animated backgrounds. No confetti.**

## 10. Iconography

Lucide only. 14px in widget headers, 20px in narrative, 32px in quick-action hero. Orange for primary actions + accent metrics, gear-gray for all passive UI.

**Industrial iconography bias:** prefer `Wrench`, `Gauge`, `Anchor`, `Cog`, `Factory`, `HardHat` over generic `Briefcase`, `Rocket`, `Star`.

## 11. Mobile

The Floor is mobile-first. Reps live on phones.

- Viewport ≤ 640px: quick-action hero stacks to 2-col grid of 96px buttons. Narrative strip wraps to 2 lines max. Widget grid is single column with `--qep-space-3` gap.
- All tap targets ≥ 48×48px.
- The bottom 56px is reserved for a **floating action bar** (C5 from the handoff) that sticks to the viewport bottom — not the page bottom — containing the primary quick action + a shortcut to the composer (admin only).
- No hover states are exposed — all hover styles also apply on `:focus-visible` and on `@media (hover: none)` rely on the pressed state only.

## 12. Accessibility

- Every interactive element has an accessible label. No icon-only buttons without `aria-label`.
- Contrast: white on `--qep-surface` passes AAA. Orange on charcoal passes AA large-text and AA normal for 20pt+; smaller orange text uses `--qep-orange-hover` (brighter) for AA normal compliance.
- Keyboard: Tab order follows visual order. `Esc` closes any modal. `Enter` triggers primary quick action when focus is in the hero.
- `prefers-reduced-motion: reduce` → disable all transforms and the narrative pulse. Fade-in only.

## 13. Dead-simple composer (F-3 preview)

When Brian lands on `/floor/compose`:

- One role picker at the top (small Bebas Neue "COMPOSE FOR" label + Inter role dropdown)
- Left column (320px): **Palette** — all widgets allowed for the selected role, as compact rows with a `+` button to add
- Right column (flexible): **Preview** — the live Floor as that role would see it; widgets can be reordered with up/down arrows, removed with `×`, no drag-drop
- Footer: **Save** button (orange), dirty-state indicator, "Preview as Rylee" link
- A persistent **"6 / 6"** counter at the top of the preview — when it hits 6, the `+` buttons in the palette disable with a tooltip "Max 6 — remove one first"

## 14. What we are NOT doing in v1

- Drag-and-drop reordering (arrows are enough, drag is density)
- Dark/light mode toggle (dark is the brand)
- Customizable color themes (you don't get to ruin the brand)
- User-level layouts within a role (workspace-level only — the Rylees share one sales_manager layout)
- Widget-level user customization (options live on each widget's own page, not the Floor)
- Command palette (⌘K) — power-user density; out of scope
- Floating pop-out cards beyond what already exists — the Floor is single-surface

## 15. Success criteria (how I'll know it's beautiful)

When Ryan sees it at QA-R1:

1. He doesn't ask what anything does — each zone's purpose is obvious.
2. He doesn't ask for a walkthrough — the narrative + quick actions + 4 widgets all fit one glance.
3. He picks a layout variant in under 3 minutes.
4. He says some version of "that's ours" — the charcoal + orange feels like the QEP brand, not a template.

When Juan logs in Monday:

1. He sees NEW PARTS QUOTE before he sees anything else.
2. He starts a quote in 2 taps, not 8 clicks.
3. He doesn't have to ask where the drafts section is — it's right there on the Floor.

---

**End of visual language.** F-1 next: schema + role extensions.
