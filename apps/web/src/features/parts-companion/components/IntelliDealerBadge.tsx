import { useState } from "react";
import { ExternalLink, Copy, CheckCircle2 } from "lucide-react";

/* ── Design tokens ─────────────────────────────────────────────── */
const T = {
  bgElevated: "#0F1D31",
  border: "#1F3254",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.12)",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
} as const;

interface IntelliDealerBadgeProps {
  partNumber: string;
  className?: string;
}

/**
 * V1: "Check IntelliDealer" badge with copy-to-clipboard part number.
 * V2 (when IntelliDealer API goes live): transforms into live stock/price display.
 * The slot pattern absorbs the upgrade with zero UI restructuring.
 */
export function IntelliDealerBadge({
  partNumber,
  className = "",
}: IntelliDealerBadgeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText?.(partNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Check IntelliDealer badge */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md"
        style={{
          background: T.warningBg,
          border: `1px solid rgba(245,158,11,0.25)`,
        }}
      >
        <ExternalLink size={13} style={{ color: T.warning }} />
        <span
          className="text-xs font-semibold"
          style={{ color: T.warning }}
        >
          Check IntelliDealer
        </span>
      </div>

      {/* Copy part number */}
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium cursor-pointer transition-all duration-150"
        style={{
          fontFamily: "monospace",
          border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : T.border}`,
          background: copied ? T.successBg : T.bgElevated,
          color: copied ? T.success : T.textMuted,
        }}
      >
        {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : partNumber}
      </button>
    </div>
  );
}
