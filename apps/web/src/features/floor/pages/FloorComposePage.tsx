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
 * Drag-drop is native HTML5 DataTransfer with always-visible arrow controls
 * as the touch fallback.
 *
 * Narrative, quick actions, role defaults, user overrides, and audit history
 * are edited here. The DB still enforces the six-widget / three-action caps.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Clock,
  GripVertical,
  History,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
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
import { FloorHero, FLOOR_QUICK_ACTION_ICON_MAP } from "../components/FloorHero";
import { FloorZoneLabel } from "../components/FloorZoneLabel";
import { DEFAULT_FLOOR_LAYOUTS } from "../lib/default-layouts";
import { IRON_ROLE_DISPLAY_NAMES } from "../lib/role-display-names";
import {
  FLOOR_WIDGET_REGISTRY,
  floorWidgetsForRole,
  resolveFloorWidget,
} from "../lib/floor-widget-registry";
import {
  EMPTY_FLOOR_LAYOUT,
  FLOOR_QUICK_ACTION_CAP,
  FLOOR_WIDGET_CAP,
  normalizeFloorLayout,
  type FloorLayout,
  type FloorQuickAction,
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
const FLOOR_LAYOUT_SELECT =
  "id, workspace_id, iron_role, user_id, layout_json, updated_by, created_at, updated_at";

type ComposeTargetMode = "role" | "user";

interface ComposeProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  iron_role: string | null;
}

