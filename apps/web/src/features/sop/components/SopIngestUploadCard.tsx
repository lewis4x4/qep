import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Upload, CheckCircle2 } from "lucide-react";
import { ingestSopDocument, normalizeSopDepartment, sopErrorMessage, type SopDepartment } from "../lib/sop-api";

const DEPARTMENTS: SopDepartment[] = ["sales", "service", "parts", "admin", "all"];

export function SopIngestUploadCard() {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState<SopDepartment>("all");

  const ingestMutation = useMutation({
    mutationFn: ingestSopDocument,
    onSuccess: () => {
      // Clear form on success
      setText("");
      setTitle("");
    },
  });

  async function handleFileSelected(file: File) {
    // Accept plain text, markdown, or any text-like file
    const content = await file.text();
    setText(content);
    if (!title) {
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  }

  function submit() {
    if (text.trim().length < 50) return;
    ingestMutation.mutate({
      text,
      department,
      title: title || undefined,
      source_filename: title || undefined,
    });
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />
        <h3 className="text-sm font-bold text-foreground">AI SOP Ingestion</h3>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Paste SOP text or upload a text/markdown file. GPT parses it into trigger events, steps, responsible roles, and decision points. Creates a draft template you review and publish.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Equipment Delivery SOP"
              className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(normalizeSopDepartment(e.target.value, department))}
              className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">SOP text</label>
            <label className="cursor-pointer text-[10px] text-qep-orange hover:underline flex items-center gap-1">
              <Upload className="h-3 w-3" aria-hidden />
              Upload file
              <input
                type="file"
                accept=".txt,.md,.text,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileSelected(f);
                }}
              />
            </label>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your SOP document here..."
            rows={6}
            className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs font-mono"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {text.length} chars {text.length < 50 && text.length > 0 && "· minimum 50 chars"}
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={submit}
            disabled={text.trim().length < 50 || ingestMutation.isPending}
          >
            <Sparkles className="mr-1 h-3 w-3" aria-hidden />
            {ingestMutation.isPending ? "Parsing…" : "Parse with AI"}
          </Button>
        </div>

        {ingestMutation.isSuccess && ingestMutation.data && (
          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
              <p className="text-sm font-semibold text-emerald-400">Template parsed successfully</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <strong className="text-foreground">{ingestMutation.data.template_title}</strong> · {ingestMutation.data.steps_extracted}/{ingestMutation.data.total_steps_parsed} steps · confidence {Math.round(ingestMutation.data.parse_confidence * 100)}%
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Created as a <strong>draft</strong>. Review the steps, then publish when ready.
            </p>
            <div className="mt-2">
              <Button asChild size="sm" variant="outline" className="h-7 text-[11px]">
                <Link to={`/sop/templates/${ingestMutation.data.template_id}`}>
                  Open template
                </Link>
              </Button>
            </div>
          </div>
        )}

        {ingestMutation.isError && (
          <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-xs text-red-400">
              {sopErrorMessage(ingestMutation.error, "Ingestion failed")}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
