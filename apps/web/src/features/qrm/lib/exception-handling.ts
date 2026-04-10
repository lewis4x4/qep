export interface RevivalCandidate {
  id: string;
  name: string;
  amount: number | null;
  closedAt: string | null;
  lossReason: string | null;
  competitor: string | null;
}

export interface FailedDelivery {
  id: string;
  stockNumber: string;
  status: string;
  promisedDeliveryAt: string | null;
  problemsReported: string | null;
  toLocation: string;
}

export interface DamagedDemo {
  id: string;
  demoId: string;
  dealId: string;
  damageDescription: string | null;
  completedAt: string | null;
}

export interface RentalDispute {
  id: string;
  equipmentId: string | null;
  status: string;
  refundStatus: string | null;
  chargeAmount: number | null;
  damageDescription: string | null;
}

export interface PaymentException {
  id: string;
  amount: number;
  attemptOutcome: string | null;
  exceptionReason: string | null;
  overrideReason: string | null;
  invoiceReference: string | null;
}

export interface ExceptionHandlingSummary {
  revivalCount: number;
  failedDeliveryCount: number;
  damagedDemoCount: number;
  rentalDisputeCount: number;
  paymentExceptionCount: number;
}

export interface ExceptionHandlingBoard {
  summary: ExceptionHandlingSummary;
  revivals: RevivalCandidate[];
  failedDeliveries: FailedDelivery[];
  damagedDemos: DamagedDemo[];
  rentalDisputes: RentalDispute[];
  paymentExceptions: PaymentException[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildExceptionHandlingBoard(input: {
  revivals: RevivalCandidate[];
  failedDeliveries: FailedDelivery[];
  damagedDemos: DamagedDemo[];
  rentalDisputes: RentalDispute[];
  paymentExceptions: PaymentException[];
  nowTime?: number;
}): ExceptionHandlingBoard {
  const nowTime = input.nowTime ?? Date.now();

  const revivals = [...input.revivals]
    .filter((deal) => {
      const closedAt = parseTime(deal.closedAt);
      if (closedAt == null) return false;
      return closedAt >= nowTime - 30 * 86_400_000;
    })
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  const failedDeliveries = [...input.failedDeliveries].sort((a, b) => {
    const aDue = parseTime(a.promisedDeliveryAt) ?? 0;
    const bDue = parseTime(b.promisedDeliveryAt) ?? 0;
    return aDue - bDue;
  });

  const damagedDemos = [...input.damagedDemos].sort((a, b) => {
    const aTime = parseTime(a.completedAt) ?? 0;
    const bTime = parseTime(b.completedAt) ?? 0;
    return bTime - aTime;
  });

  const rentalDisputes = [...input.rentalDisputes].sort((a, b) => (b.chargeAmount ?? 0) - (a.chargeAmount ?? 0));
  const paymentExceptions = [...input.paymentExceptions].sort((a, b) => b.amount - a.amount);

  return {
    summary: {
      revivalCount: revivals.length,
      failedDeliveryCount: failedDeliveries.length,
      damagedDemoCount: damagedDemos.length,
      rentalDisputeCount: rentalDisputes.length,
      paymentExceptionCount: paymentExceptions.length,
    },
    revivals,
    failedDeliveries,
    damagedDemos,
    rentalDisputes,
    paymentExceptions,
  };
}
