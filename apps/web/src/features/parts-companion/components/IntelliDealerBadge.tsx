import { useState } from "react";
import { ExternalLink, Copy, CheckCircle2 } from "lucide-react";

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
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#FEF3C7] border border-[#FDE68A]">
        <ExternalLink size={13} className="text-[#92400E]" />
        <span className="text-xs font-semibold text-[#92400E]">
          Check IntelliDealer
        </span>
      </div>

      {/* Copy part number */}
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 px-2 py-1.5 rounded border text-xs font-medium cursor-pointer transition-all duration-150"
        style={{
          borderColor: "#E2E8F0",
          background: copied ? "#D1FAE5" : "white",
          color: copied ? "#065F46" : "#4A5568",
        }}
      >
        {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : partNumber}
      </button>
    </div>
  );
}
