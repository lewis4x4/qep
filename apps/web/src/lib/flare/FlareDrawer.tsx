import { useEffect, useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Flame, Bug, Search, Lightbulb, Loader2, Check, Users, AlertOctagon, Sparkles, ExternalLink, PartyPopper,
} from "lucide-react";
import { submitFlare, peekDedupeCount } from "./flareClient";
import { FlareAnnotator } from "./FlareAnnotator";
import type {
  FlareAnnotation, FlareContext, FlareSeverity, FlareSubmitPayload, FlareSubmitResponse,
} from "./types";

interface FlareDrawerProps {
  open: boolean;
  mode: "bug" | "idea";
  context: FlareContext | null;
  screenshot: string | null;
  domSnapshot: string | null;
  onClose: () => void;
}

const SEVERITY_META: Record<FlareSeverity, { label: string; icon: React.ReactNode; color: string }> = {
  blocker:    { label: "Blocker",    icon: <AlertOctagon className="h-3 w-3" />, color: "border-red-500/50 text-red-400 bg-red-500/10" },
  bug:        { label: "Bug",        icon: <Bug className="h-3 w-3" />,          color: "border-orange-500/50 text-qep-orange bg-orange-500/10" },
  annoyance:  { label: "Annoyance",  icon: <Search className="h-3 w-3" />,       color: "border-amber-500/50 text-amber-400 bg-amber-500/10" },
  idea:       { label: "Idea",       icon: <Lightbulb className="h-3 w-3" />,    color: "border-blue-500/50 text-blue-400 bg-blue-500/10" },
  aha_moment: { label: "Aha!",       icon: <PartyPopper className="h-3 w-3" />,  color: "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" },
};

