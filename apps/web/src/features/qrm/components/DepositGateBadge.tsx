interface DepositGateBadgeProps {
  depositStatus: string | null;
  depositAmount: number | null;
  className?: string;
}

/**
 * Visual deposit gate indicator for deal cards.
 * Shows a lock icon when deposit is required but not verified.
 */
export function DepositGateBadge({ depositStatus, depositAmount, className = "" }: DepositGateBadgeProps) {
  if (!depositStatus || depositStatus === "not_required") return null;

  const isVerified = depositStatus === "verified" || depositStatus === "applied";
  const isPending = depositStatus === "pending" || depositStatus === "requested" || depositStatus === "received";

  const formattedAmount = depositAmount
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(depositAmount)
    : "";

  if (isVerified) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 ${className}`}
        title={`Deposit verified: ${formattedAmount}`}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none">
          <path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Deposit
      </span>
    );
  }

  if (isPending) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400 ${className}`}
        title={`Deposit required: ${formattedAmount} (${depositStatus})`}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none">
          <rect x="4" y="7" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 7V5a2 2 0 0 1 4 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {formattedAmount}
      </span>
    );
  }

  return null;
}
