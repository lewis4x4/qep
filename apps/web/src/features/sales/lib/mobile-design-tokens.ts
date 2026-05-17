/**
 * Mobile design tokens for the Sales Companion surface.
 *
 * Locked by WAVE-MOBILE-FIRST-SALES-REP-HANDOFF Phase 0. Every page
 * hosted inside `SalesShell` should consume these tokens (or use the
 * tailwind classes they map to) so that the rep experience stays
 * coherent across Quote Builder, Field Note, Voice Quote, My Mirror,
 * and the new Sales Deal Detail page.
 *
 * If you find yourself reaching for a magic number — add it here first.
 */

export const MOBILE = {
  // Viewport breakpoints (matches tailwind defaults)
  breakpoints: {
    sm: 640,
    md: 768,
    lg: 1024,
  },

  // Chrome
  topHeaderHeight: 56,
  bottomTabBarHeight: 64,
  stickyActionBarHeight: 64,

  // Spacing
  gutterX: 16, // px-4
  gutterY: 16,
  cardRadius: 16, // rounded-2xl

  // Touch
  minTouchTarget: 44,

  // Typography ramp (single column)
  text: {
    pageTitle: "text-3xl font-semibold tracking-tight",
    sectionTitle: "text-xl font-semibold",
    cardTitle: "text-base font-semibold",
    body: "text-sm",
    label: "text-xs uppercase tracking-wide font-medium",
  },

  // Surface tokens (compose with cn)
  surface: {
    bg: "bg-[hsl(var(--qep-bg))]",
    card: "bg-foreground/[0.04] border border-white/[0.06]",
    cardElevated: "bg-foreground/[0.06] border border-white/[0.08]",
    accentOrange: "bg-qep-orange text-white",
    accentCyan: "border-cyan-500/40 bg-cyan-500/10",
  },

  // Animation
  sheetSpring: "transition-transform duration-300 ease-out",

  // Safe area
  safeAreaTop: "env(safe-area-inset-top)",
  safeAreaBottom: "env(safe-area-inset-bottom)",
} as const;

export type MobileTokens = typeof MOBILE;
