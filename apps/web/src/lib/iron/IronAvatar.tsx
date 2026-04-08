/**
 * Wave 7 Iron Companion — PNG-driven avatar.
 *
 * Renders one of five custom Iron portrait PNGs based on state, with a
 * stateful glow ring, framer-motion crossfade, idle breathe, alert bob,
 * listening pulse, and success flash. Respects `prefers-reduced-motion`.
 *
 * The avatar is purely visual — `IronCorner` wraps it for drag/snap
 * positioning and `IronShell` mounts the whole stack into the auth-gated
 * tree of the app.
 *
 * Z-index discipline:
 *   FlareDrawer  9999  (Flare always wins — bug reports cannot be blocked)
 *   IronAvatar   9998
 *   IronBar      9997
 *   FlowEngine   9996
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

import ironIdle from "@/assets/iron/iron-idle.png";
import ironThinking from "@/assets/iron/iron-thinking.png";
import ironSpeaking from "@/assets/iron/iron-speaking.png";
import ironListening from "@/assets/iron/iron-listening.png";
import ironAlert from "@/assets/iron/iron-alert.png";

import type { IronAvatarState } from "./types";

export interface IronAvatarProps {
  state: IronAvatarState;
  size?: number;
  collapsed?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

const STATE_TO_SRC: Record<IronAvatarState, string> = {
  idle: ironIdle,
  thinking: ironThinking,
  speaking: ironSpeaking,
  listening: ironListening,
  alert: ironAlert,
  flow_active: ironThinking, // reuse thinking pose during flow execution
  success: ironSpeaking, // positive-affect pose; ring color carries the win
};

const STATE_TO_LABEL: Record<IronAvatarState, string> = {
  idle: "Iron — ready",
  thinking: "Iron — thinking",
  speaking: "Iron — speaking",
  listening: "Iron — listening",
  alert: "Iron — has a suggestion for you",
  flow_active: "Iron — flow in progress",
  success: "Iron — done",
};

const BREATHE_ANIMATION = {
  scale: [1, 1.015, 1],
  transition: { duration: 4, repeat: Infinity, ease: "easeInOut" as const },
};

const ALERT_BOB = {
  y: [0, -3, 0],
  transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" as const },
};

function ringShadow(state: IronAvatarState): string {
  switch (state) {
    case "alert":
      return "0 0 24px 4px rgba(239, 68, 68, 0.45)";
    case "listening":
      return "0 0 24px 4px rgba(59, 130, 246, 0.4)";
    case "speaking":
      return "0 0 28px 6px rgba(255, 138, 61, 0.5)";
    case "thinking":
    case "flow_active":
      // Baseline glow — the thinking-specific animated layers below
      // pulse on top of this so motion-reduced users still see a ring.
      return "0 0 20px 3px rgba(255, 138, 61, 0.3)";
    case "success":
      return "0 0 26px 5px rgba(16, 185, 129, 0.55)";
    default:
      return "0 0 16px 2px rgba(0, 0, 0, 0.25)";
  }
}

/**
 * Animated "arc reactor" glow stack for the thinking / flow_active
 * states. Three composed layers make the border feel alive instead of
 * static: a breathing inner glow, a slowly-rotating conic-gradient
 * spinner, and an outer halo that expands and fades in a 1.6s loop.
 * Colors match the qep-orange brand (#ff8a3d-ish).
 */
const THINKING_GLOW_KEYFRAMES = {
  boxShadow: [
    "0 0 12px 2px rgba(255, 138, 61, 0.25), 0 0 24px 6px rgba(255, 138, 61, 0.15)",
    "0 0 28px 6px rgba(255, 138, 61, 0.55), 0 0 48px 14px rgba(255, 138, 61, 0.3)",
    "0 0 12px 2px rgba(255, 138, 61, 0.25), 0 0 24px 6px rgba(255, 138, 61, 0.15)",
  ] as string[],
};

const THINKING_SPINNER_TRANSITION = {
  duration: 2.4,
  repeat: Infinity,
  ease: "linear" as const,
};

const THINKING_PULSE_TRANSITION = {
  duration: 1.6,
  repeat: Infinity,
  ease: "easeInOut" as const,
};

