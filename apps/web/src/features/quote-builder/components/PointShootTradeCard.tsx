/**
 * PointShootTradeCard — Slice 20b "Point, Shoot, Trade".
 *
 * Mounted on the Quote Builder Customer step. The rep taps "Snap trade
 * photo" on their phone, the camera opens, they shoot the customer's
 * used machine, and ~3 seconds later this card shows:
 *
 *   2019 Cat 299D3 (high confidence)
 *   Est. trade value:  $48k – $56k   (3 sources)
 *   Condition: good · ~2,400 hrs
 *
 * Tapping "Apply as trade credit" writes a trade_valuations row and
 * updates the draft's tradeAllowance + tradeValuationId so the review
 * step picks it up without any other plumbing. This is the moonshot:
 * zero typing between seeing the machine and having a credit-able
 * number on the quote.
 *
 * States: idle → uploading → identified → valuing → valued → applying → applied
 *
 * When vision confidence is low or book-value is synthetic, we surface
 * that transparently — moonshot requires trust, not magic black boxes.
 */

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Camera,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  X,
  Pencil,
  Layers,
} from "lucide-react";
import {
  identifyEquipmentFromPhoto,
  fetchBookValueRange,
  applyPointShootTrade,
  type PointShootIdentification,
  type BookValueRange,
} from "../lib/point-shoot-trade-api";

export interface PointShootTradeCardProps {
  dealId: string | null;
  /** Called when the rep applies the trade; receives the allowance in
   *  *dollars* (matching the existing draft.tradeAllowance shape) and
   *  the trade_valuations row id. */
  onApply: (allowanceDollars: number, valuationId: string) => void;
  /** Called when the rep clears an applied trade. */
  onClear?: () => void;
  /** Currently-applied allowance (dollars) so the card can show an
   *  "applied" state if the trade was already locked in. */
  appliedAllowanceDollars?: number | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "identified"; ident: PointShootIdentification; photoPreview: string }
  | { kind: "valuing";    ident: PointShootIdentification; photoPreview: string }
  | { kind: "valued";     ident: PointShootIdentification; photoPreview: string; range: BookValueRange }
  | { kind: "applying";   ident: PointShootIdentification; photoPreview: string; range: BookValueRange }
  | { kind: "error"; message: string };

