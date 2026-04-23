/**
 * FloorComposePage — Floor composer v2.
 *
 * Layout: 2/3 live preview + 1/3 palette. Drag widgets from the palette
 * onto the preview, drag within the preview to reorder, drag a widget
 * card back to the palette side (or click the × on it) to remove.
 * The preview is a scaled-down but faithful rendering of the Floor —
 * same narrative strip, same quick-action hero, same widget frames —
 * so Brian arranges exactly what the target role will see.
 *
 * Drag-drop is native HTML5 DataTransfer. No library.
 *
 * Narrative toggle lives in the role bar. Quick actions are read-only
 * in v1 (editing label/route/icon per action is a separate slice).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  GripVertical,
  Loader2,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";
import type { IronRole } from "@/features/qrm/lib/iron-roles";

import { FloorJumpMenu } from "../components/FloorJumpMenu";
import { FloorNarrative } from "../components/FloorNarrative";
import { FloorHero } from "../components/FloorHero";
import { FloorZoneLabel } from "../components/FloorZoneLabel";
import { IRON_ROLE_DISPLAY_NAMES } from "../lib/role-display-names";
import {
  FLOOR_WIDGET_REGISTRY,
  floorWidgetsForRole,
  resolveFloorWidget,
} from "../lib/floor-widget-registry";
import {
  EMPTY_FLOOR_LAYOUT,
  FLOOR_WIDGET_CAP,
  normalizeFloorLayout,
  type FloorLayout,
} from "../lib/layout-types";

export interface FloorComposePageProps {
  userId: string;
  userRole: UserRole;
  userFullName: string | null;
}

const ALL_ROLES: IronRole[] = [
  "iron_manager",
  "iron_advisor",
  "iron_woman",
  "iron_man",
  "iron_owner",
  "iron_parts_counter",
  "iron_parts_manager",
];

const DND_MIME_PALETTE = "application/x-floor-palette-widget";
const DND_MIME_REORDER = "application/x-floor-reorder-widget";

export function FloorComposePage({
  userId,
  userRole,
  userFullName,
}: FloorComposePageProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  void userId;
  void userRole;

  // Force dark mode — the Floor is always dark.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  const [selectedRole, setSelectedRole] = useState<IronRole>("iron_manager");
  const [layout, setLayout] = useState<FloorLayout>({ ...EMPTY_FLOOR_LAYOUT });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // ── Load selected role's layout ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("floor_layouts")
        .select("layout_json")
        .eq("iron_role", selectedRole)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast({
          title: "Couldn't load layout",
          description: "Starting from an empty layout. Save creates a new row.",
          variant: "destructive",
        });
        setLayout({ ...EMPTY_FLOOR_LAYOUT });
      } else if (data) {
        setLayout(normalizeFloorLayout(data.layout_json));
      } else {
        setLayout({ ...EMPTY_FLOOR_LAYOUT });
      }
      setIsDirty(false);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRole, toast]);

  // ── Palette — widgets allowed for role, minus those already placed ─────
  const paletteWidgets = useMemo(() => {
    const placed = new Set(layout.widgets.map((w) => w.id));
    return floorWidgetsForRole(selectedRole).filter((w) => !placed.has(w.id));
  }, [selectedRole, layout.widgets]);

  const atCap = layout.widgets.length >= FLOOR_WIDGET_CAP;

  // ── Layout mutations ──────────────────────────────────────────────────
  const addWidget = (id: string, atIndex?: number) => {
    if (atCap) return;
    setLayout((prev) => {
      if (prev.widgets.some((w) => w.id === id)) return prev;
      const nextList = [...prev.widgets];
      const insertAt = atIndex == null ? nextList.length : Math.min(atIndex, nextList.length);
      nextList.splice(insertAt, 0, { id, order: insertAt });
      return { ...prev, widgets: nextList.map((w, i) => ({ ...w, order: i })) };
    });
    setIsDirty(true);
  };

  const removeWidget = (id: string) => {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((w) => w.id !== id).map((w, i) => ({ ...w, order: i })),
    }));
    setIsDirty(true);
  };

  const moveWidget = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setLayout((prev) => {
      const next = [...prev.widgets];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
      next.splice(insertAt, 0, moved);
      return { ...prev, widgets: next.map((w, i) => ({ ...w, order: i })) };
    });
    setIsDirty(true);
  };

  const toggleNarrative = () => {
    setLayout((prev) => ({ ...prev, showNarrative: !prev.showNarrative }));
    setIsDirty(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("floor_layouts")
        .upsert(
          { iron_role: selectedRole, layout_json: layout },
          { onConflict: "workspace_id,iron_role" },
        );
      if (error) throw error;
      toast({
        title: "Layout saved",
        description: `${IRON_ROLE_DISPLAY_NAMES[selectedRole]} now sees ${layout.widgets.length} widget${
          layout.widgets.length === 1 ? "" : "s"
        }.`,
      });
      setIsDirty(false);
    } catch (err) {
      toast({
        title: "Couldn't save layout",
        description: err instanceof Error ? err.message : "Unknown error.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="floor-texture flex min-h-screen flex-col bg-[hsl(var(--qep-deck))] text-foreground">
      <ComposeTopBar
        userFullName={userFullName}
        isSaving={isSaving}
        isDirty={isDirty}
        onSave={handleSave}
        onBack={() => navigate("/floor")}
      />
      <RoleBar
        selectedRole={selectedRole}
        onSelectRole={(r) => setSelectedRole(r)}
        widgetCount={layout.widgets.length}
        cap={FLOOR_WIDGET_CAP}
        showNarrative={layout.showNarrative}
        onToggleNarrative={toggleNarrative}
        atCap={atCap}
      />

      <div className="flex flex-1 flex-col md:flex-row">
        {/* 2/3 LIVE PREVIEW */}
        <div className="flex-1 md:basis-2/3 md:border-r md:border-[hsl(var(--qep-deck-rule))]">
          <PreviewPane
            selectedRole={selectedRole}
            layout={layout}
            isLoading={isLoading}
            atCap={atCap}
            userFullName={userFullName}
            onAddFromPalette={addWidget}
            onRemoveWidget={removeWidget}
            onMoveWidget={moveWidget}
          />
        </div>

        {/* 1/3 PALETTE */}
        <div className="md:basis-1/3">
          <PalettePane
            widgets={paletteWidgets}
            atCap={atCap}
            onQuickAdd={(id) => addWidget(id)}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))]/95 px-4 py-2 text-[11px] text-muted-foreground">
        Changes apply to every user in this workspace with the{" "}
        <span className="font-semibold text-foreground">
          {IRON_ROLE_DISPLAY_NAMES[selectedRole]}
        </span>{" "}
        role.{" "}
        <Link to="/floor" className="text-[hsl(var(--qep-orange))] hover:underline">
          Preview on the Floor
        </Link>
      </div>
    </div>
  );
}

