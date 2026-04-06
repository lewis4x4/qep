import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlusCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  createCustomFieldDefinition,
  fetchRecordCustomFields,
  saveRecordCustomFields,
} from "../lib/qrm-router-api";
import type { QrmCustomField, QrmRecordType } from "../lib/types";

interface QrmCustomFieldsCardProps {
  recordType: QrmRecordType;
  recordId: string;
  canManageDefinitions: boolean;
}

interface NewFieldDraft {
  key: string;
  label: string;
  dataType: "text" | "number" | "boolean" | "date" | "json";
  required: boolean;
  visibility: "all" | "rep" | "elevated";
}

function normalizeInputValue(field: QrmCustomField, raw: string | boolean): unknown {
  if (field.dataType === "boolean") {
    return Boolean(raw);
  }

  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (field.dataType === "number") {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (field.dataType === "date") {
    return trimmed;
  }

  if (field.dataType === "json") {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  return trimmed;
}

function displayInputValue(field: QrmCustomField, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.dataType === "json") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function QrmCustomFieldsCard({
  recordType,
  recordId,
  canManageDefinitions,
}: QrmCustomFieldsCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string | boolean>>({});
  const [newField, setNewField] = useState<NewFieldDraft>({
    key: "",
    label: "",
    dataType: "text",
    required: false,
    visibility: "all",
  });

  const fieldsQuery = useQuery({
    queryKey: ["crm", "custom-fields", recordType, recordId],
    queryFn: () => fetchRecordCustomFields(recordType, recordId),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!fieldsQuery.data) return;

    const nextDraft: Record<string, string | boolean> = {};
    for (const field of fieldsQuery.data) {
      if (field.dataType === "boolean") {
        nextDraft[field.key] = Boolean(field.value);
      } else {
        nextDraft[field.key] = displayInputValue(field, field.value);
      }
    }
    setDraftValues(nextDraft);
  }, [fieldsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (input: { key: string; value: unknown }) => {
      setPendingKey(input.key);
      return saveRecordCustomFields(recordType, recordId, { [input.key]: input.value });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["crm", "custom-fields", recordType, recordId] });
    },
    onError: (error) => {
      toast({
        title: "Custom field save failed",
        description: error instanceof Error ? error.message : "Please retry.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setPendingKey(null);
    },
  });

  const createDefinitionMutation = useMutation({
    mutationFn: async () => {
      const visibilityRoles = newField.visibility === "all"
        ? []
        : newField.visibility === "rep"
        ? ["rep", "admin", "manager", "owner"]
        : ["admin", "manager", "owner"];

      await createCustomFieldDefinition({
        objectType: recordType,
        key: newField.key,
        label: newField.label,
        dataType: newField.dataType,
        required: newField.required,
        visibilityRoles,
      });
    },
    onSuccess: async () => {
      setNewField({
        key: "",
        label: "",
        dataType: "text",
        required: false,
        visibility: "all",
      });
      await queryClient.invalidateQueries({ queryKey: ["crm", "custom-fields", recordType, recordId] });
      toast({ title: "Custom field created", description: "The new field is now available." });
    },
    onError: (error) => {
      toast({
        title: "Unable to create custom field",
        description: error instanceof Error ? error.message : "Please retry.",
        variant: "destructive",
      });
    },
  });

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

  return (
    <Card className="space-y-4 border-border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Custom Fields</h2>
        <p className="text-sm text-muted-foreground">Inline edits save each field independently.</p>
      </div>

      {fieldsQuery.isLoading && <div className="h-10 animate-pulse rounded bg-muted/40" />}
      {fieldsQuery.isError && (
        <p className="text-sm text-destructive">Couldn&apos;t load custom fields.</p>
      )}
      {!fieldsQuery.isLoading && !fieldsQuery.isError && fields.length === 0 && (
        <p className="text-sm text-muted-foreground">No custom fields defined for this record type.</p>
      )}

      {!fieldsQuery.isLoading && !fieldsQuery.isError && fields.length > 0 && (
        <div className="space-y-3">
          {fields.map((field) => {
            const isPending = saveMutation.isPending && pendingKey === field.key;
            return (
              <div key={field.definitionId} className="rounded-lg border border-border bg-muted/10 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label htmlFor={`custom-field-${field.key}`} className="text-sm font-medium text-foreground">
                    {field.label}
                    {field.required && <span className="ml-1 text-primary">*</span>}
                  </label>
                  {isPending && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving...
                    </span>
                  )}
                </div>

                {field.dataType === "boolean" ? (
                  <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      id={`custom-field-${field.key}`}
                      type="checkbox"
                      checked={Boolean(draftValues[field.key])}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setDraftValues((prev) => ({ ...prev, [field.key]: checked }));
                        void saveMutation.mutateAsync({
                          key: field.key,
                          value: normalizeInputValue(field, checked),
                        });
                      }}
                    />
                    Enabled
                  </label>
                ) : (
                  <Input
                    id={`custom-field-${field.key}`}
                    type={field.dataType === "number" ? "number" : field.dataType === "date" ? "date" : "text"}
                    value={String(draftValues[field.key] ?? "")}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraftValues((prev) => ({ ...prev, [field.key]: value }));
                    }}
                    onBlur={(event) => {
                      void saveMutation.mutateAsync({
                        key: field.key,
                        value: normalizeInputValue(field, event.target.value),
                      });
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManageDefinitions && (
        <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3">
          <h3 className="text-sm font-semibold text-foreground">Add field definition</h3>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              placeholder="Field key"
              value={newField.key}
              onChange={(event) => setNewField((prev) => ({ ...prev, key: event.target.value }))}
            />
            <Input
              placeholder="Label"
              value={newField.label}
              onChange={(event) => setNewField((prev) => ({ ...prev, label: event.target.value }))}
            />
            <select
              className="h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={newField.dataType}
              onChange={(event) => {
                const value = event.target.value as NewFieldDraft["dataType"];
                setNewField((prev) => ({ ...prev, dataType: value }));
              }}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="date">Date</option>
              <option value="json">JSON</option>
            </select>
            <select
              className="h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={newField.visibility}
              onChange={(event) => {
                const value = event.target.value as NewFieldDraft["visibility"];
                setNewField((prev) => ({ ...prev, visibility: value }));
              }}
            >
              <option value="all">Visible to all roles</option>
              <option value="rep">Visible to reps + elevated</option>
              <option value="elevated">Visible to elevated only</option>
            </select>
          </div>

          <label className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={newField.required}
              onChange={(event) => setNewField((prev) => ({ ...prev, required: event.target.checked }))}
            />
            Required
          </label>

          <div className="mt-3">
            <Button
              size="sm"
              disabled={createDefinitionMutation.isPending || !newField.key.trim() || !newField.label.trim()}
              onClick={() => createDefinitionMutation.mutate()}
            >
              {createDefinitionMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <PlusCircle className="mr-1 h-4 w-4" />
              )}
              Add Definition
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