export function IronAvatar({
  state,
  size = 72,
  collapsed = false,
  onClick,
  ariaLabel,
  className = "",
}: IronAvatarProps) {
  const reduceMotion = useReducedMotion();
  const src = STATE_TO_SRC[state];
  const label = ariaLabel ?? STATE_TO_LABEL[state];
  const effectiveSize = collapsed ? 24 : size;

  const idleAnimation = useMemo(() => {
    if (reduceMotion) return undefined;
    if (state === "idle") return BREATHE_ANIMATION;
    if (state === "alert") return ALERT_BOB;
    return undefined;
  }, [state, reduceMotion]);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`relative inline-flex items-center justify-center rounded-full select-none ${className}`}
      style={{ width: effectiveSize, height: effectiveSize }}
      animate={idleAnimation}
      whileHover={reduceMotion ? undefined : { scale: 1.05 }}
      whileTap={reduceMotion ? undefined : { scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
    >
      {/* Soft glow ring driven off state */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: ringShadow(state),
          transition: "box-shadow 300ms ease",
        }}
      />

      {/* Avatar PNG with crossfade between states */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.img
          key={state}
          src={src}
          alt=""
          draggable={false}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="relative rounded-full"
          style={{
            width: effectiveSize,
            height: effectiveSize,
            objectFit: "cover",
          }}
        />
      </AnimatePresence>

      {/* Alert dot — visible at full size when in alert state */}
      {state === "alert" && !collapsed && (
        <motion.div
          aria-hidden
          className="absolute rounded-full bg-red-500 ring-2 ring-white"
          style={{
            top: "14%",
            right: "18%",
            width: Math.max(8, effectiveSize * 0.14),
            height: Math.max(8, effectiveSize * 0.14),
            boxShadow: "0 0 8px 2px rgba(239, 68, 68, 0.9)",
          }}
          initial={{ scale: 0 }}
          animate={reduceMotion ? { scale: 1 } : { scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}

      {/* Thinking / flow_active — three-layer arc reactor animation:
            1. Inner pulsing glow that breathes amber
            2. A slowly-rotating conic-gradient spinner ring
            3. An outer halo that expands and fades in 1.6s loops
          All three stack on top of the static ringShadow() base so motion-
          reduced users still see a solid ring. */}
      {(state === "thinking" || state === "flow_active") && !collapsed && !reduceMotion && (
        <>
          {/* Layer 1 — breathing inner glow */}
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-full pointer-events-none"
            animate={THINKING_GLOW_KEYFRAMES}
            transition={THINKING_PULSE_TRANSITION}
          />

          {/* Layer 2 — rotating conic-gradient spinner. The mask creates
                a thin ring by cutting out the center of a gradient disc. */}
          <motion.div
            aria-hidden
            className="absolute pointer-events-none rounded-full"
            style={{
              inset: -6,
              background:
                "conic-gradient(from 0deg, rgba(255,138,61,0) 0deg, rgba(255,138,61,0.85) 60deg, rgba(255,170,80,1) 120deg, rgba(255,138,61,0.85) 180deg, rgba(255,138,61,0) 220deg, rgba(255,138,61,0) 360deg)",
              WebkitMask:
                "radial-gradient(circle, transparent 52%, black 54%, black 68%, transparent 70%)",
              mask:
                "radial-gradient(circle, transparent 52%, black 54%, black 68%, transparent 70%)",
              filter: "blur(0.5px)",
            }}
            animate={{ rotate: 360 }}
            transition={THINKING_SPINNER_TRANSITION}
          />

          {/* Layer 3 — expanding halo ring (opacity + scale out) */}
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-full pointer-events-none border border-qep-orange/60"
            initial={{ scale: 1.0, opacity: 0.7 }}
            animate={{ scale: 1.35, opacity: 0 }}
            transition={THINKING_PULSE_TRANSITION}
          />
        </>
      )}

      {/* Listening pulse — radial expand */}
      {state === "listening" && !collapsed && !reduceMotion && (
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none border-2 border-blue-400"
          initial={{ scale: 0.9, opacity: 0.6 }}
          animate={{ scale: 1.25, opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
      )}

      {/* Success flash — single check-mark style ring expand */}
      {state === "success" && !collapsed && !reduceMotion && (
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none border-2 border-emerald-400"
          initial={{ scale: 0.9, opacity: 0.7 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 1.0, repeat: Infinity, ease: "easeOut" }}
        />
      )}
    </motion.button>
  );
}
