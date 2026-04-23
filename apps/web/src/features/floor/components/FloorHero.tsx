/**
 * FloorHero — the quick-action row.
 *
 * 2 or 3 giant buttons per role, oversized, Bebas Neue labels. The first
 * button carries the orange left-rule (primary action). Layout is 2-col
 * on mobile, N-col on desktop (where N = action count, max 3).
 *
 * When a layout has zero quick actions, this section does not render.
 * Brian's composer caps at 3 at the UI level; the DB also caps at 3.
 */
import { Link } from "react-router-dom";
import {
  ArrowRight,
  FileText,
  Mic,
  MapPin,
  Wrench,
  Search,
  Files,
  Zap,
  Users,
  Activity,
  ClipboardCheck,
  ClipboardList,
  Sparkles,
  Box,
  TrendingUp,
  CreditCard,
  DollarSign,
  BadgeCheck,
  PackageSearch,
  type LucideIcon,
} from "lucide-react";
import type { FloorQuickAction } from "../lib/layout-types";

/** Map of icon ids → Lucide components. Keep keys stable — they're
 *  referenced by `FloorQuickAction.icon` (which is stored in
 *  floor_layouts.layout_json). */
const ICON_MAP: Record<string, LucideIcon> = {
  quote: FileText,
  voice: Mic,
  visit: MapPin,
  wrench: Wrench,
  search: Search,
  drafts: Files,
  spark: Zap,
  users: Users,
  activity: Activity,
  check: ClipboardCheck,
  clipboard: ClipboardList,
  sparkles: Sparkles,
  box: Box,
  trending: TrendingUp,
  credit: CreditCard,
  money: DollarSign,
  approve: BadgeCheck,
  parts: PackageSearch,
};

/** Heuristic — map a quickAction id to a sensible default icon when no
 *  `icon` field is set on the row. Keeps existing layouts looking great
 *  without an explicit icon per action. */
function guessIcon(actionId: string): LucideIcon {
  if (actionId.includes("quote")) return FileText;
  if (actionId.includes("voice")) return Mic;
  if (actionId.includes("visit")) return MapPin;
  if (actionId.includes("lookup") || actionId.includes("search")) return Search;
  if (actionId.includes("draft")) return Files;
  if (actionId.includes("approval")) return BadgeCheck;
  if (actionId.includes("credit")) return CreditCard;
  if (actionId.includes("deposit") || actionId.includes("money")) return DollarSign;
  if (actionId.includes("replen") || actionId.includes("stock") || actionId.includes("parts")) return PackageSearch;
  if (actionId.includes("pdi") || actionId.includes("check")) return ClipboardCheck;
  if (actionId.includes("iron") || actionId.includes("ask")) return Sparkles;
  if (actionId.includes("pipeline")) return Activity;
  if (actionId.includes("job")) return Wrench;
  return Zap;
}

function resolveIcon(action: FloorQuickAction): LucideIcon {
  if (action.icon && ICON_MAP[action.icon]) return ICON_MAP[action.icon];
  return guessIcon(action.id);
}

export interface FloorHeroProps {
  actions: FloorQuickAction[];
}

export function FloorHero({ actions }: FloorHeroProps) {
  if (actions.length === 0) return null;
  // Column layout: 2 on mobile (or 1 if single), desktop mirrors action count up to 3.
  const gridCols =
    actions.length === 1
      ? "grid-cols-1"
      : actions.length === 2
        ? "grid-cols-2"
        : "grid-cols-2 sm:grid-cols-3";
  return (
    <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
      <div className={`grid gap-3 ${gridCols}`}>
        {actions.map((action, i) => (
          <QuickActionButton
            key={action.id}
            action={action}
            Icon={resolveIcon(action)}
            isPrimary={i === 0}
          />
        ))}
      </div>
    </div>
  );
}

function QuickActionButton({
  action,
  Icon,
  isPrimary,
}: {
  action: FloorQuickAction;
  Icon: LucideIcon;
  isPrimary: boolean;
}) {
  return (
    <Link
      to={action.route}
      className={[
        "group relative flex min-h-[100px] flex-col justify-between overflow-hidden rounded-xl border bg-[hsl(var(--qep-deck-elevated))] p-4 transition-all duration-150 ease-out",
        "hover:scale-[1.01] hover:border-[hsl(var(--qep-orange))] active:scale-[0.99]",
        isPrimary
          ? "border-[hsl(var(--qep-deck-rule))]"
          : "border-[hsl(var(--qep-deck-rule))]",
      ].join(" ")}
      aria-label={`${action.label}${action.subLabel ? ` — ${action.subLabel}` : ""}`}
    >
      {/* Orange left-rule on primary */}
      {isPrimary && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-[hsl(var(--qep-orange))]"
        />
      )}

      {/* Icon row */}
      <div className="flex items-center justify-between">
        <Icon
          className={`h-6 w-6 ${isPrimary ? "text-[hsl(var(--qep-orange))]" : "text-foreground"}`}
          aria-hidden="true"
        />
        <ArrowRight
          className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>

      {/* Label */}
      <div className="mt-3">
        <p className="font-display text-xl leading-tight tracking-[0.04em] text-foreground">
          {action.label}
        </p>
        {action.subLabel && (
          <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
            {action.subLabel}
          </p>
        )}
      </div>
    </Link>
  );
}
