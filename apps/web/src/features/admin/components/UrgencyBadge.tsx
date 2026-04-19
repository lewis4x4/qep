import { Badge } from "@/components/ui/badge";

export type UrgencyLevel = "fresh" | "stale" | "urgent" | "missing";

/** Classify sheet freshness by days since last upload. */
export function getUrgency(lastUploadedAt: string | null): UrgencyLevel {
  if (!lastUploadedAt) return "missing";
  const ageMs = Date.now() - new Date(lastUploadedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > 60) return "urgent";
  if (ageDays > 14) return "stale";
  return "fresh";
}

const URGENCY_CONFIG: Record<UrgencyLevel, { label: string; variant: "success" | "warning" | "destructive" | "outline" }> = {
  fresh:   { label: "Fresh",   variant: "success" },
  stale:   { label: "Stale",   variant: "warning" },
  urgent:  { label: "Urgent",  variant: "destructive" },
  missing: { label: "Missing", variant: "outline" },
};

interface UrgencyBadgeProps {
  lastUploadedAt: string | null;
}

export function UrgencyBadge({ lastUploadedAt }: UrgencyBadgeProps) {
  const level = getUrgency(lastUploadedAt);
  const { label, variant } = URGENCY_CONFIG[level];
  return <Badge variant={variant}>{label}</Badge>;
}
