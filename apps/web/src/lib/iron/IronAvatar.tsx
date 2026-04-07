/**
 * Wave 7 Iron Companion — floating corner avatar.
 *
 * v1: pure CSS animation, no framer-motion dependency. Renders a fixed
 * bottom-right circular button with a Lucide icon. Click opens the IronBar.
 * State changes (idle / thinking / speaking / listening / alert / flow_active /
 * success) drive ring color + pulse animation only.
 *
 * Wave 7.1+: drop in the 5 PNG renders from the iron-avatar/ folder + framer-motion.
 */
import { useEffect, useRef } from "react";
import { Bot, Mic, Sparkles, Loader2, AlertOctagon, CheckCircle2, Zap } from "lucide-react";
import type { IronAvatarState } from "./types";

export interface IronAvatarProps {
  state: IronAvatarState;
  onClick: () => void;
  collapsed?: boolean;
  ariaLabel?: string;
}

const ICON_BY_STATE: Record<IronAvatarState, typeof Bot> = {
  idle: Bot,
  thinking: Loader2,
  speaking: Sparkles,
  listening: Mic,
  alert: AlertOctagon,
  flow_active: Zap,
  success: CheckCircle2,
};

const RING_BY_STATE: Record<IronAvatarState, string> = {
  idle: "ring-qep-orange/30",
  thinking: "ring-qep-orange/80 animate-pulse",
  speaking: "ring-qep-orange/80 animate-pulse",
  listening: "ring-blue-400/80 animate-pulse",
  alert: "ring-red-500/80 animate-pulse",
  flow_active: "ring-qep-orange",
  success: "ring-emerald-400/80",
};

const LABEL_BY_STATE: Record<IronAvatarState, string> = {
  idle: "Iron — open command palette",
  thinking: "Iron is thinking",
  speaking: "Iron is responding",
  listening: "Iron is listening",
  alert: "Iron has an alert",
  flow_active: "Iron flow in progress",
  success: "Iron flow succeeded",
};

export function IronAvatar({ state, onClick, collapsed, ariaLabel }: IronAvatarProps) {
  const Icon = ICON_BY_STATE[state];
  const ring = RING_BY_STATE[state];
  const label = ariaLabel ?? LABEL_BY_STATE[state];
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Subtle "breathe" animation when idle (CSS-driven via the data attribute)
  useEffect(() => {
    if (!buttonRef.current) return;
    buttonRef.current.dataset.ironState = state;
  }, [state]);

  if (collapsed) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`fixed bottom-4 right-4 z-[9998] flex h-6 w-6 items-center justify-center rounded-full bg-background ring-2 ${ring} hover:scale-110 transition-transform`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Icon className="h-3 w-3 text-foreground" />
      </button>
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`fixed bottom-6 right-6 z-[9998] flex h-14 w-14 items-center justify-center rounded-full bg-background shadow-lg ring-2 ${ring} hover:scale-105 transition-transform iron-avatar-breathe`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Icon
        className={`h-6 w-6 text-qep-orange ${state === "thinking" ? "animate-spin" : ""}`}
      />
      <style>{`
        .iron-avatar-breathe[data-iron-state="idle"] {
          animation: ironBreathe 4s ease-in-out infinite;
        }
        @keyframes ironBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        @media (prefers-reduced-motion: reduce) {
          .iron-avatar-breathe[data-iron-state="idle"] { animation: none; }
        }
      `}</style>
    </button>
  );
}
