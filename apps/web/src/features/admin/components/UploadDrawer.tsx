import { useState, useRef, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  uploadAndExtractSheet,
  retryExtract,
  retryPublish,
  type UploadSheetInput,
  type UploadSheetResult,
} from "../lib/price-sheets-api";

type SheetType = "price_book" | "retail_programs" | "both";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "creating_record" }
  | { kind: "extracting" }
  | { kind: "publishing" }
  | {
      kind: "success";
      itemsWritten: number;
      programsWritten: number;
      itemsApplied: number;
      programsApplied: number;
    }
  | {
      kind: "failed";
      message: string;
      priceSheetId?: string;
      failedPhase?: "extract" | "publish";
      /** Extraction counts captured when publish fails (phase="publish") —
       *  retryPublish() needs these to restore them to the success banner. */
      extractedCounts?: { itemsWritten: number; programsWritten: number };
    };

const SHEET_TYPE_OPTIONS: Array<{ value: SheetType; label: string; description: string }> = [
  {
    value: "price_book",
    label: "Price Book",
    description: "Models, attachments, and freight zones",
  },
  {
    value: "retail_programs",
    label: "Dealer Programs",
    description: "Rebates, financing, and incentives",
  },
  {
    value: "both",
    label: "Combined",
    description: "Price book and programs in one document",
  },
];

const ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
];
const ALLOWED_EXT = /\.(pdf|xlsx|xls|csv)$/i;

export interface UploadDrawerProps {
  open: boolean;
  onClose: () => void;
  brandId: string | null;
  brandName: string | null;
  brandCode: string | null;
  onSuccess: () => void;
}