interface ComposeLayoutRow {
  id: string;
  workspace_id: string;
  iron_role: IronRole;
  user_id: string | null;
  layout_json: unknown;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface LayoutAuditRow {
  id: string;
  action: string;
  created_at: string;
  actor_user_id: string | null;
  subject_user_id: string | null;
  old_layout_json: unknown;
  new_layout_json: unknown;
}

function cloneDefaultLayout(role: IronRole): FloorLayout {
  return normalizeFloorLayout(DEFAULT_FLOOR_LAYOUTS[role]);
}

function validateQuickActions(actions: FloorQuickAction[]): string | null {
  for (const action of actions) {
    if (!action.label.trim()) return "Every quick action needs a label.";
    if (!action.route.trim().startsWith("/")) {
      return `${action.label || action.id} needs an in-app route that starts with "/".`;
    }
  }
  return null;
}

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
  const [targetMode, setTargetMode] = useState<ComposeTargetMode>("role");
  const [selectedSubjectUserId, setSelectedSubjectUserId] = useState<string>("");
  const [profilesForRole, setProfilesForRole] = useState<ComposeProfile[]>([]);
  const [layout, setLayout] = useState<FloorLayout>({ ...EMPTY_FLOOR_LAYOUT });
  const [layoutRowId, setLayoutRowId] = useState<string | null>(null);
  const [isInheritedRoleDefault, setIsInheritedRoleDefault] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditRows, setAuditRows] = useState<LayoutAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // ── Load profiles that can receive a user override ─────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, iron_role")
        .eq("iron_role", selectedRole)
        .order("full_name", { ascending: true });

      if (cancelled) return;
      if (error) {
        setProfilesForRole([]);
        return;
      }
      const rows = (data ?? []) as ComposeProfile[];
      setProfilesForRole(rows);
      setSelectedSubjectUserId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return rows[0]?.id ?? "";
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRole]);

  const selectedSubjectUser = profilesForRole.find((row) => row.id === selectedSubjectUserId) ?? null;
  const activeSubjectUserId = targetMode === "user" ? selectedSubjectUserId || null : null;

  // ── Load selected role/user layout ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      let loadedRow: ComposeLayoutRow | null = null;
      let inherited = false;

      if (activeSubjectUserId) {
        const { data: override, error: overrideError } = await supabase
          .from("floor_layouts")
          .select(FLOOR_LAYOUT_SELECT)
          .eq("iron_role", selectedRole)
          .eq("user_id", activeSubjectUserId)
          .limit(1)
          .maybeSingle();
        if (overrideError) throw overrideError;
        loadedRow = (override as ComposeLayoutRow | null) ?? null;
      }

      if (!loadedRow) {
        const { data, error } = await supabase
        .from("floor_layouts")
        .select(FLOOR_LAYOUT_SELECT)
        .eq("iron_role", selectedRole)
          .is("user_id", null)
          .limit(1)
        .maybeSingle();
        if (error) throw error;
        loadedRow = (data as ComposeLayoutRow | null) ?? null;
        inherited = Boolean(activeSubjectUserId);
      }

      if (cancelled) return;
      setLayout(loadedRow ? normalizeFloorLayout(loadedRow.layout_json) : { ...EMPTY_FLOOR_LAYOUT });
      setLayoutRowId(inherited ? null : loadedRow?.id ?? null);
      setIsInheritedRoleDefault(inherited);
      setIsDirty(false);
      setIsLoading(false);
    })().catch((error: unknown) => {
      if (cancelled) return;
      toast({
        title: "Couldn't load layout",
        description: error instanceof Error ? error.message : "Starting from an empty layout.",
        variant: "destructive",
      });
      setLayout({ ...EMPTY_FLOOR_LAYOUT });
      setLayoutRowId(null);
      setIsInheritedRoleDefault(false);
      setIsDirty(false);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRole, activeSubjectUserId, toast]);

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

  const updateQuickAction = (index: number, patch: Partial<FloorQuickAction>) => {
    setLayout((prev) => ({
      ...prev,
      quickActions: prev.quickActions.map((action, i) =>
        i === index ? { ...action, ...patch } : action,
      ),
    }));
    setIsDirty(true);
  };

  const addQuickAction = () => {
    setLayout((prev) => {
      if (prev.quickActions.length >= FLOOR_QUICK_ACTION_CAP) return prev;
      const nextIndex = prev.quickActions.length + 1;
      return {
        ...prev,
        quickActions: [
          ...prev.quickActions,
          {
            id: `quick_action_${nextIndex}`,
            label: "NEW ACTION",
            route: "/floor",
            icon: "spark",
          },
        ],
      };
    });
    setIsDirty(true);
  };

  const removeQuickAction = (index: number) => {
    setLayout((prev) => ({
      ...prev,
      quickActions: prev.quickActions.filter((_, i) => i !== index),
    }));
    setIsDirty(true);
  };

  const resetToDefaults = () => {
    setLayout(cloneDefaultLayout(selectedRole));
    setIsDirty(true);
  };

  const deleteUserOverride = async () => {
    if (!activeSubjectUserId) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("floor_layouts")
        .delete()
        .eq("iron_role", selectedRole)
        .eq("user_id", activeSubjectUserId);
      if (error) throw error;
      setLayout(cloneDefaultLayout(selectedRole));
      setLayoutRowId(null);
      setIsInheritedRoleDefault(true);
      setIsDirty(false);
      toast({
        title: "Override cleared",
        description: `${selectedSubjectUser?.full_name ?? selectedSubjectUser?.email ?? "This user"} now inherits the role default.`,
      });
    } catch (err) {
      toast({
        title: "Couldn't clear override",
        description: err instanceof Error ? err.message : "Unknown error.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!auditOpen) return;
    let cancelled = false;
    setAuditLoading(true);
    (async () => {
      let query = supabase
        .from("floor_layout_audit")
        .select("id, action, created_at, actor_user_id, subject_user_id, old_layout_json, new_layout_json")
        .eq("iron_role", selectedRole)
        .order("created_at", { ascending: false })
        .limit(12);

      if (activeSubjectUserId) query = query.eq("subject_user_id", activeSubjectUserId);

      const { data, error } = await query;
      if (error) throw error;
      if (!cancelled) setAuditRows((data ?? []) as LayoutAuditRow[]);
    })()
      .catch(() => {
        if (!cancelled) setAuditRows([]);
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [auditOpen, selectedRole, activeSubjectUserId]);

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const quickActionError = validateQuickActions(layout.quickActions);
    if (quickActionError) {
      toast({
        title: "Quick action needs cleanup",
        description: quickActionError,
        variant: "destructive",
      });
      return;
    }
    if (targetMode === "user" && !activeSubjectUserId) {
      toast({
        title: "Choose a user",
        description: "A per-user override needs a target profile.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        iron_role: selectedRole,
        user_id: activeSubjectUserId,
        layout_json: layout,
        updated_by: userId,
      };

      if (layoutRowId) {
        const { error } = await supabase
          .from("floor_layouts")
          .update(payload)
          .eq("id", layoutRowId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("floor_layouts")
          .insert(payload)
          .select(FLOOR_LAYOUT_SELECT)
          .single();
        if (error) throw error;
        setLayoutRowId((data as ComposeLayoutRow).id);
      }

      toast({
        title: "Layout saved",
        description:
          targetMode === "user" && selectedSubjectUser
            ? `${selectedSubjectUser.full_name ?? selectedSubjectUser.email} now has a custom Floor.`
            : `${IRON_ROLE_DISPLAY_NAMES[selectedRole]} now sees ${layout.widgets.length} widget${
                layout.widgets.length === 1 ? "" : "s"
              }.`,
      });
      setIsInheritedRoleDefault(false);
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
        onReset={resetToDefaults}
        onToggleHistory={() => setAuditOpen((open) => !open)}
        historyOpen={auditOpen}
      />
      <RoleBar
        selectedRole={selectedRole}
        onSelectRole={(r) => setSelectedRole(r)}
        targetMode={targetMode}
        onSetTargetMode={setTargetMode}
        profiles={profilesForRole}
        selectedSubjectUserId={selectedSubjectUserId}
        onSelectSubjectUser={setSelectedSubjectUserId}
        isInheritedRoleDefault={isInheritedRoleDefault}
        onDeleteUserOverride={deleteUserOverride}
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
            quickActions={layout.quickActions}
            onAddQuickAction={addQuickAction}
            onUpdateQuickAction={updateQuickAction}
            onRemoveQuickAction={removeQuickAction}
            onQuickAdd={(id) => addWidget(id)}
          />
        </div>
      </div>

      {auditOpen && (
        <AuditDrawer
          rows={auditRows}
          isLoading={auditLoading}
          onClose={() => setAuditOpen(false)}
        />
      )}

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
  onReset,
  onToggleHistory,
  historyOpen,
}: {
  userFullName: string | null;
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onBack: () => void;
  onReset: () => void;
  onToggleHistory: () => void;
  historyOpen: boolean;
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
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          className="hidden h-8 gap-1 text-[11px] sm:inline-flex"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        <Button
          variant={historyOpen ? "default" : "outline"}
          size="sm"
          onClick={onToggleHistory}
          className="h-8 gap-1 text-[11px]"
        >
          <History className="h-3.5 w-3.5" />
          History
        </Button>
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
  targetMode,
  onSetTargetMode,
  profiles,
  selectedSubjectUserId,
  onSelectSubjectUser,
  isInheritedRoleDefault,
  onDeleteUserOverride,
  widgetCount,
  cap,
  showNarrative,
  onToggleNarrative,
  atCap,
}: {
  selectedRole: IronRole;
  onSelectRole: (r: IronRole) => void;
  targetMode: ComposeTargetMode;
  onSetTargetMode: (mode: ComposeTargetMode) => void;
  profiles: ComposeProfile[];
  selectedSubjectUserId: string;
  onSelectSubjectUser: (id: string) => void;
  isInheritedRoleDefault: boolean;
  onDeleteUserOverride: () => void;
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
      <div className="inline-flex rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] p-0.5">
        {(["role", "user"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onSetTargetMode(mode)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors",
              targetMode === mode
                ? "bg-[hsl(var(--qep-orange))] text-[hsl(var(--qep-dark))]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {mode === "role" ? "Role default" : "User override"}
          </button>
        ))}
      </div>
      {targetMode === "user" && (
        <>
          <select
            value={selectedSubjectUserId}
            onChange={(e) => onSelectSubjectUser(e.target.value)}
            className="max-w-[240px] rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] px-3 py-1.5 text-sm font-semibold text-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none"
          >
            {profiles.length === 0 ? (
              <option value="">No profiles for role</option>
            ) : (
              profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name ?? profile.email ?? profile.id}
                </option>
              ))
            )}
          </select>
          {isInheritedRoleDefault ? (
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Inheriting role default
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onDeleteUserOverride}
              className="h-7 gap-1 text-[11px]"
            >
              <Trash2 className="h-3 w-3" />
              Clear override
            </Button>
          )}
        </>
      )}
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

          <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/90 p-0.5 opacity-100 backdrop-blur transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
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
  quickActions,
  onAddQuickAction,
  onUpdateQuickAction,
  onRemoveQuickAction,
  onQuickAdd,
}: {
  widgets: ReturnType<typeof floorWidgetsForRole>;
  atCap: boolean;
  quickActions: FloorQuickAction[];
  onAddQuickAction: () => void;
  onUpdateQuickAction: (index: number, patch: Partial<FloorQuickAction>) => void;
  onRemoveQuickAction: (index: number) => void;
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

      <div className="flex-1 space-y-4 overflow-auto p-3">
        <QuickActionEditor
          actions={quickActions}
          onAdd={onAddQuickAction}
          onUpdate={onUpdateQuickAction}
          onRemove={onRemoveQuickAction}
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
              Widgets
            </h3>
            <span className="text-[10px] text-muted-foreground">{filtered.length} shown</span>
          </div>
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
      </div>

      <div className="shrink-0 border-t border-[hsl(var(--qep-deck-rule))] px-4 py-2 text-[10px] text-muted-foreground">
        Drag a card onto the preview → or click to add to the end.
      </div>
    </aside>
  );
}

function QuickActionEditor({
  actions,
  onAdd,
  onUpdate,
  onRemove,
}: {
  actions: FloorQuickAction[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<FloorQuickAction>) => void;
  onRemove: (index: number) => void;
}) {
  const iconOptions = Object.keys(FLOOR_QUICK_ACTION_ICON_MAP);
  return (
    <section className="rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Quick actions
          </h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {actions.length} / {FLOOR_QUICK_ACTION_CAP} hero buttons
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={actions.length >= FLOOR_QUICK_ACTION_CAP}
          className="h-7 gap-1 text-[11px]"
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>
      {actions.length === 0 ? (
        <p className="rounded-md border border-dashed border-[hsl(var(--qep-deck-rule))] p-3 text-xs text-muted-foreground">
          No quick actions. Add up to three buttons for the role's first moves.
        </p>
      ) : (
        <div className="space-y-2">
          {actions.map((action, index) => (
            <div
              key={`${action.id}-${index}`}
              className="rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-2"
            >
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  value={action.label}
                  onChange={(e) => onUpdate(index, { label: e.target.value.toUpperCase() })}
                  aria-label={`Quick action ${index + 1} label`}
                  className="h-8 min-w-0 rounded border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] px-2 text-xs font-semibold text-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={`Remove ${action.label}`}
                  className="h-8 rounded border border-[hsl(var(--qep-deck-rule))] px-2 text-muted-foreground hover:border-rose-500/40 hover:text-rose-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                value={action.route}
                onChange={(e) => onUpdate(index, { route: e.target.value })}
                aria-label={`Quick action ${index + 1} route`}
                className="mt-2 h-8 w-full rounded border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] px-2 font-mono text-xs text-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  value={action.subLabel ?? ""}
                  onChange={(e) => onUpdate(index, { subLabel: e.target.value || undefined })}
                  placeholder="Sublabel"
                  aria-label={`Quick action ${index + 1} sublabel`}
                  className="h-8 min-w-0 rounded border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none"
                />
                <select
                  value={action.icon ?? "spark"}
                  onChange={(e) => onUpdate(index, { icon: e.target.value })}
                  aria-label={`Quick action ${index + 1} icon`}
                  className="h-8 min-w-0 rounded border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] px-2 text-xs text-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none"
                >
                  {iconOptions.map((icon) => (
                    <option key={icon} value={icon}>
                      {icon}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
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

function AuditDrawer({
  rows,
  isLoading,
  onClose,
}: {
  rows: LayoutAuditRow[];
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <aside className="fixed bottom-0 right-0 top-14 z-30 flex w-full max-w-md flex-col border-l border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] shadow-2xl">
      <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--qep-deck-rule))] px-4 py-3">
        <div>
          <h2 className="font-kpi text-xs font-extrabold uppercase tracking-[0.16em] text-foreground">
            Layout history
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Last saved composer changes from the audit trigger.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close layout history"
          className="rounded p-1 text-muted-foreground hover:bg-[hsl(var(--qep-deck))] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {isLoading ? (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading history...
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-[hsl(var(--qep-deck-rule))] p-3 text-xs text-muted-foreground">
            No audit rows yet. The next save will write one automatically.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/50 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-orange))]">
                    {row.action}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Widgets: {countAuditWidgets(row.old_layout_json)} {" -> "} {countAuditWidgets(row.new_layout_json)}
                  {" | "}
                  Actions: {countAuditActions(row.old_layout_json)} {" -> "} {countAuditActions(row.new_layout_json)}
                </p>
                {row.subject_user_id ? (
                  <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                    user {row.subject_user_id}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function countAuditWidgets(layout: unknown): number {
  const normalized = normalizeFloorLayout(layout);
  return normalized.widgets.length;
}

function countAuditActions(layout: unknown): number {
  const normalized = normalizeFloorLayout(layout);
  return normalized.quickActions.length;
}

// Keep the registry reference close at hand for downstream contributors.
void FLOOR_WIDGET_REGISTRY;
void FLOOR_WIDGET_CAP;
void EMPTY_FLOOR_LAYOUT;