export function FlareDrawer({ open, mode, context, screenshot, domSnapshot, onClose }: FlareDrawerProps) {
  const [severity, setSeverity] = useState<FlareSeverity>(mode === "idea" ? "idea" : "bug");
  const [description, setDescription] = useState("");
  const [dedupeCount, setDedupeCount] = useState(0);
  const [result, setResult] = useState<FlareSubmitResponse | null>(null);
  const [annotatorOpen, setAnnotatorOpen] = useState(false);
  const [annotatedScreenshot, setAnnotatedScreenshot] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<FlareAnnotation[]>([]);

  // Reset state every time the drawer opens with a new capture
  useEffect(() => {
    if (open) {
      setSeverity(mode === "idea" ? "idea" : "bug");
      setDescription("");
      setDedupeCount(0);
      setResult(null);
      setAnnotatedScreenshot(null);
      setAnnotations([]);
    }
  }, [open, mode, context?.session_id]);

  // Fire dedupe peek when the drawer opens
  useEffect(() => {
    if (!open || !context) return;
    void peekDedupeCount(context.route, "").then(setDedupeCount);
  }, [open, context?.route]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!context || !screenshot || domSnapshot == null) throw new Error("Context not ready");
      if (description.trim().length === 0) throw new Error("Description required");
      const payload: FlareSubmitPayload = {
        severity,
        user_description: description.trim(),
        screenshot_base64: annotatedScreenshot ?? screenshot,
        dom_snapshot_gzipped: domSnapshot,
        annotations,
        context,
      };
      return submitFlare(payload);
    },
    onSuccess: (data) => setResult(data),
  });

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!submitMutation.isPending && description.trim().length > 0) {
        submitMutation.mutate();
      }
    }
    if (e.key === "Escape" && !submitMutation.isPending) {
      onClose();
    }
  }, [description, submitMutation, onClose]);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && !submitMutation.isPending && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-qep-orange" />
            {mode === "idea" ? "Capture idea" : "Report a flare"}
          </SheetTitle>
          <SheetDescription>
            We captured a screenshot, your click trail, and recent network / console events.
            Just describe what went wrong in one sentence.
          </SheetDescription>
        </SheetHeader>

        {/* Success view */}
        {result ? (
          <div className="mt-6 space-y-3">
            <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-start gap-2">
                <Check className="h-5 w-5 text-emerald-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-emerald-400">Reported — thank you</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Report ID <code className="rounded bg-muted px-1 text-[10px]">{result.report_id.slice(0, 8)}…</code>
                    {result.similar_count_last_7d > 1 && (
                      <> · {result.similar_count_last_7d - 1} other teammates hit something similar this week</>
                    )}
                  </p>
                </div>
              </div>
            </Card>

            {result.ai_severity_recommendation && result.ai_severity_recommendation !== severity && (
              <Card className="border-blue-500/30 bg-blue-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-blue-400">AI severity hint</p>
                <p className="mt-1 text-xs text-foreground">
                  Suggested: <b>{result.ai_severity_recommendation}</b>
                </p>
                {result.ai_severity_reasoning && (
                  <p className="mt-1 text-[11px] italic text-muted-foreground">"{result.ai_severity_reasoning}"</p>
                )}
              </Card>
            )}

            {result.hypothesis_pattern && (
              <Card className="border-violet-500/30 bg-violet-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-violet-400">Pattern detected</p>
                <p className="mt-1 text-xs text-foreground">{result.hypothesis_pattern}</p>
              </Card>
            )}

            <div className="flex flex-wrap gap-2">
              {result.linear_issue_url && (
                <Button asChild size="sm" variant="outline">
                  <a href={result.linear_issue_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1 h-3 w-3" /> Linear
                  </a>
                </Button>
              )}
              {result.paperclip_issue_url && (
                <Button asChild size="sm" variant="outline">
                  <a href={result.paperclip_issue_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1 h-3 w-3" /> Paperclip
                  </a>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <a href={`/admin/flare/${result.report_id}`}>View in QEP</a>
              </Button>
              <Button size="sm" onClick={onClose} className="ml-auto">
                Close
              </Button>
            </div>
          </div>
        ) : (
          /* Compose view */
          <div className="mt-6 space-y-3" onKeyDown={handleKeyDown}>
            {/* Severity chips */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Severity</p>
              <div className="grid grid-cols-5 gap-1.5">
                {(Object.keys(SEVERITY_META) as FlareSeverity[]).map((s) => {
                  const meta = SEVERITY_META[s];
                  const isActive = severity === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeverity(s)}
                      className={`flex items-center justify-center gap-1 rounded-md border px-2 py-2 text-[10px] font-semibold uppercase transition-colors ${
                        isActive ? meta.color : "border-border text-muted-foreground hover:border-foreground/20"
                      }`}
                    >
                      {meta.icon}
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Screenshot thumbnail + annotate button */}
            {screenshot && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Screenshot{annotations.length > 0 && ` (${annotations.length} annotation${annotations.length > 1 ? "s" : ""})`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setAnnotatorOpen(true)}
                    className="text-[10px] text-qep-orange hover:underline"
                  >
                    Annotate →
                  </button>
                </div>
                <div className="relative overflow-hidden rounded-md border border-border bg-muted/20">
                  <img
                    src={annotatedScreenshot ?? screenshot}
                    alt="Captured screenshot"
                    className="max-h-48 w-full object-contain"
                  />
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                What went wrong?
              </p>
              <textarea
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
                placeholder={mode === "idea" ? "One sentence on the idea…" : "The save button spins forever after I click it…"}
                rows={4}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">{description.length} / 2000</p>
            </div>

            {/* Dedupe chip */}
            {dedupeCount >= 1 && (
              <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                <Users className="h-3 w-3 text-amber-400" />
                <p className="text-[11px] text-amber-400">
                  Seen {dedupeCount} {dedupeCount === 1 ? "time" : "times"} on this route in the last 7 days
                </p>
              </div>
            )}

            {/* Context summary */}
            {context && (
              <details className="rounded-md border border-border bg-muted/20 p-2">
                <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground">
                  Captured context
                </summary>
                <div className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
                  <div>Route: <code className="text-foreground">{context.route}</code></div>
                  <div>Browser: {context.browser} / {context.os}</div>
                  <div>Viewport: {context.viewport.width}×{context.viewport.height} @ {context.viewport.dpr}x</div>
                  <div>Click trail: {context.click_trail.length} events</div>
                  <div>Network trail: {context.network_trail.length} requests</div>
                  <div>Console errors: {context.console_errors.length}</div>
                  <div>Visible entities: {context.visible_entities.length}</div>
                </div>
              </details>
            )}

            {/* Submit errors */}
            {submitMutation.isError && (
              <Card className="border-red-500/30 bg-red-500/5 p-2">
                <p className="text-[11px] text-red-400">{(submitMutation.error as Error).message}</p>
              </Card>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={submitMutation.isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || description.trim().length === 0 || !context}
              >
                {submitMutation.isPending ? (
                  <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Submitting…</>
                ) : (
                  <><Sparkles className="mr-1 h-3 w-3" /> Submit (⌘+↵)</>
                )}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>

      {/* Annotator overlay (Phase G) */}
      {screenshot && (
        <FlareAnnotator
          open={annotatorOpen}
          screenshotDataUrl={annotatedScreenshot ?? screenshot}
          onSave={(annotated, anns) => {
            setAnnotatedScreenshot(annotated);
            setAnnotations(anns);
            setAnnotatorOpen(false);
          }}
          onCancel={() => setAnnotatorOpen(false)}
        />
      )}
    </Sheet>
  );
}
