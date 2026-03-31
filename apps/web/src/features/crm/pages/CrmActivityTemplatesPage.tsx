import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CrmPageHeader } from "../components/CrmPageHeader";
import {
  archiveCrmActivityTemplate,
  createCrmActivityTemplate,
  listManageableCrmActivityTemplates,
  updateCrmActivityTemplate,
} from "../lib/crm-api";
import type { CrmActivityTemplate, CrmActivityType, CrmTaskStatus } from "../lib/types";

interface CrmActivityTemplatesPageProps {
  userId: string;
}

type EditorState = {
  id: string | null;
  activityType: CrmActivityType;
  label: string;
  description: string;
  body: string;
  taskDueMinutes: string;
  taskStatus: CrmTaskStatus;
  sortOrder: string;
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

const ACTIVITY_OPTIONS: Array<{ value: CrmActivityType; label: string }> = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
  { value: "task", label: "Task" },
  { value: "sms", label: "SMS" },
];

function toEditorState(template: CrmActivityTemplate): EditorState {
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

export function CrmActivityTemplatesPage({ userId }: CrmActivityTemplatesPageProps) {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<CrmActivityType>("email");
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["crm", "activity-templates", "manage"],
    queryFn: listManageableCrmActivityTemplates,
    staleTime: 30_000,
  });

  const templates = templatesQuery.data ?? [];
  const filteredTemplates = useMemo(
    () => templates.filter((template) => template.activityType === selectedType),
    [selectedType, templates],
  );

  function resetEditor(nextType: CrmActivityType = selectedType): void {
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <CrmPageHeader
        title="CRM Templates"
        subtitle="Own the language your reps use across calls, tasks, email, SMS, and meetings."
      />

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="space-y-4 rounded-2xl border border-[#E2E8F0] p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedType(option.value);
                  if (!editor.id) {
                    resetEditor(option.value);
                  }
                }}
                className={cn(
                  "min-h-[44px] rounded-full px-4",
                  selectedType === option.value
                    ? "border-[#E87722] bg-[#FFF1E6] text-[#B45309] hover:bg-[#FFF1E6]"
                    : "border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]"
                )}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {templatesQuery.isLoading && (
            <div className="space-y-3" role="status" aria-label="Loading CRM templates">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />
              ))}
            </div>
          )}

          {templatesQuery.isError && (
            <Card className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
              Could not load CRM templates.
            </Card>
          )}

          {!templatesQuery.isLoading && !templatesQuery.isError && filteredTemplates.length === 0 && (
            <Card className="rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-5 text-sm text-[#475569]">
              No saved templates for {selectedType}. Start by adding the language your team uses most.
            </Card>
          )}

          {!templatesQuery.isLoading && !templatesQuery.isError && filteredTemplates.length > 0 && (
            <div className="space-y-3">
              {filteredTemplates.map((template) => (
                <Card
                  key={template.id}
                  className="rounded-xl border border-[#E2E8F0] p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0F172A]">{template.label}</p>
                      <p className="mt-1 text-xs text-[#64748B]">{template.description || "No description added."}</p>
                      <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[#334155]">
                        {template.body}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
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
              ))}
            </div>
          )}
        </Card>

        <Card className="rounded-2xl border border-[#E2E8F0] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0F172A]">
                {editor.id ? "Edit template" : "New template"}
              </h2>
              <p className="mt-1 text-sm text-[#475569]">
                Keep rep language tight, clear, and dealership-native.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => resetEditor(selectedType)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New
            </Button>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="crm-template-type" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
                Type
              </label>
              <select
                id="crm-template-type"
                value={editor.activityType}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    activityType: event.target.value as CrmActivityType,
                  }))
                }
                className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
              >
                {ACTIVITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="crm-template-label" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
                Label
              </label>
              <input
                id="crm-template-label"
                value={editor.label}
                onChange={(event) => setEditor((current) => ({ ...current, label: event.target.value }))}
                className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="crm-template-description" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
                Description
              </label>
              <input
                id="crm-template-description"
                value={editor.description}
                onChange={(event) =>
                  setEditor((current) => ({ ...current, description: event.target.value }))
                }
                className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="crm-template-body" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
                Body
              </label>
              <textarea
                id="crm-template-body"
                value={editor.body}
                onChange={(event) => setEditor((current) => ({ ...current, body: event.target.value }))}
                rows={8}
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-sm leading-6 text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="crm-template-sort-order" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
                  Sort order
                </label>
                <input
                  id="crm-template-sort-order"
                  type="number"
                  value={editor.sortOrder}
                  onChange={(event) =>
                    setEditor((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
                />
              </div>

              {editor.activityType === "task" ? (
                <div>
                  <label htmlFor="crm-template-task-due" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
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
                    className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
                  />
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-3 text-sm text-[#64748B]">
                  Task defaults only apply to task templates.
                </div>
              )}
            </div>

            {editor.activityType === "task" && (
              <div>
                <label htmlFor="crm-template-task-status" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
                  Task status default
                </label>
                <select
                  id="crm-template-task-status"
                  value={editor.taskStatus}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      taskStatus: event.target.value as CrmTaskStatus,
                    }))
                  }
                  className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
                >
                  <option value="open">Open task</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            )}

            {saveError && <p className="text-sm text-[#B91C1C]">{saveError}</p>}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => resetEditor(selectedType)}>
                Reset
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                {isSaving ? "Saving..." : editor.id ? "Update template" : "Save template"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
