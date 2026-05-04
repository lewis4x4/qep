import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Copy, History, Pencil, Plus, Save, Settings2, Wand2 } from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  bulkAdjustBaseOptionPrices,
  copyBaseOptionModel,
  listBaseOptionModels,
  listCompatibleAttachmentsForModel,
  saveBaseOptionAttachment,
  saveBaseOptionModel,
  type BaseOptionAttachmentRecord,
  type BaseOptionModelRecord,
  type BaseOptionsFilters,
} from "../lib/base-options-api";
import {
  OEM_BASE_OPTIONS_MANUFACTURERS,
  evaluateOemBaseOptionsImportReadiness,
  getOemBaseOptionsImportRequirements,
  listOemBaseOptionsImportRuns,
  oemBaseOptionsManufacturerLabel,
  type OemBaseOptionsImportRun,
} from "../lib/oem-base-options-import-api";

const EMPTY_FILTERS: BaseOptionsFilters = {
  baseNumber: "",
  make: "",
  model: "",
  className: "",
  includeInactive: false,
  sortBy: "base",
};

type ModelEditorState = {
  id?: string;
  brandId: string;
  modelCode: string;
  family: string;
  nameDisplay: string;
  standardConfig: string;
  listPriceDollars: string;
  active: boolean;
};

const EMPTY_EDITOR: ModelEditorState = {
  brandId: "",
  modelCode: "",
  family: "",
  nameDisplay: "",
  standardConfig: "",
  listPriceDollars: "",
  active: true,
};

function toEditorState(model: BaseOptionModelRecord): ModelEditorState {
  return {
    id: model.id,
    brandId: model.brandId,
    modelCode: model.modelCode,
    family: model.family ?? "",
    nameDisplay: model.nameDisplay,
    standardConfig: model.standardConfig ?? "",
    listPriceDollars: (model.listPriceCents / 100).toFixed(2),
    active: model.active,
  };
}

function formatRunDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatRunCounts(run: OemBaseOptionsImportRun): string {
  return `${run.rowsInserted} inserted · ${run.rowsUpdated} updated · ${run.rowsSkipped} skipped`;
}

function statusBadgeVariant(status: OemBaseOptionsImportRun["runStatus"]): "default" | "outline" | "destructive" {
  return status === "failed" ? "destructive" : status === "completed" ? "default" : "outline";
}

export function BaseOptionsPage() {
  return (
    <RequireAdmin>
      <BaseOptionsPageInner />
    </RequireAdmin>
  );
}

