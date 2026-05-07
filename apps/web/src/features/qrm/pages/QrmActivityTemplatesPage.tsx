import { useMemo, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  CopyCheck,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Route,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DeckDivider, DeckSurface, SignalChip, StatusDot } from "../components/command-deck";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { CRM_ACTIVITY_TEMPLATES } from "../lib/activity-templates";
import {
  archiveCrmActivityTemplate,
  createCrmActivityTemplate,
  listManageableCrmActivityTemplates,
  updateCrmActivityTemplate,
} from "../lib/qrm-api";
import type { QrmActivityTemplate, QrmActivityType, QrmTaskStatus } from "../lib/types";

interface QrmActivityTemplatesPageProps {
  userId: string;
}

type EditorState = {
  id: string | null;
  activityType: QrmActivityType;
  label: string;
  description: string;
  body: string;
  taskDueMinutes: string;
  taskStatus: QrmTaskStatus;
  sortOrder: string;
};

type ActivityOption = {
  value: QrmActivityType;
  label: string;
  deckLabel: string;
  mission: string;
  operatorCue: string;
  icon: ComponentType<{ className?: string }>;
};

type PlaybookLane = {
  id: string;
  label: string;
  description: string;
  recommendedTypes: QrmActivityType[];
  keywords: string[];
  icon: ComponentType<{ className?: string }>;
};

const EMPTY_EDITOR: EditorState = {
  id: null,
  activityType: "call",
  label: "",
  description: "",
  body: "",
  taskDueMinutes: "",
  taskStatus: "open",
  sortOrder: "0",
};

const ACTIVITY_OPTIONS: ActivityOption[] = [
  {
    value: "call",
    label: "Call",
    deckLabel: "Voice plays",
    mission: "Convert live customer context into the next committed move.",
    operatorCue: "Quote reviews, trade calls, decision-maker callbacks",
    icon: Phone,
  },
  {
    value: "email",
    label: "Email",
    deckLabel: "Proof packets",
    mission: "Send machine, price, rental, and service evidence without slowing the rep.",
    operatorCue: "Specs, pricing updates, delivery recaps",
    icon: Mail,
  },
  {
    value: "meeting",
    label: "Meeting",
    deckLabel: "Field moments",
    mission: "Turn yard walks, demos, and owner reviews into durable CRM memory.",
    operatorCue: "Demos, jobsite visits, owner reviews",
    icon: Users,
  },
  {
    value: "note",
    label: "Note",
    deckLabel: "Signal capture",
    mission: "Preserve account truth that future reps, managers, and Iron can reuse.",
    operatorCue: "Customer intent, branch context, service/parts hooks",
    icon: CopyCheck,
  },
  {
    value: "task",
    label: "Task",
    deckLabel: "SLA triggers",
    mission: "Create due-date discipline for the follow-up work that protects revenue.",
    operatorCue: "Callbacks, spec packets, demo confirmation",
    icon: Clock3,
  },
  {
    value: "sms",
    label: "SMS",
    deckLabel: "Fast nudges",
    mission: "Keep momentum with short, human touches from the field.",
    operatorCue: "Arrival windows, quick check-ins, price/trade nudges",
    icon: MessageSquare,
  },
];

const PLAYBOOK_LANES: PlaybookLane[] = [
  {
    id: "equipment",
    label: "Equipment pursuit",
    description: "Quote, trade, demo, and availability language for moving iron before the window closes.",
    recommendedTypes: ["call", "email", "meeting", "task"],
    keywords: ["equipment", "machine", "unit", "quote", "trade", "demo", "spec", "availability", "delivery"],
    icon: Target,
  },
  {
    id: "parts",
    label: "Parts rescue",
    description: "Follow-up paths for parts demand, replenishment, shortages, and counter-to-field handoffs.",
    recommendedTypes: ["call", "email", "note", "sms"],
    keywords: ["parts", "part", "replenish", "stock", "counter", "sku", "shortage"],
    icon: Route,
  },
  {
    id: "sales",
    label: "Sales acceleration",
    description: "Decision-maker recaps and next-step language that keeps reps out of blank-page mode.",
    recommendedTypes: ["call", "email", "meeting", "sms"],
    keywords: ["sale", "sales", "pricing", "decision", "owner", "budget", "financing", "deal"],
    icon: Sparkles,
  },
  {
    id: "rental",
    label: "Rental conversion",
    description: "Rental-ready touches for job timing, utilization, swaps, and rent-to-own pathways.",
    recommendedTypes: ["call", "task", "sms", "note"],
    keywords: ["rental", "rent", "utilization", "job", "swap", "return"],
    icon: ShieldCheck,
  },
  {
    id: "service",
    label: "Service follow-up",
    description: "Service-to-sales and post-sale care language that turns shop signals into account moves.",
    recommendedTypes: ["note", "task", "call", "email"],
    keywords: ["service", "repair", "maintenance", "warranty", "inspection", "shop"],
    icon: Wrench,
  },
];

