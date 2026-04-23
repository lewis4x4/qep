/**
 * The Floor — layout wire types.
 *
 * Mirrors the jsonb payload shape stored in `public.floor_layouts.layout_json`
 * (see supabase/migrations/374). The DB guards with CHECK constraints:
 *   - `widgets` array length <= 6
 *   - `quickActions` array length <= 3
 *
 * The frontend mirrors those caps in the composer UI and defensively
 * clamps anything it reads — a stale client shouldn't crash if somehow
 * more arrive.
 */
import type { IronRole } from "@/features/qrm/lib/iron-roles";

export const FLOOR_WIDGET_CAP = 6;
export const FLOOR_QUICK_ACTION_CAP = 3;

export interface FloorLayoutWidget {
  /** Widget id — resolved against the widget registry at render time. */
  id: string;
  /** Explicit display order. Array position is the tiebreaker. */
  order: number;
}

export interface FloorQuickAction {
  /** Stable id used for analytics + preferences. */
  id: string;
  /** UPPERCASE label shown on the giant hero button. Keep terse — Bebas Neue
   *  is wide. Target: 1–3 words. */
  label: string;
  /** Sub-label rendered in Inter 11pt. Optional — use when the primary
   *  label alone is ambiguous ("Start from serial"). */
  subLabel?: string;
  /** React Router path. External links are NOT supported here by design —
   *  the hero is for in-app navigation only. */
  route: string;
  /** Lucide icon name. Looked up at render time. Default: "ArrowRight". */
  icon?: string;
}

export interface FloorLayout {
  widgets: FloorLayoutWidget[];
  quickActions: FloorQuickAction[];
  /** When false, the narrative strip is hidden. Default: true. */
  showNarrative: boolean;
}

/** Wire row from `public.floor_layouts`. */
export interface FloorLayoutRow {
  id: string;
  workspace_id: string;
  iron_role: IronRole;
  layout_json: FloorLayout;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Empty layout — used when a role has no stored row yet. */
export const EMPTY_FLOOR_LAYOUT: FloorLayout = {
  widgets: [],
  quickActions: [],
  showNarrative: true,
};

/**
 * Defensive normalization — any persisted layout that violates the caps
 * (e.g. a stale row written before a cap tightened) is truncated on read
 * so the UI never crashes. The composer saves re-apply the caps on write,
 * so this is strictly forward-compat.
 */
export function normalizeFloorLayout(raw: unknown): FloorLayout {
  if (!raw || typeof raw !== "object") return { ...EMPTY_FLOOR_LAYOUT };
  const r = raw as Partial<FloorLayout>;
  const widgets = Array.isArray(r.widgets)
    ? r.widgets
        .filter((w): w is FloorLayoutWidget =>
          !!w && typeof w === "object" && typeof (w as FloorLayoutWidget).id === "string",
        )
        .slice(0, FLOOR_WIDGET_CAP)
        .map((w, i) => ({
          id: w.id,
          order: typeof w.order === "number" ? w.order : i,
        }))
        .sort((a, b) => a.order - b.order)
    : [];
  const quickActions = Array.isArray(r.quickActions)
    ? r.quickActions
        .filter((a): a is FloorQuickAction =>
          !!a && typeof a === "object" &&
          typeof (a as FloorQuickAction).id === "string" &&
          typeof (a as FloorQuickAction).label === "string" &&
          typeof (a as FloorQuickAction).route === "string",
        )
        .slice(0, FLOOR_QUICK_ACTION_CAP)
    : [];
  const showNarrative =
    typeof r.showNarrative === "boolean" ? r.showNarrative : true;
  return { widgets, quickActions, showNarrative };
}
