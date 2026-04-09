// apps/web/src/lib/iron/avatar/IronAvatar.tsx
// Drop-in avatar component for Wave 7 Iron Companion.
// Assumes the 5 PNGs are placed in apps/web/src/assets/iron/
// Uses framer-motion for crossfade + bob/breathe loops.

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';

import ironIdle from '@/assets/iron/iron-idle.png';
import ironThinking from '@/assets/iron/iron-thinking.png';
import ironSpeaking from '@/assets/iron/iron-speaking.png';
import ironListening from '@/assets/iron/iron-listening.png';
import ironAlert from '@/assets/iron/iron-alert.png';

export type IronState =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'listening'
  | 'alert'
  | 'flow_active';

interface IronAvatarProps {
  state: IronState;
  size?: number;                  // default 72
  onClick?: () => void;
  collapsed?: boolean;            // if true, render as 24px chip
  ariaLabel?: string;
  className?: string;
}

const STATE_TO_SRC: Record<IronState, string> = {
  idle: ironIdle,
  thinking: ironThinking,
  speaking: ironSpeaking,
  listening: ironListening,
  alert: ironAlert,
  flow_active: ironThinking,      // reuse thinking for active flow
};

const STATE_TO_LABEL: Record<IronState, string> = {
  idle: 'Iron — ready',
  thinking: 'Iron — thinking',
  speaking: 'Iron — speaking',
  listening: 'Iron — listening',
  alert: 'Iron — has a suggestion for you',
  flow_active: 'Iron — flow in progress',
};

// Subtle idle loop: breathe (scale) + blink cadence handled via opacity on a pseudo-overlay
const BREATHE_ANIMATION = {
  scale: [1, 1.015, 1],
  transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
};

// Alert bob: small y translation to catch attention without being annoying
const ALERT_BOB = {
  y: [0, -3, 0],
  transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
};

export function IronAvatar({
  state,
  size = 72,
  onClick,
  collapsed = false,
  ariaLabel,
  className = '',
}: IronAvatarProps) {
  const reduceMotion = useReducedMotion();
  const src = STATE_TO_SRC[state];
  const label = ariaLabel ?? STATE_TO_LABEL[state];
  const effectiveSize = collapsed ? 24 : size;

  // Idle breathe only when idle AND motion not reduced
  const idleAnimation = useMemo(() => {
    if (reduceMotion) return undefined;
    if (state === 'idle') return BREATHE_ANIMATION;
    if (state === 'alert') return ALERT_BOB;
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
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
    >
      {/* Soft glow ring — intensity drives off state */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow:
            state === 'alert'
              ? '0 0 24px 4px rgba(239, 68, 68, 0.45)'       // red urgent
              : state === 'listening'
              ? '0 0 24px 4px rgba(59, 130, 246, 0.4)'        // blue STT
              : state === 'speaking'
              ? '0 0 28px 6px rgba(255, 138, 61, 0.5)'        // amber TTS
              : state === 'thinking' || state === 'flow_active'
              ? '0 0 20px 3px rgba(255, 138, 61, 0.3)'        // soft amber processing
              : '0 0 16px 2px rgba(0, 0, 0, 0.25)',           // subtle idle drop
          transition: 'box-shadow 300ms ease',
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
            objectFit: 'cover',
          }}
        />
      </AnimatePresence>

      {/* Alert dot overlay — CSS-boosted red dot so it reads at small sizes */}
      {state === 'alert' && !collapsed && (
        <motion.div
          aria-hidden
          className="absolute rounded-full bg-red-500 ring-2 ring-white"
          style={{
            top: '14%',
            right: '18%',
            width: Math.max(8, effectiveSize * 0.14),
            height: Math.max(8, effectiveSize * 0.14),
            boxShadow: '0 0 8px 2px rgba(239, 68, 68, 0.9)',
          }}
          initial={{ scale: 0 }}
          animate={reduceMotion ? { scale: 1 } : { scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}

      {/* Blue listening pulse overlay — expands from center */}
      {state === 'listening' && !collapsed && !reduceMotion && (
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none border-2 border-blue-400"
          initial={{ scale: 0.9, opacity: 0.6 }}
          animate={{ scale: 1.25, opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
    </motion.button>
  );
}
