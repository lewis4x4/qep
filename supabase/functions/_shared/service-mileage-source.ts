export type ServiceMileageSource =
  | "manual"
  | "verizon_reveal"
  | "generic_telematics"
  | "none";

export const SERVICE_MILEAGE_SOURCES: readonly ServiceMileageSource[] = [
  "manual",
  "verizon_reveal",
  "generic_telematics",
  "none",
];

export function normalizeServiceMileageSource(
  value: unknown,
  fallback: ServiceMileageSource = "manual",
): ServiceMileageSource {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return fallback;
  if (normalized === "manual") return "manual";
  if (
    normalized === "verizon" || normalized === "reveal" ||
    normalized === "verizon_reveal"
  ) return "verizon_reveal";
  if (
    normalized === "gps" || normalized === "telematics" ||
    normalized === "generic" || normalized === "generic_telematics"
  ) return "generic_telematics";
  if (normalized === "none" || normalized === "not_available") return "none";
  return fallback;
}

export function normalizeMileageMiles(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function serviceMileageSourceLabel(source: ServiceMileageSource): string {
  switch (source) {
    case "verizon_reveal":
      return "Verizon Reveal";
    case "generic_telematics":
      return "GPS/telematics";
    case "none":
      return "not available";
    case "manual":
      return "manual";
  }
}
