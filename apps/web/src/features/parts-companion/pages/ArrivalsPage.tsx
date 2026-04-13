import { Package, Truck } from "lucide-react";

const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  border: "#1F3254",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.12)",
  purple: "#A855F7",
  purpleBg: "rgba(168,85,247,0.14)",
} as const;

/**
 * ArrivalsPage — incoming shipments & special orders tracker.
 * Placeholder that matches the prototype skeleton with dark premium styling.
 * Will be wired to a real arrivals table in a future sprint.
 */
export function ArrivalsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Hero */}
      <div
        className="flex-shrink-0"
        style={{
          padding: "20px 28px 16px",
          borderBottom: `1px solid ${T.border}`,
          background: `linear-gradient(180deg, ${T.orangeGlow} 0%, transparent 100%)`,
        }}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <Truck size={18} color={T.orange} />
          <h1
            className="text-[22px] font-extrabold tracking-tight"
            style={{ color: T.text, margin: 0 }}
          >
            Incoming Arrivals
          </h1>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
            style={{
              color: T.textMuted,
              background: T.card,
              border: `1px solid ${T.border}`,
            }}
          >
            0 shipments
          </span>
        </div>
      </div>

      {/* Empty state */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div
          className="flex items-center justify-center w-16 h-16 rounded-2xl"
          style={{ background: T.orangeGlow }}
        >
          <Package size={28} color={T.orange} />
        </div>
        <p
          className="text-sm font-semibold"
          style={{ color: T.textMuted }}
        >
          No incoming arrivals
        </p>
        <p className="text-xs" style={{ color: T.textDim }}>
          Special orders, backorders, and restocks will appear here as they&apos;re
          tracked.
        </p>
      </div>
    </div>
  );
}