function BaseOptionsPageInner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState<BaseOptionsFilters>(EMPTY_FILTERS);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<ModelEditorState>(EMPTY_EDITOR);
  const [massOpen, setMassOpen] = useState(false);
  const [massPercent, setMassPercent] = useState("5");
  const [massIncludeAttachments, setMassIncludeAttachments] = useState(true);

  const modelsQuery = useQuery({
    queryKey: ["admin", "base-options", filters],
    queryFn: () => listBaseOptionModels(filters),
    staleTime: 15_000,
  });

  const importRunsQuery = useQuery({
    queryKey: ["admin", "base-options", "oem-import-runs"],
    queryFn: () => listOemBaseOptionsImportRuns(),
    staleTime: 30_000,
  });

  const models = modelsQuery.data ?? [];
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? models[0] ?? null,
    [models, selectedModelId],
  );

  useEffect(() => {
    if (!selectedModel && models.length === 0) {
      setSelectedModelId(null);
      return;
    }
    if (!selectedModel && models.length > 0) {
      setSelectedModelId(models[0]!.id);
    }
  }, [models, selectedModel]);

  const attachmentsQuery = useQuery({
    queryKey: ["admin", "base-options", selectedModel?.id, "attachments", filters.includeInactive],
    queryFn: () =>
      listCompatibleAttachmentsForModel(
        selectedModel!.id,
        selectedModel!.brandId,
        filters.includeInactive,
      ),
    enabled: Boolean(selectedModel),
    staleTime: 15_000,
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["admin", "base-options"] });
  }

  const saveModelMutation = useMutation({
    mutationFn: async () => {
      const dollars = Number.parseFloat(editor.listPriceDollars);
      if (!editor.brandId || !editor.modelCode.trim() || !editor.nameDisplay.trim() || !Number.isFinite(dollars)) {
        throw new Error("Brand, base number, description, and price are required.");
      }
      return saveBaseOptionModel({
        id: editor.id,
        brandId: editor.brandId,
        modelCode: editor.modelCode,
        family: editor.family || null,
        nameDisplay: editor.nameDisplay,
        standardConfig: editor.standardConfig || null,
        listPriceCents: Math.round(dollars * 100),
        active: editor.active,
      });
    },
    onSuccess: async () => {
      await refresh();
      setEditorOpen(false);
      toast({
        title: editor.id ? "Base updated" : "Base created",
        description: "The base record is ready for quoting and import review.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not save base",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const copyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedModel) throw new Error("Select a base to copy.");
      return copyBaseOptionModel(selectedModel.id, {});
    },
    onSuccess: async () => {
      await refresh();
      toast({
        title: "Base copied",
        description: "A duplicate base was created and active options were carried over.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not copy base",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const massMutation = useMutation({
    mutationFn: async () => {
      const percentDelta = Number.parseFloat(massPercent);
      if (!Number.isFinite(percentDelta)) {
        throw new Error("Enter a valid percentage adjustment.");
      }
      return bulkAdjustBaseOptionPrices({
        modelIds: models.map((model) => model.id),
        percentDelta,
        includeAttachments: massIncludeAttachments,
      });
    },
    onSuccess: async (result) => {
      await refresh();
      setMassOpen(false);
      toast({
        title: "Mass update applied",
        description: `${result.modelsUpdated} bases and ${result.attachmentsUpdated} options were repriced.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Could not apply mass update",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const attachmentMutation = useMutation({
    mutationFn: (input: { id: string; active: boolean; listPriceDollars: string; name: string; category: string }) => {
      const dollars = Number.parseFloat(input.listPriceDollars);
      if (!Number.isFinite(dollars)) {
        throw new Error("Option price must be a valid dollar amount.");
      }
      return saveBaseOptionAttachment({
        id: input.id,
        active: input.active,
        listPriceCents: Math.round(dollars * 100),
        name: input.name,
        category: input.category || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "base-options", selectedModel?.id, "attachments"] });
      toast({
        title: "Option updated",
        description: "The option record is now in sync with the catalog.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update option",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const metrics = useMemo(() => {
    const inactiveCount = models.filter((model) => !model.active).length;
    const totalOptions = models.reduce((sum, model) => sum + model.optionCount, 0);
    return {
      totalBases: models.length,
      inactiveCount,
      totalOptions,
    };
  }, [models]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Base &amp; Options</h1>
          <p className="text-muted-foreground mt-1">
            Search, edit, copy, and reprice quote-builder base models and compatible option codes from one control room.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/admin/price-sheets">
              Imports <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button onClick={() => setMassOpen(true)}>
            <Wand2 className="mr-2 h-4 w-4" />
            Mass increase/decrease
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setEditor(EMPTY_EDITOR);
              setEditorOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New base
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{metrics.totalBases}</p>
            <p className="text-xs text-muted-foreground">Visible bases</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{metrics.totalOptions}</p>
            <p className="text-xs text-muted-foreground">Compatible options in scope</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{metrics.inactiveCount}</p>
            <p className="text-xs text-muted-foreground">Inactive bases</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Bobcat / Vermeer OEM import readiness
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            This admin page currently edits quote-builder catalog tables. Bobcat and Vermeer imports remain blocked from execution until OEM sample files or API contracts define the canonical mapping into <code>equipment_base_codes</code>, <code>equipment_options</code>, and <code>equipment_base_codes_import_runs</code>.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {OEM_BASE_OPTIONS_MANUFACTURERS.map((manufacturer) => {
              const fileReadiness = evaluateOemBaseOptionsImportReadiness({ manufacturer, path: "file" });
              const apiReadiness = evaluateOemBaseOptionsImportReadiness({ manufacturer, path: "api" });
              return (
                <div key={manufacturer} className="rounded-lg border border-border bg-background/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">{oemBaseOptionsManufacturerLabel(manufacturer)}</p>
                    <Badge variant="outline">Blocked pending OEM evidence</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">File path needs</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                        {getOemBaseOptionsImportRequirements("file").map((requirement) => (
                          <li key={requirement}>{requirement}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">API path needs</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                        {getOemBaseOptionsImportRequirements("api").map((requirement) => (
                          <li key={requirement}>{requirement}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Current repo-only readiness: file path has {fileReadiness.blockers.length} blockers; API path has {apiReadiness.blockers.length} blockers. Parser/upload buttons are intentionally not enabled.
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Canonical import run history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {importRunsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading Bobcat and Vermeer import-run ledger…</p>
          ) : importRunsQuery.isError ? (
            <p className="text-sm text-destructive">Could not load the canonical import-run ledger.</p>
          ) : (importRunsQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No Bobcat or Vermeer canonical import runs have been recorded yet.</p>
          ) : (
            importRunsQuery.data?.map((run) => (
              <div key={run.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">
                      {oemBaseOptionsManufacturerLabel(run.manufacturer)} · {run.importFormat ?? "format pending"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRunDate(run.ranAt)} · {run.sourceFilename ?? run.sourceStoragePath ?? "no source file recorded"}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(run.runStatus)}>{run.runStatus}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{formatRunCounts(run)}</p>
                {run.error ? <p className="mt-1 text-xs text-destructive">{run.error}</p> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <div>
            <Label htmlFor="base-number-filter">Base number</Label>
            <Input
              id="base-number-filter"
              value={filters.baseNumber}
              onChange={(event) => setFilters((current) => ({ ...current, baseNumber: event.target.value }))}
              placeholder="RT75"
            />
          </div>
          <div>
            <Label htmlFor="make-filter">Make</Label>
            <Input
              id="make-filter"
              value={filters.make}
              onChange={(event) => setFilters((current) => ({ ...current, make: event.target.value }))}
              placeholder="ASV"
            />
          </div>
          <div>
            <Label htmlFor="model-filter">Model</Label>
            <Input
              id="model-filter"
              value={filters.model}
              onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))}
              placeholder="Compact track loader"
            />
          </div>
          <div>
            <Label htmlFor="class-filter">Class</Label>
            <Input
              id="class-filter"
              value={filters.className}
              onChange={(event) => setFilters((current) => ({ ...current, className: event.target.value }))}
              placeholder="Compact Track Loader"
            />
          </div>
          <div>
            <Label htmlFor="sort-filter">Sort by</Label>
            <select
              id="sort-filter"
              value={filters.sortBy}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  sortBy: event.target.value as BaseOptionsFilters["sortBy"],
                }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="base">Base</option>
              <option value="make_model">Make/Model</option>
              <option value="class">Class</option>
            </select>
          </div>
          <label className="flex items-end gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={filters.includeInactive}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  includeInactive: event.target.checked,
                }))
              }
            />
            Include inactive
          </label>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Base catalog</CardTitle>
            <Badge variant="outline">{models.length} results</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {modelsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading base catalog…</p>
            ) : models.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bases match the current filters.</p>
            ) : (
              models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setSelectedModelId(model.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    selectedModel?.id === model.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">{model.modelCode}</p>
                        {!model.active && <Badge variant="outline">Inactive</Badge>}
                        <Badge variant="outline">{model.brandCode}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-foreground">{model.nameDisplay}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[model.brandName, model.family].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-qep-orange">
                        ${(model.listPriceCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{model.optionCount} options</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Base detail</CardTitle>
            {selectedModel ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditor(toEditorState(selectedModel));
                    setEditorOpen(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyMutation.mutate()}
                  disabled={copyMutation.isPending}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedModel ? (
              <p className="text-sm text-muted-foreground">Select a base from the list to inspect its option set.</p>
            ) : (
              <>
                <div>
                  <p className="text-lg font-semibold text-foreground">{selectedModel.modelCode}</p>
                  <p className="text-sm text-muted-foreground">{selectedModel.nameDisplay}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[selectedModel.brandName, selectedModel.family].filter(Boolean).join(" · ")}
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
                  <p className="mt-1 text-sm text-foreground">
                    {selectedModel.standardConfig || "No standard configuration notes yet."}
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Compatible options</p>
                    <Badge variant="outline">{attachmentsQuery.data?.length ?? 0}</Badge>
                  </div>
                  <div className="mt-3 space-y-3">
                    {attachmentsQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground">Loading options…</p>
                    ) : (attachmentsQuery.data?.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">No compatible options are linked to this base.</p>
                    ) : (
                      attachmentsQuery.data?.map((attachment) => (
                        <AttachmentEditorRow
                          key={attachment.id}
                          attachment={attachment}
                          onSave={(next) => attachmentMutation.mutate(next)}
                          isSaving={attachmentMutation.isPending}
                        />
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>{editor.id ? "Edit base" : "New base"}</SheetTitle>
            <SheetDescription>
              Base numbers are the top-level quoteable unit. Keep the catalog clean and the description human.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="base-brand">Brand ID</Label>
              <Input
                id="base-brand"
                value={editor.brandId}
                onChange={(event) => setEditor((current) => ({ ...current, brandId: event.target.value }))}
                placeholder="Brand UUID"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="base-model-code">Base number</Label>
                <Input
                  id="base-model-code"
                  value={editor.modelCode}
                  onChange={(event) => setEditor((current) => ({ ...current, modelCode: event.target.value }))}
                  placeholder="RT75"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="base-family">Class</Label>
                <Input
                  id="base-family"
                  value={editor.family}
                  onChange={(event) => setEditor((current) => ({ ...current, family: event.target.value }))}
                  placeholder="Compact Track Loader"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="base-name-display">Description</Label>
              <Input
                id="base-name-display"
                value={editor.nameDisplay}
                onChange={(event) => setEditor((current) => ({ ...current, nameDisplay: event.target.value }))}
                placeholder="ASV RT-75 Forestry Package"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base-standard-config">Standard configuration</Label>
              <Input
                id="base-standard-config"
                value={editor.standardConfig}
                onChange={(event) => setEditor((current) => ({ ...current, standardConfig: event.target.value }))}
                placeholder="Cab, standard tracks, hydraulic coupler"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="base-list-price">Price</Label>
                <Input
                  id="base-list-price"
                  value={editor.listPriceDollars}
                  onChange={(event) => setEditor((current) => ({ ...current, listPriceDollars: event.target.value }))}
                  placeholder="125000.00"
                />
              </div>
              <label className="flex min-h-[44px] items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={editor.active}
                  onChange={(event) => setEditor((current) => ({ ...current, active: event.target.checked }))}
                />
                Active
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => saveModelMutation.mutate()} disabled={saveModelMutation.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {saveModelMutation.isPending ? "Saving..." : "Save base"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={massOpen} onOpenChange={setMassOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader className="mb-4">
            <SheetTitle>Mass increase / decrease</SheetTitle>
            <SheetDescription>
              Apply one percentage adjustment to every currently visible base. Option prices can move with the same action.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              This action targets {models.length} visible bases.
            </div>
            <div className="space-y-2">
              <Label htmlFor="mass-percent">Percent change</Label>
              <Input
                id="mass-percent"
                value={massPercent}
                onChange={(event) => setMassPercent(event.target.value)}
                placeholder="5 for increase, -3 for decrease"
              />
            </div>
            <label className="flex min-h-[44px] items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={massIncludeAttachments}
                onChange={(event) => setMassIncludeAttachments(event.target.checked)}
              />
              Include compatible options
            </label>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setMassOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => massMutation.mutate()} disabled={massMutation.isPending}>
                <Settings2 className="mr-2 h-4 w-4" />
                {massMutation.isPending ? "Applying..." : "Apply update"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AttachmentEditorRow({
  attachment,
  onSave,
  isSaving,
}: {
  attachment: BaseOptionAttachmentRecord;
  onSave: (input: { id: string; active: boolean; listPriceDollars: string; name: string; category: string }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(attachment.name);
  const [category, setCategory] = useState(attachment.category ?? "");
  const [price, setPrice] = useState((attachment.listPriceCents / 100).toFixed(2));
  const [active, setActive] = useState(attachment.active);

  useEffect(() => {
    setName(attachment.name);
    setCategory(attachment.category ?? "");
    setPrice((attachment.listPriceCents / 100).toFixed(2));
    setActive(attachment.active);
  }, [attachment]);

  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
      <div className="grid gap-3 sm:grid-cols-[1.4fr_0.9fr_0.8fr_auto]">
        <div>
          <Label className="text-[11px] text-muted-foreground">Option</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
          <p className="mt-1 text-[11px] text-muted-foreground">{attachment.partNumber}</p>
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Category</Label>
          <Input value={category} onChange={(event) => setCategory(event.target.value)} />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Price</Label>
          <Input value={price} onChange={(event) => setPrice(event.target.value)} />
        </div>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
            Active
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSaving}
            onClick={() =>
              onSave({
                id: attachment.id,
                active,
                listPriceDollars: price,
                name,
                category,
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
