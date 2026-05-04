export type TethrActionSurface = "equipment_invoicing" | "parts_invoicing" | "customer_portal";

export interface TethrSurfaceCopy {
  surface: TethrActionSurface;
  title: string;
  description: string;
  fallbackLabel: string;
}

export const TETHR_PROVIDER_KEY = "tethr_telematics";

export const TETHR_PROVIDER_REQUIREMENTS = [
  "Tethr credentials and auth contract",
  "Webhook/API payload samples for hours, GPS, faults, and device metadata",
  "Device-to-equipment mapping source of truth",
  "Unknown-device handling policy",
  "Stale-data and failed-provider policy",
  "UI owner approval for each Tethr It Now action surface",
] as const;

const SURFACE_COPY: Record<TethrActionSurface, TethrSurfaceCopy> = {
  equipment_invoicing: {
    surface: "equipment_invoicing",
    title: "Equipment invoicing Tethr It Now",
    description:
      "This is the Sales Support Portal / equipment-invoicing readiness slot. It can open provider-neutral Asset 360 telematics data, but live Tethr action wiring is blocked until the provider contract and mapping policy exist.",
    fallbackLabel: "Use Asset 360 telematics fallback",
  },
  parts_invoicing: {
    surface: "parts_invoicing",
    title: "Parts invoicing Tethr It Now",
    description:
      "This parts invoice/order surface can show the readiness state next to counter and fulfillment actions. The provider action is blocked and must not submit to Tethr until live auth, payloads, and equipment mapping are approved.",
    fallbackLabel: "Use parts order context only",
  },
  customer_portal: {
    surface: "customer_portal",
    title: "Customer portal Tethr It Now",
    description:
      "Portal users can see published fleet status and provider-neutral telematics-derived hours/location when available. Customer-facing Tethr It Now remains blocked until live Tethr behavior and stale/unknown-device policies are approved.",
    fallbackLabel: "Use portal fleet status fallback",
  },
};

export function getTethrReadinessSurfaceCopy(surface: TethrActionSurface): TethrSurfaceCopy {
  return SURFACE_COPY[surface];
}

export function getTethrReadinessBlockerSummary(): string {
  return TETHR_PROVIDER_REQUIREMENTS.join("; ");
}
