/**
 * FloorComposePage — admin-only role composer.
 *
 * The minimum-viable curation surface: pick a role, see the role's
 * current layout, add/remove widgets from the palette, reorder with
 * up/down, save. Hard cap of 6 widgets enforced at the UI (mirrors
 * the DB CHECK constraint from migration 374).
 *
 * Quick-action editing is intentionally read-only in v1 — the seed
 * inserts populate each role with a sensible set; richer editing lands
 * in a follow-up slice. Editing a quick action requires label + route
 * inputs, which is a bigger UI than v1 needs.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Loader2,
  Plus,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { UserRole } from "@/lib/database.types";
import type { IronRole } from "@/features/qrm/lib/iron-roles";
import { IRON_ROLE_DISPLAY_NAMES } from "../lib/role-display-names";
import {
  FLOOR_WIDGET_REGISTRY,
  floorWidgetsForRole,
  resolveFloorWidget,
} from "../lib/floor-widget-registry";
import {
  FLOOR_WIDGET_CAP,
  type FloorLayout,
  type FloorLayoutWidget,
  type FloorQuickAction,
  normalizeFloorLayout,
  EMPTY_FLOOR_LAYOUT,
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

export function FloorComposePage({ userId, userRole, userFullName }: FloorComposePageProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  void userId;
  void userRole;

  // Force dark mode for brand consistency with the Floor.
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

  // Load the selected role's layout on role change.
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
          description: "Starting with an empty layout. Save will create a new row.",
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

  // Palette — widgets allowed for this role, minus the ones already on
  // the layout (avoid duplicate drops).
  const paletteWidgets = useMemo(() => {
    const currentIds = new Set(layout.widgets.map((w) => w.id));
    return floorWidgetsForRole(selectedRole).filter((w) => !currentIds.has(w.id));
  }, [selectedRole, layout.widgets]);

  // Resolved current widgets (with descriptor lookup for display).
  const resolvedWidgets = useMemo(() => {
    return layout.widgets
      .map((w, idx) => ({
        ...w,
        position: idx,
        descriptor: resolveFloorWidget(w.id),
      }))
      .filter(
        (w): w is FloorLayoutWidget & {
          position: number;
          descriptor: NonNullable<ReturnType<typeof resolveFloorWidget>>;
        } => !!w.descriptor,
      );
  }, [layout.widgets]);

  const atCap = layout.widgets.length >= FLOOR_WIDGET_CAP;

  // ── Mutations ───────────────────────────────────────────────────────────

  const addWidget = (id: string) => {
    if (atCap) return;
    setLayout((prev) => ({
      ...prev,
      widgets: [...prev.widgets, { id, order: prev.widgets.length }],
    }));
    setIsDirty(true);
  };

  const removeWidget = (id: string) => {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets
        .filter((w) => w.id !== id)
        .map((w, i) => ({ ...w, order: i })),
    }));
    setIsDirty(true);
  };

  const moveWidget = (id: string, direction: "up" | "down") => {
    setLayout((prev) => {
      const idx = prev.widgets.findIndex((w) => w.id === id);
      if (idx === -1) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.widgets.length) return prev;
      const next = [...prev.widgets];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved!);
      return {
        ...prev,
        widgets: next.map((w, i) => ({ ...w, order: i })),
      };
    });
    setIsDirty(true);
  };

  const toggleNarrative = () => {
    setLayout((prev) => ({ ...prev, showNarrative: !prev.showNarrative }));
    setIsDirty(true);
  };

  // ── Save ────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Upsert: rely on unique (workspace_id, iron_role) from migration 374.
      // workspace_id is filled via column default (get_my_workspace()).
      const { error } = await supabase
        .from("floor_layouts")
        .upsert(
          {
            iron_role: selectedRole,
            layout_json: layout,
          },
          { onConflict: "workspace_id,iron_role" },
        );
      if (error) throw error;
      toast({
        title: "Layout saved",
        description: `${IRON_ROLE_DISPLAY_NAMES[selectedRole]} now sees ${layout.widgets.length} widget${layout.widgets.length === 1 ? "" : "s"}.`,
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

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-[hsl(var(--qep-deck))] text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))]/95 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/floor")}
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
            <span className="font-display text-lg tracking-[0.06em]">
              COMPOSE
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {userFullName && (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {userFullName}
            </span>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="gap-1.5"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {isSaving ? "Saving" : isDirty ? "Save" : "Saved"}
          </Button>
        </div>
      </header>

      {/* Role selector */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[hsl(var(--qep-deck-rule))] px-4 py-3">
        <span className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
          Compose for
        </span>
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value as IronRole)}
          className="rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] px-3 py-1.5 text-sm font-semibold text-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none"
        >
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {IRON_ROLE_DISPLAY_NAMES[r]}
            </option>
          ))}
        </select>
        <span className="ml-auto font-kpi text-xs font-extrabold tabular-nums uppercase tracking-[0.14em] text-muted-foreground">
          <span className={atCap ? "text-[hsl(var(--qep-orange))]" : "text-foreground"}>
            {layout.widgets.length}
          </span>
          <span> / {FLOOR_WIDGET_CAP} widgets</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleNarrative}
          className="h-7 text-[11px]"
        >
          Narrative: {layout.showNarrative ? "ON" : "OFF"}
        </Button>
      </div>

      {/* Two-column body */}
      <div className="flex flex-1 flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
        {/* Palette */}
        <section className="md:w-[320px] md:shrink-0">
          <h2 className="mb-3 font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
            Palette — {paletteWidgets.length} available
          </h2>
          <div className="space-y-2">
            {paletteWidgets.length === 0 ? (
              <p className="rounded-md border border-dashed border-[hsl(var(--qep-deck-rule))] p-3 text-xs text-muted-foreground">
                All widgets for this role are already on the Floor. Remove one to add something else.
              </p>
            ) : (
              paletteWidgets.map((w) => (
                <PaletteRow
                  key={w.id}
                  title={w.title}
                  purpose={w.purpose}
                  onAdd={() => addWidget(w.id)}
                  disabled={atCap}
                />
              ))
            )}
          </div>
        </section>

        {/* Current layout */}
        <section className="flex-1">
          <h2 className="mb-3 font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
            On the Floor — {layout.widgets.length} widget{layout.widgets.length === 1 ? "" : "s"}
          </h2>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : resolvedWidgets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[hsl(var(--qep-deck-rule))] p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No widgets yet. Add from the palette on the left. Six max.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {resolvedWidgets.map((w, i) => (
                <li
                  key={w.id}
                  className="flex items-center gap-3 rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-3"
                >
                  <span className="shrink-0 font-kpi text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                    #{i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {w.descriptor.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {w.descriptor.purpose}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveWidget(w.id, "up")}
                      disabled={i === 0}
                      aria-label={`Move ${w.descriptor.title} up`}
                      className="h-7 w-7"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveWidget(w.id, "down")}
                      disabled={i === resolvedWidgets.length - 1}
                      aria-label={`Move ${w.descriptor.title} down`}
                      className="h-7 w-7"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeWidget(w.id)}
                      aria-label={`Remove ${w.descriptor.title}`}
                      className="h-7 w-7 text-muted-foreground hover:text-rose-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Quick actions (read-only v1) */}
          {layout.quickActions.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                Quick actions — read-only in v1
              </h2>
              <ul className="flex flex-wrap gap-2">
                {layout.quickActions.map((qa: FloorQuickAction) => (
                  <li
                    key={qa.id}
                    className="rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                  >
                    {qa.label}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      </div>

      {/* Footer hint */}
      <div className="shrink-0 border-t border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))]/95 px-4 py-2 text-[11px] text-muted-foreground">
        Changes apply to everyone in this workspace with the{" "}
        <span className="font-semibold text-foreground">
          {IRON_ROLE_DISPLAY_NAMES[selectedRole]}
        </span>{" "}
        role.{" "}
        <Link to="/floor" className="text-[hsl(var(--qep-orange))] hover:underline">
          Preview the Floor
        </Link>
      </div>
    </div>
  );
}

function PaletteRow({
  title,
  purpose,
  onAdd,
  disabled,
}: {
  title: string;
  purpose: string;
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{purpose}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onAdd}
        disabled={disabled}
        aria-label={`Add ${title}`}
        className="h-7 w-7 text-muted-foreground hover:text-[hsl(var(--qep-orange))] disabled:opacity-40"
        title={disabled ? "Floor is at the 6-widget cap" : `Add ${title}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// Avoid unused-import warning on FLOOR_WIDGET_REGISTRY (kept imported so
// consumers of this module have the canonical reference close at hand).
void FLOOR_WIDGET_REGISTRY;
