import type { PricingLineKind } from "./pricing-adder-fields";

export type PromotionPlaceholder = {
  id: string;
  title: string;
  kind: PricingLineKind;
  amount: number;
  source: string;
  detail: string;
};

export const PROMOTION_PLACEHOLDERS: PromotionPlaceholder[] = [
  { id: "seed-mfg-support", title: "Manufacturer retail support", kind: "rebate_mfg", amount: 1000, source: "Manufacturer", detail: "Clear starter row until seeded OEM programs resolve." },
  { id: "seed-dealer-match", title: "Dealer close-the-gap promo", kind: "rebate_dealer", amount: 500, source: "Dealer", detail: "Use only when manager policy allows dealer-funded support." },
  { id: "seed-loyalty-owner", title: "Returning owner loyalty", kind: "loyalty_discount", amount: 750, source: "Loyalty", detail: "Placeholder for customer loyalty program selection." },
];