function toEditorState(template: QrmActivityTemplate): EditorState {
  return {
    id: template.id,
    activityType: template.activityType,
    label: template.label,
    description: template.description,
    body: template.body,
    taskDueMinutes:
      typeof template.taskDueMinutes === "number" ? String(template.taskDueMinutes) : "",
    taskStatus: template.taskStatus ?? "open",
    sortOrder: String(template.sortOrder ?? 0),
  };
}

function getActivityOption(activityType: QrmActivityType): ActivityOption {
  return ACTIVITY_OPTIONS.find((option) => option.value === activityType) ?? ACTIVITY_OPTIONS[0];
}

function countLaneMatches(lane: PlaybookLane, templates: QrmActivityTemplate[]): number {
  return templates.filter((template) => {
    const searchable = `${template.label} ${template.description} ${template.body}`.toLowerCase();
    return lane.keywords.some((keyword) => searchable.includes(keyword));
  }).length;
}

function formatDueWindow(minutes?: number | null): string {
  if (typeof minutes !== "number") return "No SLA";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (24 * 60))}d`;
}

export function QrmActivityTemplatesPage({ userId }: QrmActivityTemplatesPageProps) {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<QrmActivityType>("email");
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["crm", "activity-templates", "manage"],
    queryFn: listManageableCrmActivityTemplates,
    staleTime: 30_000,
  });

  const templates = templatesQuery.data ?? [];
  const activeTemplates = useMemo(
    () => templates.filter((template) => template.isActive !== false),
    [templates],
  );
  const selectedProfile = getActivityOption(selectedType);
  const selectedSystemTemplates = CRM_ACTIVITY_TEMPLATES[selectedType] ?? [];
  const filteredTemplates = useMemo(
    () => activeTemplates.filter((template) => template.activityType === selectedType),
    [selectedType, activeTemplates],
  );
  const templatesByType = useMemo(() => {
    const counts = new Map<QrmActivityType, number>();
    activeTemplates.forEach((template) => {
      counts.set(template.activityType, (counts.get(template.activityType) ?? 0) + 1);
    });
    return counts;
  }, [activeTemplates]);
  const systemTemplateCount = ACTIVITY_OPTIONS.reduce(
    (total, option) => total + (CRM_ACTIVITY_TEMPLATES[option.value]?.length ?? 0),
    0,
  );
  const workspaceGapCount = ACTIVITY_OPTIONS.filter(
    (option) => (templatesByType.get(option.value) ?? 0) === 0,
  ).length;
  const taskSlaCount = activeTemplates.filter(
    (template) => template.activityType === "task" && typeof template.taskDueMinutes === "number",
  ).length;
  const recommendedLaneCount = PLAYBOOK_LANES.filter(
    (lane) => countLaneMatches(lane, activeTemplates) > 0,
  ).length;
  const headerMetrics = [
    {
      label: "Workspace plays",
      value: activeTemplates.length,
      tone: "active" as const,
    },
    {
      label: "System baseline",
      value: systemTemplateCount,
      tone: "live" as const,
    },
    {
      label: "Workflow lanes",
      value: `${recommendedLaneCount}/${PLAYBOOK_LANES.length}`,
      delta: {
        value: workspaceGapCount === 0 ? "covered" : `${workspaceGapCount} gaps`,
        direction: workspaceGapCount === 0 ? ("flat" as const) : ("down" as const),
      },
    },
    {
      label: "Task SLAs",
      value: taskSlaCount,
      tone: taskSlaCount > 0 ? "active" as const : undefined,
    },
  ];

  function resetEditor(nextType: QrmActivityType = selectedType): void {
    setEditor({ ...EMPTY_EDITOR, activityType: nextType });
    setSaveError(null);
  }

  async function refreshTemplates(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crm", "activity-templates"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "activity-templates", "manage"] }),
    ]);
  }

  async function handleSave(): Promise<void> {
    if (!editor.label.trim() || !editor.body.trim()) {
      setSaveError("Label and body are required.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const taskDueMinutes =
        editor.activityType === "task" && editor.taskDueMinutes.trim()
          ? Number(editor.taskDueMinutes)
          : null;

      if (taskDueMinutes !== null && (!Number.isFinite(taskDueMinutes) || taskDueMinutes < 0)) {
        setSaveError("Task due minutes must be zero or greater.");
        setIsSaving(false);
        return;
      }

      const payload = {
        activityType: editor.activityType,
        label: editor.label.trim(),
        description: editor.description.trim(),
        body: editor.body.trim(),
        taskDueMinutes,
        taskStatus: editor.activityType === "task" ? editor.taskStatus : undefined,
        sortOrder: Number(editor.sortOrder) || 0,
      };

      if (editor.id) {
        await updateCrmActivityTemplate(editor.id, payload);
      } else {
        await createCrmActivityTemplate({
          ...payload,
          createdBy: userId,
        });
      }

      await refreshTemplates();
      resetEditor(editor.activityType);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save template.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleArchive(templateId: string): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    try {
      await archiveCrmActivityTemplate(templateId);
      await refreshTemplates();
      if (editor.id === templateId) {
        resetEditor(selectedType);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not archive template.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Activity Template Command Center"
        subtitle="Turn equipment, parts, sales, rental, and service follow-up language into reusable field plays for every QEP rep."
        crumb={{ surface: "TODAY", lens: "TEMPLATES", count: activeTemplates.length }}
        metrics={headerMetrics}
        ironBriefing={{
          headline: (
            <span>
              Build templates like operating doctrine: short enough for a rep, rich enough for Iron,
              and specific enough to protect the next revenue move.
            </span>
          ),
          actions: [{ label: "Today queue", href: "/qrm/activities" }],
        }}
        rightRail={(
          <Button type="button" size="sm" onClick={() => resetEditor(selectedType)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New play
          </Button>
        )}
      />

      <DeckSurface tone="live" className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <SignalChip label="Doctrine mode" value="QEP CRM" tone="live" icon={Sparkles} />
              <SignalChip label="Composer-safe" value="No schema change" tone="ok" icon={ShieldCheck} />
              <SignalChip label="Coverage gaps" value={workspaceGapCount} tone={workspaceGapCount > 0 ? "warm" : "ok"} />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                Playbooks that make every touch compound
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                The composer already merges workspace plays ahead of the system baseline. This command
                center shows where your dealership has codified language, where it still relies on the
                generic baseline, and which workflows need sharper follow-up coverage.
              </p>
            </div>
          </div>

          <div className="border-t border-qep-deck-rule/70 bg-qep-deck/35 p-5 lg:border-l lg:border-t-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Moonshot operating rule
            </p>
            <p className="mt-2 text-sm leading-6 text-foreground/85">
              Every saved play should answer: what happened, why it matters, who owns the next move,
              and how it ties to equipment, parts, rental, service, or sales momentum.
            </p>
          </div>
        </div>
      </DeckSurface>

      <div className="grid gap-4 lg:grid-cols-5">
        {PLAYBOOK_LANES.map((lane) => {
          const Icon = lane.icon;
          const matches = countLaneMatches(lane, activeTemplates);
          const typeCoverage = lane.recommendedTypes.filter(
            (type) => (templatesByType.get(type) ?? 0) > 0,
          ).length;
          const covered = matches > 0;
          return (
            <DeckSurface key={lane.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-qep-orange/30 bg-qep-orange/10">
                  <Icon className="h-4 w-4 text-qep-orange" aria-hidden="true" />
                </span>
                <StatusDot tone={covered ? "active" : "cool"} pulse={covered} />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-foreground">{lane.label}</h3>
              <p className="mt-2 min-h-[4.5rem] text-xs leading-5 text-muted-foreground">
                {lane.description}
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-qep-deck-rule/70 pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <span>{matches} matches</span>
                <span>{typeCoverage}/{lane.recommendedTypes.length} types</span>
              </div>
            </DeckSurface>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <DeckSurface className="space-y-5 p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Template matrix
                </p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">Select a play type</h2>
              </div>
              <SignalChip
                label={selectedProfile.deckLabel}
                value={`${filteredTemplates.length}+${selectedSystemTemplates.length}`}
                tone="active"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ACTIVITY_OPTIONS.map((option) => {
                const Icon = option.icon;
                const workspaceCount = templatesByType.get(option.value) ?? 0;
                const systemCount = CRM_ACTIVITY_TEMPLATES[option.value]?.length ?? 0;
                const active = selectedType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSelectedType(option.value);
                      if (!editor.id) {
                        resetEditor(option.value);
                      }
                    }}
                    className={cn(
                      "rounded-md border p-3 text-left transition-all",
                      active
                        ? "border-qep-orange/60 bg-qep-orange/10 shadow-[0_0_0_1px_hsl(var(--qep-orange)/0.25)_inset]"
                        : "border-qep-deck-rule bg-qep-deck-elevated/40 hover:border-qep-orange/35 hover:bg-qep-orange/5",
                    )}
                    aria-pressed={active}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Icon className={cn("h-4 w-4", active ? "text-qep-orange" : "text-muted-foreground")} aria-hidden="true" />
                        {option.label}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {workspaceCount} / {systemCount}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{option.operatorCue}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <DeckDivider label={`${selectedProfile.label} command stack`} />

          <div className="rounded-md border border-qep-deck-rule bg-qep-deck/30 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-orange">
                  {selectedProfile.deckLabel}
                </p>
                <p className="mt-1 text-sm leading-6 text-foreground/85">{selectedProfile.mission}</p>
              </div>
              <SignalChip
                label="Workspace/System"
                value={`${filteredTemplates.length}/${selectedSystemTemplates.length}`}
                tone={filteredTemplates.length > 0 ? "ok" : "warm"}
              />
            </div>
          </div>

          {templatesQuery.isLoading && (
            <div className="space-y-3" role="status" aria-label="Loading QRM templates">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-md border border-qep-deck-rule bg-qep-deck-elevated/50" />
              ))}
            </div>
          )}

          {templatesQuery.isError && (
            <Card className="rounded-md border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
              Could not load QRM templates.
            </Card>
          )}

          {!templatesQuery.isLoading && !templatesQuery.isError && filteredTemplates.length === 0 && (
            <Card className="rounded-md border border-dashed border-qep-deck-rule bg-muted/30 p-5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No workspace {selectedProfile.label.toLowerCase()} plays yet.</p>
              <p className="mt-2 leading-6">
                Your reps still have {selectedSystemTemplates.length} system quick starts, but a QEP-specific
                play here would move ahead of the baseline in QrmActivityComposer.
              </p>
            </Card>
          )}

          {!templatesQuery.isLoading && !templatesQuery.isError && filteredTemplates.length > 0 && (
            <div className="space-y-3">
              {filteredTemplates.map((template) => {
                const option = getActivityOption(template.activityType);
                const Icon = option.icon;
                return (
                  <Card
                    key={template.id}
                    className="rounded-md border border-qep-deck-rule bg-qep-deck-elevated/55 p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <SignalChip label={option.label} tone="active" icon={Icon} />
                          <SignalChip label="Order" value={template.sortOrder ?? 0} />
                          {template.activityType === "task" && (
                            <SignalChip label="Due" value={formatDueWindow(template.taskDueMinutes)} tone="warm" />
                          )}
                        </div>
                        <p className="mt-3 text-sm font-semibold text-foreground">{template.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {template.description || "No description added."}
                        </p>
                        <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                          {template.body}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedType(template.activityType);
                            setEditor(toEditorState(template));
                            setSaveError(null);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleArchive(template.id)}
                          disabled={isSaving}
                        >
                          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                          Archive
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {!templatesQuery.isLoading && !templatesQuery.isError && selectedSystemTemplates.length > 0 && (
            <div className="rounded-md border border-qep-live/20 bg-qep-live/[0.04] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-live">
                    System baseline visible in composer
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Workspace plays appear first; these stay as fallback quick starts.
                  </p>
                </div>
                <SignalChip label="Baseline" value={selectedSystemTemplates.length} tone="live" />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {selectedSystemTemplates.map((template) => (
                  <div key={template.id} className="rounded-sm border border-qep-live/15 bg-background/45 p-3">
                    <p className="text-xs font-semibold text-foreground">{template.label}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {template.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DeckSurface>

        <DeckSurface className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Play authoring
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">
                {editor.id ? "Edit template" : "New template"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Keep rep language tight, clear, dealership-native, and safe for the activity composer.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => resetEditor(selectedType)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New
            </Button>
          </div>

          <div className="mt-4 rounded-md border border-qep-deck-rule bg-qep-deck/30 p-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Template quality checklist
            </p>
            <ul className="mt-2 grid gap-2 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
              <li className="flex gap-2"><StatusDot tone="active" size="xs" className="mt-1.5" />Name the customer situation.</li>
              <li className="flex gap-2"><StatusDot tone="active" size="xs" className="mt-1.5" />State the next committed move.</li>
              <li className="flex gap-2"><StatusDot tone="live" size="xs" className="mt-1.5" />Include equipment/parts/rental/service context.</li>
              <li className="flex gap-2"><StatusDot tone="live" size="xs" className="mt-1.5" />Keep body paste-ready for reps.</li>
            </ul>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="crm-template-type" className="mb-1.5 block text-sm font-medium text-foreground">
                Type
              </label>
              <select
                id="crm-template-type"
                value={editor.activityType}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    activityType: event.target.value as QrmActivityType,
                  }))
                }
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
              >
                {ACTIVITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="crm-template-label" className="mb-1.5 block text-sm font-medium text-foreground">
                Label
              </label>
              <input
                id="crm-template-label"
                value={editor.label}
                onChange={(event) => setEditor((current) => ({ ...current, label: event.target.value }))}
                placeholder="e.g. Rental return save attempt"
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="crm-template-description" className="mb-1.5 block text-sm font-medium text-foreground">
                Description
              </label>
              <input
                id="crm-template-description"
                value={editor.description}
                onChange={(event) =>
                  setEditor((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="When should a rep use this play?"
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="crm-template-body" className="mb-1.5 block text-sm font-medium text-foreground">
                Body
              </label>
              <textarea
                id="crm-template-body"
                value={editor.body}
                onChange={(event) => setEditor((current) => ({ ...current, body: event.target.value }))}
                rows={9}
                placeholder="Paste-ready language for the activity composer."
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-6 text-foreground shadow-sm focus:border-primary focus:outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="crm-template-sort-order" className="mb-1.5 block text-sm font-medium text-foreground">
                  Sort order
                </label>
                <input
                  id="crm-template-sort-order"
                  type="number"
                  value={editor.sortOrder}
                  onChange={(event) =>
                    setEditor((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                />
              </div>

              {editor.activityType === "task" ? (
                <div>
                  <label htmlFor="crm-template-task-due" className="mb-1.5 block text-sm font-medium text-foreground">
                    Task due minutes
                  </label>
                  <input
                    id="crm-template-task-due"
                    type="number"
                    min={0}
                    value={editor.taskDueMinutes}
                    onChange={(event) =>
                      setEditor((current) => ({ ...current, taskDueMinutes: event.target.value }))
                    }
                    placeholder="1440"
                    className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                  />
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-input bg-muted/30 p-3 text-sm text-muted-foreground">
                  Task defaults only apply to task templates.
                </div>
              )}
            </div>

            {editor.activityType === "task" && (
              <div>
                <label htmlFor="crm-template-task-status" className="mb-1.5 block text-sm font-medium text-foreground">
                  Task status default
                </label>
                <select
                  id="crm-template-task-status"
                  value={editor.taskStatus}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      taskStatus: event.target.value as QrmTaskStatus,
                    }))
                  }
                  className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                >
                  <option value="open">Open task</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            )}

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}

            <div className="flex items-center justify-end gap-2 border-t border-qep-deck-rule pt-4">
              <Button type="button" variant="outline" onClick={() => resetEditor(selectedType)}>
                Reset
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                {isSaving ? "Saving..." : editor.id ? "Update template" : "Save template"}
              </Button>
            </div>
          </div>
        </DeckSurface>
      </div>
    </div>
  );
}
