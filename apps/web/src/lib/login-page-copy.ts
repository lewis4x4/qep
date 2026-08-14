import { BRAND_NAME } from "@/components/BrandLogo";

export type LoginSurfaceMode = "internal" | "portal";

export interface LoginHeroMetric {
  label: string;
  value: string;
}

export interface LoginMarketingCopy {
  badgeLabel: string;
  headline: string;
  subcopy: string;
  heroEyebrow: string;
  heroCaption: string;
  heroStatusLabel: string;
  heroOverlayTitle: string;
  heroOverlayBody: string;
  heroMetrics: LoginHeroMetric[];
  footerLines: [string, string];
}

const OPERATOR_MARKETING: LoginMarketingCopy = {
  badgeLabel: "Sales, parts, service, rentals",
  headline: "Run the dealership from one operating system.",
  subcopy:
    "Quotes, customer history, field notes, and follow-up for sales reps, parts, service, rentals, and management — without the usual QRM clutter.",
  heroEyebrow: "Operations snapshot",
  heroCaption: "Lake City yard — sales floor, parts counter, and service bay in one view.",
  heroStatusLabel: "Field ready",
  heroOverlayTitle: "Sales to service, one system",
  heroOverlayBody: "From quote to service follow-up without switching systems.",
  heroMetrics: [
    { label: "Multi-location", value: "Branch-aware workflows" },
    { label: "Field follow-up", value: "Mobile-first capture" },
    { label: "Quote-to-close", value: "Connected deal flow" },
  ],
  footerLines: ["Role-based access enforced", "Built for the field and the front office"],
};

const PORTAL_MARKETING: LoginMarketingCopy = {
  badgeLabel: "Your equipment partner",
  headline: "Your fleet, service, and billing in one place.",
  subcopy:
    `Sign in to view equipment records, open work orders, invoices, rental agreements, and documents shared by ${BRAND_NAME}.`,
  heroEyebrow: "Customer portal",
  heroCaption: "Track service progress, review invoices, and download documents on your schedule.",
  heroStatusLabel: "Secure access",
  heroOverlayTitle: "Equipment visibility",
  heroOverlayBody: "See what is on rent, in service, or ready for pickup without calling the counter.",
  heroMetrics: [
    { label: "Fleet records", value: "Your equipment history" },
    { label: "Service status", value: "Open work orders" },
    { label: "Documents", value: "Invoices and agreements" },
  ],
  footerLines: ["Secure customer access", "Shared only with your organization"],
};

export function loginFormCopy(mode: LoginSurfaceMode): {
  badgeLabel: string;
  headline: string;
  subcopy: string;
} {
  const marketing = mode === "portal" ? PORTAL_MARKETING : OPERATOR_MARKETING;
  return {
    badgeLabel: mode === "portal" ? "Secure customer portal" : "Secure operator access",
    headline: mode === "portal" ? "Portal access" : "Welcome back",
    subcopy:
      mode === "portal"
        ? `Sign in with your ${BRAND_NAME} customer portal account to view your equipment, service status, invoices, and documents.`
        : `Sign in with your ${BRAND_NAME} work account to access knowledge, QRM follow-up, voice capture, and quotes.`,
  };
}

export function loginMarketingCopy(mode: LoginSurfaceMode): LoginMarketingCopy {
  return mode === "portal" ? PORTAL_MARKETING : OPERATOR_MARKETING;
}
