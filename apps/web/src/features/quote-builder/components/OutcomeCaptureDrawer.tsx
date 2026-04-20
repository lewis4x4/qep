import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, XCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  captureQuoteOutcome,
  REASON_LABELS,
  REASON_ORDER,
  type OutcomeClassification,
  type OutcomeReason,
  type PriceSensitivity,
} from "../lib/outcomes-api";

/**
 * Slice 10 — Win/Loss capture drawer.
 *
 * Fires when a quote transitions to accepted / rejected / expired. The
 * rep gets a 10-second flow: outcome chip, reason chip, optional detail
 * text + competitor. "Skip for now" is always available and writes an
 * outcome='skipped' row so we can measure drop-off.
 *
 * Kept deliberately small — reasoning in the Slice 08 audit doc. If the
 * drawer grows complex, adoption tanks.
 */

type Step = "outcome" | "reason" | "details";

export interface OutcomeCaptureDrawerProps {
  open: boolean;
  onClose: () => void;
  quotePackageId: string | null;
  /** Pre-set outcome when the status transition itself is unambiguous
   *  (accepted → won; rejected → lost; expired → expired). The rep can
   *  still override via the outcome step if the system got it wrong. */
  triggeredBy: OutcomeClassification | null;
  onSaved?: () => void;
}

const OUTCOME_CARDS: Array<{
  kind: Exclude<OutcomeClassification, "skipped">;
  label: string;
  icon: React.ReactNode;
  tone: "success" | "destructive" | "warning";
}> = [
  { kind: "won",     label: "Won",     icon: <CheckCircle2 className="h-4 w-4" />, tone: "success" },
  { kind: "lost",    label: "Lost",    icon: <XCircle className="h-4 w-4" />,      tone: "destructive" },
  { kind: "expired", label: "Expired", icon: <AlertTriangle className="h-4 w-4" />,tone: "warning" },
];

export function OutcomeCaptureDrawer({
  open,
  onClose,
  quotePackageId,
  triggeredBy,
  onSaved,
}: OutcomeCaptureDrawerProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("outcome");
  const [outcome, setOutcome] = useState<Exclude<OutcomeClassification, "skipped"> | null>(null);
  const [reason, setReason] = useState<OutcomeReason | null>(null);
  const [reasonDetails, setReasonDetails] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [priceSensitivity, setPriceSensitivity] = useState<PriceSensitivity | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Seed from trigger on open
    setOutcome(triggeredBy && triggeredBy !== "skipped" ? triggeredBy : null);
    setStep(triggeredBy && triggeredBy !== "skipped" ? "reason" : "outcome");
    setReason(null);
    setReasonDetails("");
    setCompetitor("");
    setPriceSensitivity(null);
    setSaving(false);
  }, [open, triggeredBy, quotePackageId]);

  async function save(finalOutcome: OutcomeClassification) {
    if (!quotePackageId || !profile) return;
    setSaving(true);
    const result = await captureQuoteOutcome({
      quotePackageId,
      workspaceId: profile.active_workspace_id ?? "default",
      outcome: finalOutcome,
      reason: finalOutcome === "skipped" ? null : reason,
      reasonDetails: finalOutcome === "skipped" ? null : reasonDetails,
      competitor: finalOutcome === "skipped" ? null : (competitor || null),
      priceSensitivity: finalOutcome === "skipped" ? null : priceSensitivity,
      capturedBy: profile.id,
    });
    setSaving(false);
    if ("error" in result) {
      toast({ title: "Could not save", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title:
        finalOutcome === "skipped"
          ? "Skipped — we'll remind you later"
          : "Outcome captured",
    });
    onSaved?.();
    onClose();
  }

  function handleSkip() {
    void save("skipped");
  }

  function handleConfirm() {
    if (!outcome) return;
    void save(outcome);
  }

  const canConfirm = !!outcome && !saving && (
    // require a reason for won/lost; expired doesn't need one
    outcome === "expired" || !!reason
  );

  // ── Outcome step ────────────────────────────────────────────────────────
  const outcomeStep = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">How did this quote close?</p>
      <div className="grid grid-cols-3 gap-2">
        {OUTCOME_CARDS.map((card) => {
          const active = outcome === card.kind;
          const toneClass = active
            ? card.tone === "success"     ? "border-success bg-success/10 text-success-foreground"
            : card.tone === "destructive" ? "border-destructive bg-destructive/10 text-destructive"
            : /* warning */                 "border-warning bg-warning/10"
            : "border-border bg-background hover:bg-muted";
          return (
            <button
              key={card.kind}
              type="button"
              onClick={() => {
                setOutcome(card.kind);
                setStep(card.kind === "expired" ? "details" : "reason");
              }}
              className={`flex flex-col items-center gap-1.5 rounded-md border-2 p-3 transition ${toneClass}`}
            >
              {card.icon}
              <span className="text-sm font-medium">{card.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── Reason step ─────────────────────────────────────────────────────────
  const reasonStep = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        What was the deciding factor? (One chip; details optional.)
      </p>
      <div className="flex flex-wrap gap-1.5">
        {REASON_ORDER.map((r) => {
          const active = reason === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => {
                setReason(r);
                setStep("details");
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-muted/40 text-foreground hover:bg-muted"
              }`}
            >
              {REASON_LABELS[r]}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── Details step ────────────────────────────────────────────────────────
  const detailsStep = (
    <div className="space-y-4">
      {reason && (
        <div className="rounded-md bg-muted/40 p-2 text-xs">
          Reason: <span className="font-medium">{REASON_LABELS[reason]}</span>{" "}
          <button
            type="button"
            onClick={() => setStep("reason")}
            className="ml-2 text-primary underline-offset-2 hover:underline"
          >
            change
          </button>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="outcome-details">What happened? (optional)</Label>
        <textarea
          id="outcome-details"
          value={reasonDetails}
          onChange={(e) => setReasonDetails(e.target.value.slice(0, 2000))}
          placeholder={
            outcome === "won"
              ? "e.g. 'Beat Bobcat on service credit + financing rate. Rep relationship sealed it.'"
              : outcome === "lost"
              ? "e.g. 'Customer went with Bobcat — $3k lower + 2.9% vs our 3.9%.'"
              : "e.g. 'Customer paused — budget shifted to next quarter.'"
          }
          rows={3}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
        <p className="text-[10px] text-muted-foreground">{reasonDetails.length}/2000</p>
      </div>

      {reason === "competitor" && (
        <div className="space-y-1">
          <Label htmlFor="outcome-competitor">Competitor</Label>
          <Input
            id="outcome-competitor"
            value={competitor}
            onChange={(e) => setCompetitor(e.target.value.slice(0, 100))}
            placeholder="e.g. Bobcat of Gainesville"
          />
        </div>
      )}

      {reason === "price" && (
        <div className="space-y-1">
          <Label>Price sensitivity</Label>
          <div className="flex gap-1.5">
            {(["primary", "secondary", "none"] as PriceSensitivity[]).map((p) => {
              const active = priceSensitivity === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriceSensitivity(active ? null : p)}
                  className={`rounded-full border px-3 py-1 text-xs capitalize transition ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted/40 hover:bg-muted"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader className="mb-4">
          <SheetTitle>Record outcome</SheetTitle>
          <SheetDescription>
            Takes 10 seconds. Feeds the Deal Coach and team-level learning.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          {step === "outcome" && outcomeStep}
          {step === "reason"  && reasonStep}
          {step === "details" && detailsStep}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
          <Button
            variant="ghost"
            onClick={handleSkip}
            disabled={saving || !quotePackageId || !profile}
            className="text-xs"
          >
            {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Skip, add reason later
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
