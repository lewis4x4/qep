export type ServiceHaulPricingInput = {
  oneWayMiles: number;
  baseRateCents: number;
  perMileRateCents: number;
  perHaulMinimumCents: number;
  roundTripMinimumMiles: number;
};

export type ServiceHaulPricingResult = {
  oneWayMiles: number;
  roundTripMiles: number;
  billableMiles: number;
  variableChargeCents: number;
  totalCents: number;
};

function nonNegativeNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateServiceHaulPricing(
  input: ServiceHaulPricingInput,
): ServiceHaulPricingResult {
  const oneWayMiles = nonNegativeNumber(input.oneWayMiles);
  const roundTripMiles = Math.round(oneWayMiles * 2 * 100) / 100;
  const billableMiles = Math.max(
    roundTripMiles,
    nonNegativeNumber(input.roundTripMinimumMiles),
  );
  const baseRateCents = Math.round(nonNegativeNumber(input.baseRateCents));
  const perMileRateCents = Math.round(
    nonNegativeNumber(input.perMileRateCents),
  );
  const perHaulMinimumCents = Math.round(
    nonNegativeNumber(input.perHaulMinimumCents),
  );
  const variableChargeCents = Math.round(billableMiles * perMileRateCents);
  const totalCents = Math.max(
    baseRateCents + variableChargeCents,
    perHaulMinimumCents,
  );

  return {
    oneWayMiles,
    roundTripMiles,
    billableMiles,
    variableChargeCents,
    totalCents,
  };
}
