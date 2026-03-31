import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import { mergeActivityTemplates, toRelativeDateTimeLocalValue } from "../lib/activity-templates";
import { listCrmActivityTemplates } from "../lib/crm-api";
import type { CrmActivityType, CrmTaskMetadata, CrmTaskStatus } from "../lib/types";

interface CrmActivityComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    activityType: CrmActivityType;
    body: string;
    occurredAt: string;
    sendNow?: boolean;
    task?: CrmTaskMetadata;
  }) => Promise<void>;
  isPending: boolean;
  subjectLabel: string;
}

interface IntegrationAvailabilityResponse {
  connected?: boolean;
  status?: string;
}

const ACTIVITY_OPTIONS: Array<{ value: CrmActivityType; label: string }> = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
  { value: "task", label: "Task" },
  { value: "sms", label: "SMS" },
];

export function CrmActivityComposer({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  subjectLabel,
}: CrmActivityComposerProps) {
  const [activityType, setActivityType] = useState<CrmActivityType>("call");
  const [body, setBody] = useState("");
  const [sendNow, setSendNow] = useState(true);
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskStatus, setTaskStatus] = useState<CrmTaskStatus>("open");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [deliveryAvailability, setDeliveryAvailability] = useState<{
    loading: boolean;
    connected: boolean;
    status: string | null;
  }>({
    loading: false,
    connected: false,
    status: null,
  });

  const integrationKey = activityType === "email"
    ? "sendgrid"
    : activityType === "sms"
    ? "twilio"
    : null;
  const isCommunicationType = integrationKey !== null;
  const isTaskType = activityType === "task";
  const templatesQuery = useQuery({
    queryKey: ["crm", "activity-templates"],
    queryFn: listCrmActivityTemplates,
    staleTime: 60_000,
  });
  const activityTemplates = useMemo(
    () => mergeActivityTemplates(activityType, templatesQuery.data ?? []),
    [activityType, templatesQuery.data],
  );

  const canSubmit = useMemo(() => body.trim().length > 0 && !isPending, [body, isPending]);

  useEffect(() => {
    if (!isCommunicationType) {
      setSendNow(true);
      return;
    }
    setSendNow(deliveryAvailability.connected);
  }, [isCommunicationType, deliveryAvailability.connected, activityType]);

  useEffect(() => {
    if (!isTaskType) {
      setTaskError(null);
    }
  }, [isTaskType]);

  useEffect(() => {
    if (!open || !integrationKey) {
      setDeliveryAvailability({
        loading: false,
        connected: false,
        status: null,
      });
      return;
    }

    let cancelled = false;
    setDeliveryAvailability({
      loading: true,
      connected: false,
      status: null,
    });

    async function loadAvailability(): Promise<void> {
      try {
        const { data, error } = await supabase.functions.invoke<IntegrationAvailabilityResponse>(
          "integration-availability",
          {
            body: { integration_key: integrationKey },
          },
        );

        if (cancelled) return;
        if (error) {
          setDeliveryAvailability({
            loading: false,
            connected: false,
            status: "pending_credentials",
          });
          return;
        }

        setDeliveryAvailability({
          loading: false,
          connected: Boolean(data?.connected),
          status: typeof data?.status === "string" ? data.status : null,
        });
      } catch {
        if (cancelled) return;
        setDeliveryAvailability({
          loading: false,
          connected: false,
          status: "pending_credentials",
        });
      }
    }

    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [open, integrationKey]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    let normalizedTask: CrmTaskMetadata | undefined;
    if (isTaskType) {
      if (taskDueAt) {
        const dueAtMs = Date.parse(taskDueAt);
        if (Number.isNaN(dueAtMs)) {
          setTaskError("Enter a valid due date.");
          return;
        }
        normalizedTask = {
          dueAt: new Date(dueAtMs).toISOString(),
          status: taskStatus,
        };
      } else {
        normalizedTask = {
          dueAt: null,
          status: taskStatus,
        };
      }
    }

    setTaskError(null);

    await onSubmit({
      activityType,
      body: body.trim(),
      occurredAt: new Date().toISOString(),
      sendNow: isCommunicationType ? sendNow && deliveryAvailability.connected : undefined,
      task: normalizedTask,
    });

    setBody("");
    setActivityType("call");
    setSendNow(true);
    setTaskDueAt("");
    setTaskStatus("open");
    setSelectedTemplateId(null);
  }

  function applyTemplate(templateId: string): void {
    const template = activityTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    setSelectedTemplateId(template.id);
    setBody(template.body);
    setTaskError(null);

    if (activityType === "task") {
      setTaskDueAt(
        typeof template.taskDueMinutes === "number"
          ? toRelativeDateTimeLocalValue(template.taskDueMinutes)
          : ""
      );
      setTaskStatus(template.taskStatus ?? "open");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto w-full max-w-2xl rounded-t-2xl px-4 pb-6 pt-5 sm:px-6"
      >
        <SheetHeader className="mb-4">
          <SheetTitle>Log Activity</SheetTitle>
          <SheetDescription>
            Record an update for {subjectLabel}. Takes less than 45 seconds.
          </SheetDescription>
        </SheetHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="crm-activity-type" className="mb-1.5 block text-sm font-medium text-foreground">
              Type
            </label>
            <select
              id="crm-activity-type"
              value={activityType}
              onChange={(event) => {
                setActivityType(event.target.value as CrmActivityType);
                setSelectedTemplateId(null);
              }}
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
            >
              {ACTIVITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick starts</p>
                <p className="text-xs text-muted-foreground">
                  One tap loads dealership-ready language you can tweak before saving.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {isTaskType ? "Applies a task note and due default." : "Applies a clean starting draft."}
              </p>
            </div>
            {templatesQuery.isError && (
              <p className="mt-2 text-xs text-primary">
                Workspace templates could not be loaded. Built-in quick starts are still available.
              </p>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {activityTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template.id)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    selectedTemplateId === template.id
                      ? "border-primary bg-primary/10"
                      : "border-input bg-card hover:border-primary/60 hover:bg-primary/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{template.label}</div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                        template.source === "workspace"
                          ? "bg-sky-500/15 text-sky-900 dark:text-sky-100"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {template.source === "workspace" ? "Workspace" : "Built in"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{template.description}</p>
                </button>
              ))}
            </div>
          </div>

          {isCommunicationType && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Delivery Mode
                </p>
                {deliveryAvailability.loading ? (
                  <span className="text-xs text-muted-foreground">Checking…</span>
                ) : (
                  <DataSourceBadge state={deliveryAvailability.connected ? "Live" : "Manual"} />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {deliveryAvailability.loading
                  ? "Checking integration status for this communication type."
                  : deliveryAvailability.connected
                  ? "Integration is connected. Save Activity can send live or log only."
                  : `Integration is not connected. Save Activity records a manual ${activityType.toUpperCase()} log.`}
              </p>
              {!deliveryAvailability.loading && deliveryAvailability.connected && (
                <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={sendNow}
                    onChange={(event) => setSendNow(event.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                  />
                  Send now via {activityType === "email" ? "SendGrid" : "Twilio"}
                </label>
              )}
            </div>
          )}

          {isTaskType && (
            <div className="grid gap-4 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">
              <div>
                <label htmlFor="crm-task-due-at" className="mb-1.5 block text-sm font-medium text-foreground">
                  Due date
                </label>
                <input
                  id="crm-task-due-at"
                  type="datetime-local"
                  value={taskDueAt}
                  onChange={(event) => {
                    setTaskDueAt(event.target.value);
                    setTaskError(null);
                    setSelectedTemplateId(null);
                  }}
                  className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="crm-task-status" className="mb-1.5 block text-sm font-medium text-foreground">
                  Task status
                </label>
                <select
                  id="crm-task-status"
                  value={taskStatus}
                  onChange={(event) => {
                    setTaskStatus(event.target.value as CrmTaskStatus);
                    setSelectedTemplateId(null);
                  }}
                  className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                >
                  <option value="open">Open task</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          )}

          {taskError && <p className="text-sm text-destructive">{taskError}</p>}

          <div>
            <label htmlFor="crm-activity-body" className="mb-1.5 block text-sm font-medium text-foreground">
              Notes
            </label>
            <textarea
              id="crm-activity-body"
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setSelectedTemplateId(null);
              }}
              rows={6}
              placeholder={
                isCommunicationType
                  ? "Message summary, intent, and follow-up commitment"
                  : "Key points, next steps, and customer intent"
              }
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-6 text-foreground shadow-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {isPending
                ? "Saving..."
                : isCommunicationType && sendNow && deliveryAvailability.connected
                ? "Save & Send"
                : "Save Activity"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