// ── Top bar ─────────────────────────────────────────────────────────────

function ComposeTopBar({
  userFullName,
  isSaving,
  isDirty,
  onSave,
  onBack,
}: {
  userFullName: string | null;
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onBack: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))]/95 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-8 gap-1 text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Floor
        </Button>
        <span className="hidden h-4 w-px bg-[hsl(var(--qep-deck-rule))] sm:block" />
        <div className="hidden items-center gap-2 sm:flex">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-sm bg-[hsl(var(--qep-orange))] text-[hsl(var(--qep-dark))]"
          >
            <Wrench className="h-3.5 w-3.5" />
          </span>
          <span className="font-display text-lg tracking-[0.06em]">COMPOSE</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden sm:block">
          <FloorJumpMenu />
        </div>
        {userFullName && (
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {userFullName}
          </span>
        )}
        <Button size="sm" onClick={onSave} disabled={!isDirty || isSaving} className="gap-1.5">
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {isSaving ? "Saving" : isDirty ? "Save" : "Saved"}
        </Button>
      </div>
    </header>
  );
}

// ── Role bar ────────────────────────────────────────────────────────────

function RoleBar({
  selectedRole,
  onSelectRole,
  widgetCount,
  cap,
  showNarrative,
  onToggleNarrative,
  atCap,
}: {
  selectedRole: IronRole;
  onSelectRole: (r: IronRole) => void;
  widgetCount: number;
  cap: number;
  showNarrative: boolean;
  onToggleNarrative: () => void;
  atCap: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))]/50 px-4 py-3">
      <span className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
        Compose for
      </span>
      <select
        value={selectedRole}
        onChange={(e) => onSelectRole(e.target.value as IronRole)}
        className="rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] px-3 py-1.5 text-sm font-semibold text-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none"
      >
        {ALL_ROLES.map((r) => (
          <option key={r} value={r}>
            {IRON_ROLE_DISPLAY_NAMES[r]}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        onClick={onToggleNarrative}
        className="h-7 text-[11px]"
      >
        Narrative: {showNarrative ? "ON" : "OFF"}
      </Button>
      <span className="ml-auto font-kpi text-xs font-extrabold tabular-nums uppercase tracking-[0.14em] text-muted-foreground">
        <span className={atCap ? "text-[hsl(var(--qep-orange))]" : "text-foreground"}>
          {widgetCount}
        </span>
        <span> / {cap} widgets</span>
      </span>
    </div>
  );
}

// ── Preview pane ────────────────────────────────────────────────────────
//
// WYSIWYG-style rendering: the preview draws the REAL Floor components
// (FloorNarrative · FloorHero · actual widget components) so Brian sees
// exactly what the target role will see. Widget bodies are wrapped in
// pointer-events-none; the compose chrome (position badge, remove,
// up/down) lives in a pointer-events-auto overlay above.
//
// Drag-drop model:
//   • Each card's onDragOver decides insertion position based on cursor
//     Y relative to the card's mid-line (top half = insert before me,
//     bottom half = insert after me) and writes `insertion` state with
//     { index, before }.
//   • A thin orange line renders ABOVE the card at `insertion.index`
//     when `before=true`, or BELOW at `insertion.index + 1` when
//     `before=false`.
//   • onDrop reads DND_MIME_PALETTE (new widget) or DND_MIME_REORDER
//     (existing widget index) and commits the move.
//   • onDragEnd clears insertion state so a cancelled drag leaves
//     no orphan indicator.
//
// Up/down arrow buttons are a keyboard-friendly fallback for the
// drag-averse (or touch devices).

type Insertion = { index: number; before: boolean } | null;

function PreviewPane({
  selectedRole,
  layout,
  isLoading,
  atCap,
  userFullName,
  onAddFromPalette,
  onRemoveWidget,
  onMoveWidget,
}: {
  selectedRole: IronRole;
  layout: FloorLayout;
  isLoading: boolean;
  atCap: boolean;
  userFullName: string | null;
  onAddFromPalette: (id: string, atIndex?: number) => void;
  onRemoveWidget: (id: string) => void;
  onMoveWidget: (from: number, to: number) => void;
}) {
  const [insertion, setInsertion] = useState<Insertion>(null);
  const [dragSource, setDragSource] = useState<number | null>(null);
  const firstName = (userFullName ?? "").split(" ").filter(Boolean)[0] ?? "";

  const computeInsertionForCard = (e: React.DragEvent, index: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const before = e.clientY < midY;
    setInsertion((prev) => {
      if (prev && prev.index === index && prev.before === before) return prev;
      return { index, before };
    });
  };

  const resolveTargetIndex = (ins: Insertion): number => {
    if (!ins) return layout.widgets.length;
    return ins.before ? ins.index : ins.index + 1;
  };

  const onCardDragOver = (e: React.DragEvent, index: number) => {
    const types = e.dataTransfer.types;
    if (!types.includes(DND_MIME_PALETTE) && !types.includes(DND_MIME_REORDER)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes(DND_MIME_PALETTE) ? "copy" : "move";
    computeInsertionForCard(e, index);
  };

  const onGridDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (!types.includes(DND_MIME_PALETTE) && !types.includes(DND_MIME_REORDER)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes(DND_MIME_PALETTE) ? "copy" : "move";
    // If nothing's set yet (user dragged into empty grid area), default
    // to "append at end".
    setInsertion((prev) =>
      prev ?? { index: Math.max(0, layout.widgets.length - 1), before: false },
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const paletteId = e.dataTransfer.getData(DND_MIME_PALETTE);
    const reorderIdxRaw = e.dataTransfer.getData(DND_MIME_REORDER);
    const target = resolveTargetIndex(insertion);

    if (paletteId) {
      onAddFromPalette(paletteId, target);
    } else if (reorderIdxRaw) {
      const from = Number(reorderIdxRaw);
      if (Number.isFinite(from)) onMoveWidget(from, target);
    }
    setInsertion(null);
    setDragSource(null);
  };

  const handleDragEnd = () => {
    setInsertion(null);
    setDragSource(null);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="pointer-events-none sticky top-0 z-10 bg-gradient-to-b from-[hsl(var(--qep-deck))] to-transparent p-3">
        <FloorZoneLabel
          index="PREVIEW"
          label={IRON_ROLE_DISPLAY_NAMES[selectedRole].toUpperCase()}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading layout…
        </div>
      ) : (
        <div className="flex flex-col pb-6">
          {layout.showNarrative && (
            <>
              <FloorZoneLabel index="01" label="NARRATIVE" />
              <FloorNarrative role={selectedRole} userFirstName={firstName} />
            </>
          )}

          {layout.quickActions.length > 0 && (
            <>
              <FloorZoneLabel index="02" label="ACTIONS" className="mt-2" />
              <FloorHero actions={layout.quickActions} />
            </>
          )}

          <FloorZoneLabel index="03" label="THE FLOOR" className="mt-4" />

          <div
            onDragOver={onGridDragOver}
            onDrop={handleDrop}
            className={cn(
              "mx-4 mt-2 rounded-xl border-2 border-dashed p-3 transition-colors sm:mx-6",
              insertion != null
                ? "border-[hsl(var(--qep-orange))]/70 bg-[hsl(var(--qep-orange))]/5"
                : "border-[hsl(var(--qep-deck-rule))]/60",
            )}
          >
            {layout.widgets.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <p className="font-display text-2xl tracking-[0.04em] text-foreground">
                  EMPTY FLOOR
                </p>
                <p className="mt-2">
                  Drag widgets from the palette → . Six max. Drop them here to add.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {layout.widgets.map((w, i) => {
                  const isBeingDragged = dragSource === i;
                  const showIndicatorAbove =
                    insertion != null && insertion.index === i && insertion.before;
                  const showIndicatorBelow =
                    insertion != null && insertion.index === i && !insertion.before;
                  return (
                    <PreviewWidget
                      key={w.id}
                      position={i}
                      widgetId={w.id}
                      totalCount={layout.widgets.length}
                      isBeingDragged={isBeingDragged}
                      showIndicatorAbove={showIndicatorAbove}
                      showIndicatorBelow={showIndicatorBelow}
                      onRemove={() => onRemoveWidget(w.id)}
                      onDragStart={() => setDragSource(i)}
                      onDragOver={(e) => onCardDragOver(e, i)}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                      onMoveUp={() => i > 0 && onMoveWidget(i, i - 1)}
                      onMoveDown={() =>
                        i < layout.widgets.length - 1 && onMoveWidget(i, i + 2)
                      }
                    />
                  );
                })}
                {!atCap && (
                  <div
                    onDragOver={onGridDragOver}
                    onDrop={handleDrop}
                    className="flex min-h-[140px] items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--qep-deck-rule))]/60 px-3 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--qep-orange))]/60"
                    aria-label="Drop zone — append widget"
                  >
                    Drop here to append · or drag a palette card
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Preview widget card ─────────────────────────────────────────────────
//
// Renders the REAL widget component inside a pointer-events-none shell
// so Brian sees the widget exactly as Rylee/David/Juan will. A floating
// overlay in the top-right carries the compose controls (grip, remove,
// up/down) and IS interactive. Orange insertion indicators render on
// top or bottom based on the parent's hover resolution.

function PreviewWidget({
  position,
  widgetId,
  totalCount,
  isBeingDragged,
  showIndicatorAbove,
  showIndicatorBelow,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMoveUp,
  onMoveDown,
}: {
  position: number;
  widgetId: string;
  totalCount: number;
  isBeingDragged: boolean;
  showIndicatorAbove: boolean;
  showIndicatorBelow: boolean;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const descriptor = resolveFloorWidget(widgetId);
  const title = descriptor?.title ?? widgetId;
  const size = descriptor?.size ?? "normal";
  const Component = descriptor?.component ?? null;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DND_MIME_REORDER, String(position));
    e.dataTransfer.effectAllowed = "move";
    onDragStart();
  };

  const canMoveUp = position > 0;
  const canMoveDown = position < totalCount - 1;

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative",
        size === "wide" ? "md:col-span-2" : "",
        isBeingDragged ? "opacity-40" : "",
      )}
    >
      {/* Insertion indicator above */}
      {showIndicatorAbove && <InsertionLine />}

      <div
        className={cn(
          "relative flex min-h-[140px] cursor-grab flex-col overflow-hidden rounded-xl border bg-[hsl(var(--qep-deck-elevated))] transition-all active:cursor-grabbing",
          "border-[hsl(var(--qep-deck-rule))] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]",
          "hover:border-[hsl(var(--qep-orange))]/40 hover:shadow-[0_0_24px_-12px_hsl(var(--qep-orange))]",
        )}
      >
        {/* Compose chrome overlay — interactive */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/90 px-1.5 py-1 text-[10px] font-kpi font-extrabold uppercase tracking-[0.14em] backdrop-blur">
            <GripVertical
              className="h-3 w-3 text-[hsl(var(--qep-orange))]"
              aria-hidden="true"
            />
            <span className="text-foreground">#{position + 1}</span>
            {size === "wide" && (
              <span className="rounded border border-[hsl(var(--qep-orange))]/40 bg-[hsl(var(--qep-orange))]/10 px-1 py-0.5 text-[9px] text-[hsl(var(--qep-orange))]">
                Wide
              </span>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/90 p-0.5 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label={`Move ${title} up`}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-[hsl(var(--qep-orange))]/10 hover:text-[hsl(var(--qep-orange))] disabled:opacity-40"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label={`Move ${title} down`}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-[hsl(var(--qep-orange))]/10 hover:text-[hsl(var(--qep-orange))] disabled:opacity-40"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-[hsl(var(--qep-deck-rule))]" />
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${title}`}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Real widget rendering — disabled for interaction. The compose
            chrome above sits on top in the z-order. */}
        <div className="pointer-events-none h-full flex-1">
          {Component ? (
            <Component />
          ) : (
            <div className="flex h-full min-h-[140px] items-center justify-center p-4 text-center text-xs text-muted-foreground">
              Unregistered widget (<code className="font-mono">{widgetId}</code>) — will be hidden on the Floor.
            </div>
          )}
        </div>
      </div>

      {/* Insertion indicator below */}
      {showIndicatorBelow && <InsertionLine />}
    </div>
  );
}

/** Thin 2px orange line with soft glow — drop-position indicator. */
function InsertionLine() {
  return (
    <div
      aria-hidden="true"
      className="relative my-1 h-[2px] w-full rounded-full bg-[hsl(var(--qep-orange))] shadow-[0_0_12px_0_hsl(var(--qep-orange))]"
    />
  );
}

// ── Palette pane ────────────────────────────────────────────────────────

function PalettePane({
  widgets,
  atCap,
  onQuickAdd,
}: {
  widgets: ReturnType<typeof floorWidgetsForRole>;
  atCap: boolean;
  onQuickAdd: (id: string) => void;
}) {
  // Filter input for the palette — when sir has 14+ widgets to browse,
  // typing narrows faster than scrolling.
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return widgets;
    return widgets.filter((w) => {
      return (
        w.id.toLowerCase().includes(q) ||
        w.title.toLowerCase().includes(q) ||
        w.purpose.toLowerCase().includes(q)
      );
    });
  }, [widgets, filter]);

  return (
    <aside className="flex h-full flex-col bg-[hsl(var(--qep-deck-elevated))]/40">
      <div className="shrink-0 border-b border-[hsl(var(--qep-deck-rule))] px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Palette · {widgets.length} available
          </h2>
          {atCap && (
            <span className="rounded border border-[hsl(var(--qep-orange))]/40 bg-[hsl(var(--qep-orange))]/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--qep-orange))]">
              At cap
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter widgets…"
          className="mt-2 h-8 w-full rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] px-2 text-xs placeholder:text-muted-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none"
        />
      </div>

      <div className="flex-1 space-y-2 overflow-auto p-3">
        {widgets.length === 0 ? (
          <p className="rounded-md border border-dashed border-[hsl(var(--qep-deck-rule))] p-3 text-xs text-muted-foreground">
            Every widget allowed for this role is already on the Floor. Remove one to add something else.
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-md border border-dashed border-[hsl(var(--qep-deck-rule))] p-3 text-xs text-muted-foreground">
            No match for <span className="font-semibold text-foreground">{filter}</span>.
          </p>
        ) : (
          filtered.map((w) => (
            <PaletteCard
              key={w.id}
              widgetId={w.id}
              title={w.title}
              purpose={w.purpose}
              size={w.size}
              disabled={atCap}
              onQuickAdd={() => onQuickAdd(w.id)}
            />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-[hsl(var(--qep-deck-rule))] px-4 py-2 text-[10px] text-muted-foreground">
        Drag a card onto the preview → or click to add to the end.
      </div>
    </aside>
  );
}

function PaletteCard({
  widgetId,
  title,
  purpose,
  size,
  disabled,
  onQuickAdd,
}: {
  widgetId: string;
  title: string;
  purpose: string;
  size: "normal" | "wide";
  disabled: boolean;
  onQuickAdd: () => void;
}) {
  const onDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DND_MIME_PALETTE, widgetId);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <button
      type="button"
      draggable={!disabled}
      onDragStart={onDragStart}
      onClick={disabled ? undefined : onQuickAdd}
      disabled={disabled}
      aria-label={disabled ? `${title} — Floor at cap` : `Add ${title}`}
      className={cn(
        "group relative flex w-full cursor-grab flex-col items-start gap-1 rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-3 text-left transition-all",
        "hover:border-[hsl(var(--qep-orange))]/60 hover:shadow-[0_0_20px_-10px_hsl(var(--qep-orange))]",
        "active:cursor-grabbing",
        disabled && "cursor-not-allowed opacity-40 hover:border-[hsl(var(--qep-deck-rule))] hover:shadow-none",
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px] bg-[hsl(var(--qep-orange))]/30 group-hover:bg-[hsl(var(--qep-orange))]"
      />
      <div className="flex items-center gap-1.5">
        <GripVertical
          className="h-3 w-3 text-muted-foreground opacity-50 group-hover:opacity-100"
          aria-hidden="true"
        />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {size === "wide" && (
          <span className="rounded border border-[hsl(var(--qep-orange))]/40 bg-[hsl(var(--qep-orange))]/5 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--qep-orange))]">
            Wide
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{purpose}</p>
    </button>
  );
}

// Keep the registry reference close at hand for downstream contributors.
void FLOOR_WIDGET_REGISTRY;
void FLOOR_WIDGET_CAP;
void EMPTY_FLOOR_LAYOUT;