export function PointShootTradeCard({
  dealId,
  onApply,
  onClear,
  appliedAllowanceDollars,
}: PointShootTradeCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Edit-in-place for when vision gets make/model slightly wrong.
  const [edit, setEdit] = useState<{
    make: string; model: string; year: string; hours: string;
  } | null>(null);

  // Track blob URLs so we can revoke them. A rep retaking photos
  // without unmounting the card would otherwise retain one blob ref
  // per shot until the full Quote Builder page teardown.
  const blobUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const isApplied = appliedAllowanceDollars != null && appliedAllowanceDollars > 0;

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setPhase({ kind: "uploading" });
    const photoPreview = URL.createObjectURL(file);
    blobUrlsRef.current.add(photoPreview);
    try {
      const ident = await identifyEquipmentFromPhoto(file);
      if (!ident.make || !ident.model) {
        setPhase({
          kind: "error",
          message: "Couldn't identify the equipment from that photo. Try a cleaner angle of the side/decal.",
        });
        return;
      }
      setPhase({ kind: "identified", ident, photoPreview });
      // Auto-run the range lookup — saves a tap.
      await runValuation(ident, photoPreview);
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message ?? "Vision request failed." });
    }
  }

  async function runValuation(ident: PointShootIdentification, photoPreview: string) {
    setPhase({ kind: "valuing", ident, photoPreview });
    try {
      const range = await fetchBookValueRange({
        make: ident.make!,
        model: ident.model!,
        year: ident.year,
        hours: ident.hoursEstimate,
      });
      setPhase({ kind: "valued", ident, photoPreview, range });
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message ?? "Book-value lookup failed." });
    }
  }

  async function handleApply() {
    if (phase.kind !== "valued") return;
    setPhase({ kind: "applying", ident: phase.ident, photoPreview: phase.photoPreview, range: phase.range });
    try {
      const allowanceDollars = phase.range.midCents / 100;
      const result = await applyPointShootTrade({
        dealId: dealId ?? null,
        make: phase.ident.make!,
        model: phase.ident.model!,
        year: phase.ident.year,
        hours: phase.ident.hoursEstimate,
        photoUrl: phase.ident.photoUrl,
        conditionOverall: phase.ident.conditionOverall,
        bookValue: phase.range,
        allowanceDollars,
      });
      onApply(allowanceDollars, result.valuationId);
      // Collapse back to a compact "applied" summary after a successful write.
      // The parent's onApply batches with our setPhase in React 18, so the
      // applied UI shows without a flash of idle.
      blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      blobUrlsRef.current.clear();
      setPhase({ kind: "idle" });
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message ?? "Apply failed." });
    }
  }

  async function handleEditApply() {
    if (!edit || (phase.kind !== "identified" && phase.kind !== "valued")) return;
    const yearNum  = parseInt(edit.year,  10);
    const hoursNum = parseFloat(edit.hours);
    const prev = phase.kind === "valued" ? phase : phase;
    const ident: PointShootIdentification = {
      ...prev.ident,
      make:  edit.make.trim()  || prev.ident.make,
      model: edit.model.trim() || prev.ident.model,
      year:  Number.isFinite(yearNum)  && yearNum  > 1900 ? yearNum  : prev.ident.year,
      hoursEstimate: Number.isFinite(hoursNum) && hoursNum > 0 ? hoursNum : prev.ident.hoursEstimate,
    };
    setEdit(null);
    await runValuation(ident, prev.photoPreview);
  }

  function reset() {
    // Revoke any blob URLs we allocated — a fresh capture allocates a
    // new one so we don't need to keep the old.
    blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    blobUrlsRef.current.clear();
    setPhase({ kind: "idle" });
    setEdit(null);
  }

  // ── Applied state (compact) ───────────────────────────────────────────

  if (isApplied && phase.kind === "idle") {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-500">
                Trade applied
              </p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {fmtUsdCompact(appliedAllowanceDollars! * 100)} trade credit
              </p>
              <p className="text-[11px] text-muted-foreground">
                Flows into the review step as a trade allowance.
              </p>
            </div>
          </div>
          {onClear && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
      </Card>
    );
  }

  // ── Card shell + header ───────────────────────────────────────────────

  return (
    <Card className="border-qep-orange/25 bg-gradient-to-br from-qep-orange/5 to-transparent p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-qep-orange" />
          <p className="text-xs font-bold uppercase tracking-wider text-qep-orange">
            Point, Shoot, Trade
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">Moonshot</Badge>
      </div>

      {/* Idle: prompt to capture */}
      {phase.kind === "idle" && (
        <>
          <p className="text-sm text-muted-foreground">
            Snap a photo of the customer's trade — we'll identify it, pull a multi-source book-value range, and drop a trade credit into the quote.
          </p>
          <Button onClick={() => fileRef.current?.click()} className="w-full gap-2">
            <Camera className="h-4 w-4" /> Snap trade photo
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            // capture="environment" triggers the rear camera on mobile, and
            // is harmlessly ignored on desktop (just opens the file picker).
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
        </>
      )}

      {/* Uploading: vision call in flight */}
      {phase.kind === "uploading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Identifying equipment…
        </div>
      )}

      {/* Identified / Valuing / Valued — shared header + details */}
      {(phase.kind === "identified" || phase.kind === "valuing" || phase.kind === "valued" || phase.kind === "applying") && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <img
              src={phase.photoPreview}
              alt="Trade equipment"
              className="h-20 w-28 shrink-0 rounded-md object-cover ring-1 ring-border"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-foreground">
                  {[phase.ident.year, phase.ident.make, phase.ident.model].filter(Boolean).join(" ") || "Unknown"}
                </p>
                <ConfidenceBadge level={phase.ident.confidence} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {phase.ident.conditionOverall !== "unknown" && `${cap(phase.ident.conditionOverall)} condition`}
                {phase.ident.hoursEstimate != null && ` · ~${phase.ident.hoursEstimate.toLocaleString()} hrs`}
                {phase.ident.category && ` · ${phase.ident.category}`}
              </p>
              {phase.ident.potentialIssues.length > 0 && (
                <p className="mt-1 line-clamp-2 text-[11px] text-amber-600/90 dark:text-amber-300/90">
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  {phase.ident.potentialIssues.slice(0, 2).join(" · ")}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={reset} className="h-7 w-7" title="Discard">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Edit affordance for when vision's make/model is off */}
          {edit != null ? (
            <div className="rounded-lg border border-border/70 bg-background/60 p-3 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Correct identification</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <input className="rounded border border-border bg-background px-2 py-1" placeholder="Make"  value={edit.make}  onChange={(e) => setEdit({ ...edit, make: e.target.value })} />
                <input className="rounded border border-border bg-background px-2 py-1" placeholder="Model" value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} />
                <input className="rounded border border-border bg-background px-2 py-1" placeholder="Year"  value={edit.year}  onChange={(e) => setEdit({ ...edit, year: e.target.value })} />
                <input className="rounded border border-border bg-background px-2 py-1" placeholder="Hours" value={edit.hours} onChange={(e) => setEdit({ ...edit, hours: e.target.value })} />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEdit(null)}>Cancel</Button>
                <Button size="sm" onClick={handleEditApply}>Re-run valuation</Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setEdit({
                make:  phase.ident.make  ?? "",
                model: phase.ident.model ?? "",
                year:  phase.ident.year  ? String(phase.ident.year)  : "",
                hours: phase.ident.hoursEstimate ? String(phase.ident.hoursEstimate) : "",
              })}
            >
              <Pencil className="h-3 w-3" /> Correct make/model/year/hours
            </Button>
          )}

          {/* Valuing / Valued — range row */}
          {phase.kind === "valuing" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pulling book value from comps…
            </div>
          )}
          {(phase.kind === "valued" || phase.kind === "applying") && (
            <RangeDisplay range={phase.range} />
          )}

          {/* Apply button */}
          {phase.kind === "valued" && (
            <Button onClick={handleApply} className="w-full gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Apply {fmtUsdCompact(phase.range.midCents)} trade credit
            </Button>
          )}
          {phase.kind === "applying" && (
            <Button disabled className="w-full gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Applying…
            </Button>
          )}
        </div>
      )}

      {/* Error */}
      {phase.kind === "error" && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0">{phase.message}</p>
          </div>
          <Button variant="outline" size="sm" onClick={reset} className="w-full">Try again</Button>
        </div>
      )}
    </Card>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function RangeDisplay({ range }: { range: BookValueRange }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/60 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Est. trade value</p>
          <p className="mt-0.5 text-lg font-semibold text-foreground">
            {fmtUsdCompact(range.lowCents)} <span className="text-muted-foreground">–</span> {fmtUsdCompact(range.highCents)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Midpoint {fmtUsdCompact(range.midCents)} · {range.sources.length} source{range.sources.length === 1 ? "" : "s"}
          </p>
        </div>
        <ConfidenceBadge level={range.confidence} />
      </div>

      {range.isSynthetic && (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <Layers className="mt-0.5 h-3 w-3 shrink-0" />
          Live market feeds pending — sources below are modeled from make/year/hours curves. Will auto-upgrade when Iron Solutions + auction feeds connect.
        </p>
      )}

      <ul className="space-y-1 pt-1">
        {range.sources.map((s, i) => (
          <li key={i} className="flex items-center justify-between text-[12px]">
            <span className="truncate text-muted-foreground">{s.name}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">
              {s.low_cents != null && s.high_cents != null && s.low_cents !== s.high_cents
                ? `${fmtUsdCompact(s.low_cents)}–${fmtUsdCompact(s.high_cents)}`
                : fmtUsdCompact(s.value_cents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const label = cap(level);
  if (level === "high") {
    return <Badge variant="default" className="text-[10px]">{label} confidence</Badge>;
  }
  if (level === "medium") {
    return <Badge variant="secondary" className="text-[10px]">{label} confidence</Badge>;
  }
  return <Badge variant="outline" className="text-[10px]">{label} confidence</Badge>;
}

// ── Formatting ───────────────────────────────────────────────────────────

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function fmtUsdCompact(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 10_000)    return `$${Math.round(dollars / 1_000)}k`;
  if (dollars >= 1_000)     return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toLocaleString("en-US")}`;
}
