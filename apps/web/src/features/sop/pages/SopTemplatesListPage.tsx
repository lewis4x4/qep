import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BookOpen, Plus, Play, Edit, CheckCircle2, FileText, Sparkles, BarChart3,
} from "lucide-react";
import {
  listSopTemplates,
  createSopTemplate,
  publishSopTemplate,
  type SopDepartment,
  type SopStatus,
  type SopTemplate,
} from "../lib/sop-api";
import { SopIngestUploadCard } from "../components/SopIngestUploadCard";

const STATUS_STYLES: Record<SopStatus, { label: string; bg: string; text: string }> = {
  draft:    { label: "Draft",    bg: "bg-amber-500/10",  text: "text-amber-400" },
  active:   { label: "Active",   bg: "bg-emerald-500/10", text: "text-emerald-400" },
  archived: { label: "Archived", bg: "bg-muted",          text: "text-muted-foreground" },
};

const DEPT_FILTER: Array<SopDepartment | "all"> = ["all", "sales", "service", "parts", "admin"];

export function SopTemplatesListPage() {
  const queryClient = useQueryClient();
  const [deptFilter, setDeptFilter] = useState<SopDepartment | "all">("all");
  const [showIngest, setShowIngest] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDept, setNewDept] = useState<SopDepartment>("all");
  const [newDescription, setNewDescription] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sop", "templates", deptFilter],
    queryFn: () => listSopTemplates(deptFilter),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createSopTemplate({
        title: newTitle,
        department: newDept,
        description: newDescription || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sop", "templates"] });
      setShowCreate(false);
      setNewTitle("");
      setNewDescription("");
    },
  });

  const publishMutation = useMutation({
    mutationFn: publishSopTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sop", "templates"] });
    },
  });

  const templates = data?.templates ?? [];
  const drafts = templates.filter((t) => t.status === "draft");
  const active = templates.filter((t) => t.status === "active");
  const archived = templates.filter((t) => t.status === "archived");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">SOP Templates</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Build executable workflows from Ryan's ChatGPT SOPs. Templates → steps → live executions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/ops/sop-compliance">
              <BarChart3 className="mr-1 h-4 w-4" aria-hidden />
              Compliance
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowIngest((v) => !v)}
          >
            <Sparkles className="mr-1 h-4 w-4" aria-hidden />
            AI ingest
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            New template
          </Button>
        </div>
      </div>

      {/* AI Ingest card */}
      {showIngest && <SopIngestUploadCard />}

      {/* Manual create form */}
      {showCreate && (
        <Card className="p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">New template</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Equipment Delivery Process"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Department</label>
              <select
                value={newDept}
                onChange={(e) => setNewDept(e.target.value as SopDepartment)}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="all">All</option>
                <option value="sales">Sales</option>
                <option value="service">Service</option>
                <option value="parts">Parts</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Description</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={!newTitle.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating…" : "Create draft"}
              </Button>
            </div>
            {createMutation.isError && (
              <p className="text-xs text-red-400">
                {(createMutation.error as Error)?.message ?? "Failed to create template"}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Department filter */}
      <div className="flex flex-wrap gap-2">
        {DEPT_FILTER.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDeptFilter(d)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
              deptFilter === d
                ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                : "border-border text-muted-foreground hover:border-foreground/20"
            }`}
          >
            {d === "all" ? "All" : d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="h-20 animate-pulse" />
          ))}
        </div>
      )}
      {isError && (
        <Card className="border-red-500/20 p-4">
          <p className="text-sm text-red-400">Failed to load templates.</p>
        </Card>
      )}

      {/* Active templates */}
      {active.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Active ({active.length})
          </h2>
          {active.map((template) => (
            <TemplateRow key={template.id} template={template} onPublish={() => {}} publishing={false} />
          ))}
        </section>
      )}

      {/* Drafts */}
      {drafts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Drafts ({drafts.length})
          </h2>
          {drafts.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              onPublish={() => publishMutation.mutate(template.id)}
              publishing={publishMutation.isPending}
            />
          ))}
        </section>
      )}

      {/* Archived */}
      {archived.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Archived ({archived.length})
          </h2>
          {archived.map((template) => (
            <TemplateRow key={template.id} template={template} onPublish={() => {}} publishing={false} />
          ))}
        </section>
      )}

      {!isLoading && !isError && templates.length === 0 && (
        <Card className="border-dashed p-6 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
          <p className="text-sm text-muted-foreground">
            No SOP templates yet. Upload a document with AI Ingest or create one manually.
          </p>
        </Card>
      )}
    </div>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function TemplateRow({
  template,
  onPublish,
  publishing,
}: {
  template: SopTemplate;
  onPublish: () => void;
  publishing: boolean;
}) {
  const statusStyle = STATUS_STYLES[template.status];
  const stepCount = template.sop_steps?.[0]?.count ?? 0;

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${statusStyle.bg} ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {template.department}
            </span>
            <span className="text-[10px] text-muted-foreground">v{template.version}</span>
            <span className="text-[10px] text-muted-foreground">· {stepCount} step{stepCount === 1 ? "" : "s"}</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-foreground truncate">{template.title}</p>
          {template.description && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{template.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button asChild size="sm" variant="ghost" className="h-7 text-[11px]">
            <Link to={`/sop/templates/${template.id}`}>
              <Edit className="mr-1 h-3 w-3" aria-hidden />
              Edit
            </Link>
          </Button>
          {template.status === "draft" && stepCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={onPublish}
              disabled={publishing}
            >
              <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          )}
          {template.status === "active" && (
            <Button asChild size="sm" className="h-7 text-[11px]">
              <Link to={`/sop/templates/${template.id}/run`}>
                <Play className="mr-1 h-3 w-3" aria-hidden />
                Run
              </Link>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
