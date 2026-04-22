import { useQuery } from "@tanstack/react-query";
import { calculateFinancing, type QuoteFinancingRequest } from "../lib/quote-api";

export function useQuoteFinancingPreview(input: QuoteFinancingRequest) {
  const enabled = input.packageSubtotal > 0;

  return useQuery({
    queryKey: [
      "quote-builder",
      "financing-preview",
      input.packageSubtotal,
      input.discountTotal,
      input.tradeAllowance,
      input.taxTotal,
      input.cashDown,
      input.amountFinanced,
      input.marginPct ?? null,
      input.manufacturer ?? null,
    ],
    queryFn: () => calculateFinancing(input),
    enabled,
    staleTime: 60_000,
  });
}