export function UploadDrawer({
  open,
  onClose,
  brandId,
  brandName,
  brandCode,
  onSuccess,
}: UploadDrawerProps) {
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [sheetType, setSheetType] = useState<SheetType>("price_book");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // H2: mount-safety. In-flight pipelines (uploadAndExtractSheet / retry*)
  // keep running server-side after the drawer closes. When their promise
  // resolves, the resulting setPhase() + the setTimeout phase-flippers will
  // target an unmounted component — React swallows it silently in production
  // but it's a real "state update on unmounted" warning, and a landmine if
  // this component is ever wrapped in StrictMode double-mounting or if we
  // add analytics on phase transitions.
  //
  // The flag is a ref so it's stable across renders and doesn't trigger
  // re-execution of the unmount cleanup. `safeSetPhase` / the timer guards
  // read through the ref at fire time, which is always the latest value.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function safeSetPhase(next: Phase | ((prev: Phase) => Phase)) {
    if (!mountedRef.current) return;
    setPhase(next);
  }

  // Reset internal state whenever the drawer (re)opens for a new brand.
  useEffect(() => {
    if (open) {
      setFile(null);
      setSheetType("price_book");
      setPhase({ kind: "idle" });
      setDragActive(false);
    }
  }, [open, brandId]);

  const busy =
    phase.kind === "uploading" ||
    phase.kind === "creating_record" ||
    phase.kind === "extracting" ||
    phase.kind === "publishing";

  const canCloseNow =
    phase.kind === "idle" ||
    phase.kind === "success" ||
    phase.kind === "failed" ||
    phase.kind === "extracting" || // extract continues server-side
    phase.kind === "publishing";    // publish continues server-side

  function handleOpenChange(next: boolean) {
    if (!next && canCloseNow) {
      if (phase.kind === "success") onSuccess();
      onClose();
    }
  }

  function validateFile(f: File): string | null {
    if (!ALLOWED_EXT.test(f.name) && !ALLOWED_MIME.includes(f.type)) {
      return `Unsupported file type. Use PDF, XLSX, XLS, or CSV.`;
    }
    if (f.size > 25 * 1024 * 1024) {
      return `File exceeds 25 MB (${(f.size / 1024 / 1024).toFixed(1)} MB).`;
    }
    return null;
  }

  function acceptFile(f: File) {
    const err = validateFile(f);
    if (err) {
      setPhase({ kind: "failed", message: err });
      setFile(null);
      return;
    }
    setFile(f);
    setPhase({ kind: "idle" });
  }

  /**
   * Render the async result into the phase state machine. Shared by the
   * fresh-upload handler and the retry paths so success/failure UI is
   * identical across entry points.
   */
  function handleResult(result: UploadSheetResult) {
    if ("error" in result) {
      safeSetPhase({
        kind: "failed",
        message: result.error,
        priceSheetId: result.priceSheetId,
        failedPhase: result.phase,
        extractedCounts: result.extractCounts,
      });
      return;
    }
    safeSetPhase({
      kind: "success",
      itemsWritten:    result.itemsWritten,
      programsWritten: result.programsWritten,
      itemsApplied:    result.itemsApplied,
      programsApplied: result.programsApplied,
    });
  }

  /**
   * Kick off the pipeline with a shared set of phase timers. Returns a cleanup
   * function the caller must invoke after awaiting the pipeline so timers
   * don't leak past the drawer lifecycle.
   *
   * `startAt` lets retry paths skip the upload/creating_record phases when the
   * file+row already exist on the server.
   */
  function startPhaseTimers(
    startAt: "uploading" | "extracting",
  ): () => void {
    if (startAt === "uploading") {
      setPhase({ kind: "uploading" });
    } else {
      setPhase({ kind: "extracting" });
    }

    const timers: Array<ReturnType<typeof setTimeout>> = [];

    if (startAt === "uploading") {
      // Mid-pipeline phase transitions: uploading → creating_record → extracting.
      // There's no mid-progress signal from a single Promise so we approximate
      // by time. Claude extract dominates the wait (30–90s).
      timers.push(setTimeout(() => {
        safeSetPhase((p) => (p.kind === "uploading" ? { kind: "creating_record" } : p));
      }, 400));
      timers.push(setTimeout(() => {
        safeSetPhase((p) => (p.kind === "creating_record" ? { kind: "extracting" } : p));
      }, 900));
    }
    // After 90s at extracting, assume extract done and publish is running.
    timers.push(setTimeout(() => {
      safeSetPhase((p) => (p.kind === "extracting" ? { kind: "publishing" } : p));
    }, 90_000));

    return () => timers.forEach(clearTimeout);
  }

  async function handleSubmit() {
    if (!file || !brandId || !brandCode || !profile) return;

    const clear = startPhaseTimers("uploading");

    const input: UploadSheetInput = {
      brandId,
      brandCode,
      file,
      sheetType,
      workspaceId: profile.active_workspace_id,
      uploadedBy:  profile.id,
    };

    try {
      const result = await uploadAndExtractSheet(input);
      clear();
      handleResult(result);
    } catch (e: unknown) {
      clear();
      const msg = e instanceof Error ? e.message : String(e);
      safeSetPhase({ kind: "failed", message: `Unexpected error: ${msg}` });
    }
  }

  /**
   * Retry a post-insert failure without re-uploading the file. Routes to the
   * correct server action based on which phase failed: extract → re-runs the
   * full extract+publish pass; publish → re-runs only publish, preserving the
   * extract counts the user already saw.
   */
  async function handleRetry() {
    if (phase.kind !== "failed" || !phase.priceSheetId) return;

    const clear = startPhaseTimers("extracting");
    const priceSheetId = phase.priceSheetId;
    const failedPhase  = phase.failedPhase;
    const extracted    = phase.extractedCounts;

    try {
      const result =
        failedPhase === "publish" && extracted
          ? await retryPublish(priceSheetId, extracted)
          : await retryExtract(priceSheetId);
      clear();
      handleResult(result);
    } catch (e: unknown) {
      clear();
      const msg = e instanceof Error ? e.message : String(e);
      safeSetPhase({
        kind: "failed",
        message: `Unexpected error: ${msg}`,
        priceSheetId,
        failedPhase,
        extractedCounts: extracted,
      });
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (busy) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!busy) setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>Upload price sheet</SheetTitle>
          <SheetDescription>
            {brandName ? (
              <>
                New sheet for <span className="font-medium">{brandName}</span>. Extraction runs
                automatically and publishes on success — no review step.
              </>
            ) : (
              "Select a brand first."
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Sheet type selector */}
        <div className="space-y-2 mb-6">
          <label className="text-sm font-medium">Sheet type</label>
          <div className="space-y-2">
            {SHEET_TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                  sheetType === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/30"
                } ${busy ? "opacity-50 pointer-events-none" : ""}`}
              >
                <input
                  type="radio"
                  name="sheetType"
                  value={opt.value}
                  checked={sheetType === opt.value}
                  onChange={() => setSheetType(opt.value)}
                  disabled={busy}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* File drop zone + picker */}
        <div className="space-y-2 mb-6">
          <label className="text-sm font-medium">File</label>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => !busy && fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-md cursor-pointer transition-colors ${
              dragActive
                ? "border-primary bg-primary/5"
                : file
                ? "border-success bg-success/5"
                : "border-border hover:bg-muted/30"
            } ${busy ? "pointer-events-none opacity-50" : ""}`}
          >
            {file ? (
              <>
                <FileUp className="w-8 h-8 text-success mb-2" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Drop file or click to select</p>
                <p className="text-xs text-muted-foreground">PDF, XLSX, XLS, or CSV · up to 25 MB</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,application/pdf"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) acceptFile(picked);
              }}
              disabled={busy}
            />
          </div>
        </div>

        {/* Phase feedback */}
        {phase.kind === "uploading" && (
          <PhaseBanner icon={<Loader2 className="w-4 h-4 animate-spin" />} tone="info">
            Uploading file…
          </PhaseBanner>
        )}
        {phase.kind === "creating_record" && (
          <PhaseBanner icon={<Loader2 className="w-4 h-4 animate-spin" />} tone="info">
            Creating sheet record…
          </PhaseBanner>
        )}
        {phase.kind === "extracting" && (
          <PhaseBanner icon={<Loader2 className="w-4 h-4 animate-spin" />} tone="info">
            <div>
              <div className="font-medium">Extracting with Claude…</div>
              <div className="text-xs mt-1 opacity-80">
                Usually takes 30–90 seconds. Safe to close — extraction continues server-side.
              </div>
            </div>
          </PhaseBanner>
        )}
        {phase.kind === "publishing" && (
          <PhaseBanner icon={<Loader2 className="w-4 h-4 animate-spin" />} tone="info">
            <div>
              <div className="font-medium">Publishing to catalog…</div>
              <div className="text-xs mt-1 opacity-80">
                Auto-approving extracted items and applying to the live catalog.
              </div>
            </div>
          </PhaseBanner>
        )}
        {phase.kind === "success" && (
          <PhaseBanner icon={<CheckCircle2 className="w-4 h-4" />} tone="success">
            <div>
              <div className="font-medium">Published to catalog.</div>
              <div className="text-xs mt-1 flex flex-wrap gap-2">
                <Badge variant="success">{phase.itemsApplied} items applied</Badge>
                {phase.programsApplied > 0 && (
                  <Badge variant="success">{phase.programsApplied} programs applied</Badge>
                )}
                {phase.itemsWritten !== phase.itemsApplied && (
                  <Badge variant="warning">
                    {phase.itemsWritten - phase.itemsApplied} items skipped
                  </Badge>
                )}
              </div>
              <div className="text-xs mt-2 opacity-80">
                Reps can now quote against the new pricing.
              </div>
            </div>
          </PhaseBanner>
        )}
        {phase.kind === "failed" && (
          <PhaseBanner icon={<AlertCircle className="w-4 h-4" />} tone="error">
            <div className="flex-1">
              <div className="font-medium text-sm">
                {phase.failedPhase === "publish"
                  ? "Extracted but not published"
                  : "Could not complete"}
              </div>
              <div className="text-xs mt-1">{phase.message}</div>
              {phase.priceSheetId && (
                <div className="text-xs mt-1 opacity-80">
                  Sheet record saved as <code>{phase.priceSheetId.slice(0, 8)}…</code> —{" "}
                  {phase.failedPhase === "publish"
                    ? "extraction is safe. Admin can retry publish from the sheet record."
                    : "you can retry without re-uploading."}
                </div>
              )}
            </div>
          </PhaseBanner>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-6">
          {phase.kind === "success" ? (
            <Button onClick={() => { onSuccess(); onClose(); }} className="flex-1">
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={onClose}
                disabled={!canCloseNow}
                className="flex-1"
              >
                Cancel
              </Button>
              {(() => {
                const isRetryable =
                  phase.kind === "failed" && !!phase.priceSheetId;
                const onClick = isRetryable ? handleRetry : handleSubmit;
                const disabled =
                  busy ||
                  !brandId ||
                  !profile ||
                  (isRetryable ? false : !file);
                return (
                  <Button
                    onClick={onClick}
                    disabled={disabled}
                    className="flex-1"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {phase.kind === "failed" ? "Retry" : "Upload & extract"}
                  </Button>
                );
              })()}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PhaseBanner({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: "info" | "success" | "error";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/10 border-success/20 text-success-foreground"
      : tone === "error"
      ? "bg-destructive/10 border-destructive/20 text-destructive"
      : "bg-muted border-border";

  return (
    <div className={`flex items-start gap-3 p-3 rounded-md border text-sm ${toneClass}`}>
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
