/**
 * Shared formatting utilities.
 *
 * Single source of truth for currency, date, and number formatting.
 * Previously duplicated across 18+ files.
 */

/**
 * Format a number as a compact currency string.
 * - >= 1M → "$1.2M"
 * - >= 1K → "$50K"
 * - > 0  → "$500"
 * - 0    → "$0"
 * - null → ""
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  if (amount > 0) return `$${Math.round(amount)}`;
  return "$0";
}

/**
 * Format a number as full currency with decimals.
 * - 150000 → "$150,000.00"
 */
export function formatCurrencyFull(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
