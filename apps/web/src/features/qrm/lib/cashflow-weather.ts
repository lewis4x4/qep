import type { Account360ARBlock } from "./account-360-api";

export type CashflowWeatherConfidence = "high" | "medium" | "low";

export interface CashflowWeatherInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  paidAt: string | null;
  total: number;
  amountPaid: number | null;
  balanceDue: number | null;
  status: string;
  paymentMethod: string | null;
}

export interface CashflowWeatherRow {
  key: string;
  title: string;
  confidence: CashflowWeatherConfidence;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface CashflowWeatherBoard {
  summary: {
    openBalance: number;
    overdueBalance: number;
    avgDaysToPay: number | null;
    riskScore: number;
  };
  currentWeather: CashflowWeatherRow[];
  cadencePattern: CashflowWeatherRow[];
  seasonalCash: CashflowWeatherRow[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const startTime = parseTime(start);
  const endTime = parseTime(end);
  if (startTime == null || endTime == null) return null;
  return Math.round((endTime - startTime) / 86_400_000);
}

function monthsUntil(targetMonth: number | null | undefined, nowMonth: number): number | null {
  if (!targetMonth || targetMonth < 1 || targetMonth > 12) return null;
  const zeroBasedTarget = targetMonth - 1;
  return (zeroBasedTarget - nowMonth + 12) % 12;
}

function monthLabel(month: number | null | undefined): string | null {
  if (!month || month < 1 || month > 12) return null;
  return new Date(2000, month - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildCashflowWeatherBoard(input: {
  accountId: string;
  invoices: CashflowWeatherInvoice[];
  arBlock: Account360ARBlock | null;
  budgetCycleMonth: number | null | undefined;
  seasonalPattern: string | null | undefined;
  nowTime?: number;
}): CashflowWeatherBoard {
  const nowTime = input.nowTime ?? Date.now();
  const now = new Date(nowTime);
  const accountCommandHref = `/qrm/accounts/${input.accountId}/command`;
  const strategistHref = `/qrm/accounts/${input.accountId}/strategist`;
  const operatingHref = `/qrm/accounts/${input.accountId}/operating-profile`;

  const openInvoices = input.invoices.filter((row) => Number(row.balanceDue ?? 0) > 0);
  const overdueInvoices = openInvoices.filter((row) => {
    const dueTime = parseTime(row.dueDate);
    return dueTime != null && dueTime < nowTime;
  });
  const paidInvoices = input.invoices.filter((row) => row.paidAt != null);

  const openBalance = openInvoices.reduce((sum, row) => sum + Number(row.balanceDue ?? 0), 0);
  const overdueBalance = overdueInvoices.reduce((sum, row) => sum + Number(row.balanceDue ?? 0), 0);
  const maxDaysOverdue = overdueInvoices.reduce((max, row) => {
    const dueTime = parseTime(row.dueDate);
    if (dueTime == null) return max;
    return Math.max(max, Math.ceil((nowTime - dueTime) / 86_400_000));
  }, 0);

  const daysToPay = paidInvoices
    .map((row) => daysBetween(row.invoiceDate, row.paidAt))
    .filter((value): value is number => value != null);
  const avgDaysToPay =
    daysToPay.length > 0
      ? Math.round(daysToPay.reduce((sum, value) => sum + value, 0) / daysToPay.length)
      : null;

  const paidOnTime = paidInvoices.filter((row) => {
    const dueTime = parseTime(row.dueDate);
    const paidTime = parseTime(row.paidAt);
    return dueTime != null && paidTime != null && paidTime <= dueTime;
  }).length;
  const onTimeRate = paidInvoices.length > 0 ? paidOnTime / paidInvoices.length : null;

  const partialInvoices = input.invoices.filter((row) => {
    const amountPaid = Number(row.amountPaid ?? 0);
    return amountPaid > 0 && amountPaid < Number(row.total ?? 0);
  });
  const paymentMethods = new Set(
    paidInvoices.map((row) => row.paymentMethod?.trim()).filter((value): value is string => Boolean(value)),
  );

  const budgetMonthLabel = monthLabel(input.budgetCycleMonth);
  const monthsToBudget = monthsUntil(input.budgetCycleMonth, now.getMonth());
  const seasonalPattern = input.seasonalPattern?.trim() ? titleize(input.seasonalPattern) : null;
  const seasonalActive = seasonalPattern != null && seasonalPattern !== "Steady";

  const currentWeather: CashflowWeatherRow[] = [];
  const cadencePattern: CashflowWeatherRow[] = [];
  const seasonalCash: CashflowWeatherRow[] = [];

  if (overdueBalance > 0 || input.arBlock) {
    currentWeather.push({
      key: "overdue-front",
      title: "Overdue AR is actively shaping account cash pressure",
      confidence: overdueBalance > 0 && maxDaysOverdue >= 30 ? "high" : "medium",
      trace: [
        `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"} total ${Math.round(overdueBalance).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.`,
        maxDaysOverdue > 0 ? `Oldest open invoice is ${maxDaysOverdue} days overdue.` : "No overdue-day telemetry available.",
        input.arBlock
          ? `AR block is ${input.arBlock.status} with ${input.arBlock.current_max_aging_days ?? "—"}d max aging.`
          : "No active AR block is recorded on the account.",
      ],
      actionLabel: "Open account command",
      href: accountCommandHref,
    });
  } else {
    currentWeather.push({
      key: "clear-surface",
      title: "Current cash surface is stable",
      confidence: "low",
      trace: [
        `Open balance is ${Math.round(openBalance).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.`,
        "No overdue invoice exposure is currently visible.",
      ],
      actionLabel: "Open account command",
      href: accountCommandHref,
    });
  }

  if (openBalance > 0 && overdueBalance < openBalance) {
    const nearTermBalance = openInvoices.filter((row) => {
      const dueTime = parseTime(row.dueDate);
      return dueTime != null && dueTime >= nowTime && dueTime <= nowTime + 30 * 86_400_000;
    }).reduce((sum, row) => sum + Number(row.balanceDue ?? 0), 0);

    currentWeather.push({
      key: "near-term-draw",
      title: "A near-term payment draw is coming due",
      confidence: nearTermBalance > 0 ? "medium" : "low",
      trace: [
        `${openInvoices.length} open invoice${openInvoices.length === 1 ? "" : "s"} total ${Math.round(openBalance).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.`,
        nearTermBalance > 0
          ? `${Math.round(nearTermBalance).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} comes due in the next 30 days.`
          : "No due-date spike is visible in the next 30 days.",
      ],
      actionLabel: "Open account command",
      href: accountCommandHref,
    });
  }

  cadencePattern.push({
    key: "cadence-rhythm",
    title: "Payment cadence shows how quickly this account converts invoices into cash",
    confidence: avgDaysToPay != null && avgDaysToPay <= 30 ? "high" : avgDaysToPay != null ? "medium" : "low",
    trace: [
      avgDaysToPay != null
        ? `Average days to pay is ${avgDaysToPay} days across ${paidInvoices.length} paid invoice${paidInvoices.length === 1 ? "" : "s"}.`
        : "No paid invoice history is available yet.",
      onTimeRate != null
        ? `${Math.round(onTimeRate * 100)}% of paid invoices landed on or before due date.`
        : "On-time payment rate is not available yet.",
    ],
    actionLabel: "Open strategist",
    href: strategistHref,
  });

  if (partialInvoices.length > 0 || paymentMethods.size > 0) {
    cadencePattern.push({
      key: "cadence-collection-style",
      title: partialInvoices.length > 0 ? "Collection style includes partial-pay behavior" : "Payment method pattern is already visible",
      confidence: partialInvoices.length >= 2 ? "high" : "medium",
      trace: [
        `${partialInvoices.length} invoice${partialInvoices.length === 1 ? "" : "s"} show partial-pay behavior.`,
        paymentMethods.size > 0
          ? `${paymentMethods.size} payment method${paymentMethods.size === 1 ? "" : "s"} have been used: ${[...paymentMethods].join(", ")}.`
          : "Payment-method history is still sparse.",
      ],
      actionLabel: "Open account command",
      href: accountCommandHref,
    });
  }

  if (budgetMonthLabel || seasonalActive) {
    seasonalCash.push({
      key: "seasonal-cycle",
      title: "Seasonal cash timing is visible on this account",
      confidence: budgetMonthLabel && monthsToBudget != null && monthsToBudget <= 2 ? "high" : "medium",
      trace: [
        budgetMonthLabel
          ? `${budgetMonthLabel} is the recorded budget-cycle month${monthsToBudget != null ? ` (${monthsToBudget} month${monthsToBudget === 1 ? "" : "s"} away).` : "."}`
          : "No explicit budget-cycle month is recorded.",
        seasonalActive
          ? `Behavioral seasonality is tagged as ${seasonalPattern}.`
          : "No non-steady seasonal pattern is currently tagged.",
      ],
      actionLabel: "Open operating profile",
      href: operatingHref,
    });
  }

  if ((monthsToBudget != null && monthsToBudget <= 2 && openBalance > 0) || (seasonalActive && overdueBalance > 0)) {
    seasonalCash.push({
      key: "seasonal-collision",
      title: "Cash pressure is colliding with a seasonal or budget-cycle window",
      confidence: overdueBalance > 0 ? "high" : "medium",
      trace: [
        `${Math.round(openBalance).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} is still open while the next planning window approaches.`,
        budgetMonthLabel
          ? `Budget cycle month: ${budgetMonthLabel}.`
          : "Budget-cycle month is not explicitly recorded.",
        seasonalActive
          ? `Seasonal pattern: ${seasonalPattern}.`
          : "No non-steady seasonal signal is tagged.",
      ],
      actionLabel: "Open strategist",
      href: strategistHref,
    });
  }

  const riskScore = clamp(
    Math.round(
      (overdueBalance > 0 ? 30 : 0) +
      Math.min(20, maxDaysOverdue) +
      (input.arBlock ? 15 : 0) +
      (avgDaysToPay != null ? Math.min(15, Math.max(0, avgDaysToPay - 20)) : 5) +
      Math.min(10, partialInvoices.length * 3) +
      ((monthsToBudget != null && monthsToBudget <= 2 && openBalance > 0) ? 10 : 0) +
      ((seasonalActive && overdueBalance > 0) ? 10 : 0),
    ),
    0,
    100,
  );

  return {
    summary: {
      openBalance,
      overdueBalance,
      avgDaysToPay,
      riskScore,
    },
    currentWeather,
    cadencePattern,
    seasonalCash,
  };
}
