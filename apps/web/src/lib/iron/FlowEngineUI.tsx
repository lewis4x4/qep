/**
 * Wave 7 Iron Companion — slot-fill flow engine UI.
 *
 * Walks the active flow's slot schema one step at a time, then a Review
 * step that calls iron-execute-flow-step. On success, kicks off a 60s
 * undo toast. Renders inside a Radix Dialog (already in the repo).
 *
 * Slot type renderers:
 *   text / longtext → <input>/<textarea>
 *   number / currency → <input type="number">
 *   choice → radio buttons
 *   entity_picker → search input with debounced ironSearchEntities
 *   line_items → repeating row of {part_number, qty, unit_price}
 *   review → confirmation card with "Confirm" button (+ high-value gate)
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, X, ChevronLeft, ChevronRight, CheckCircle2, AlertOctagon, Sparkles } from "lucide-react";
import { useIronStore, computeIronFlowTotalCents } from "./store";
import { ironExecuteFlowStep, ironSearchEntities, ironBumpMemory } from "./api";
import { VoiceFillButton } from "./voice/VoiceFillButton";
import { ironSpeak, cancelIronSpeech } from "./voice/tts";
import type { IronLineItem, IronSlotDefinition } from "./types";

/**
 * Substitute ${slot_id} placeholders in voice prompt templates with the
 * matching slot value (or sensible derivations like line_count, total_display).
 * Used by the voice review prompt before passing it to TTS.
 */
function substituteVoicePromptVars(
  template: string,
  slotValues: Record<string, unknown>,
  totalCents: number,
): string {
  const lineItems = Array.isArray(slotValues.line_items) ? (slotValues.line_items as unknown[]) : [];
  const builtins: Record<string, string> = {
    line_count: String(lineItems.length),
    line_plural: lineItems.length === 1 ? "" : "s",
    total_display: totalCents > 0 ? `$${(totalCents / 100).toFixed(2)}` : "",
  };
  return template.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key: string) => {
    if (key in builtins) return builtins[key];
    const v = slotValues[key];
    if (v == null) return "";
    if (typeof v === "string" || typeof v === "number") return String(v);
    return "";
  });
}

function evaluateShowIf(
  showIf: IronSlotDefinition["show_if"],
  slots: Record<string, unknown>,
): boolean {
  if (!showIf) return true;
  const value = slots[showIf.slot_id];
  if (showIf.equals !== undefined) return value === showIf.equals;
  if (showIf.in) return showIf.in.includes(value as never);
  if (showIf.truthy) return Boolean(value);
  return true;
}

export function FlowEngineUI() {
  const store = useIronStore();
  const { activeFlow } = store.state;

  if (!activeFlow) return null;

  const meta = activeFlow.flow.iron_metadata;
  const visibleSlots = useMemo(
    () => meta.slot_schema.filter((s) => evaluateShowIf(s.show_if, activeFlow.slot_values)),
    [meta.slot_schema, activeFlow.slot_values],
  );
  const currentSlot = visibleSlots[activeFlow.current_slot_index];
  const isLast = activeFlow.current_slot_index >= visibleSlots.length - 1;

  return (
    <Dialog open onOpenChange={(open) => !open && store.cancelFlow()}>
      <DialogContent className="max-w-xl gap-3 p-0">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
            <span>{activeFlow.flow.name}</span>
            <span className="text-[10px] font-normal text-muted-foreground">
              Step {activeFlow.current_slot_index + 1} / {visibleSlots.length}
            </span>
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            {activeFlow.flow.description}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4">
          {currentSlot && currentSlot.type !== "review" && <SlotRenderer slot={currentSlot} />}
          {currentSlot?.type === "review" && <ReviewStep />}
        </div>

        {currentSlot?.type !== "review" && (
          <div className="flex items-center justify-between border-t border-border p-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => store.backSlot()}
              disabled={activeFlow.current_slot_index === 0}
            >
              <ChevronLeft className="mr-1 h-3 w-3" /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => store.cancelFlow()}>
                <X className="mr-1 h-3 w-3" /> Cancel
              </Button>
              <Button size="sm" onClick={() => store.advanceSlot()}>
                {isLast ? "Review" : "Next"} <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Slot renderers ─────────────────────────────────────────────────── */

function SlotRenderer({ slot }: { slot: IronSlotDefinition }) {
  const store = useIronStore();
  const value = store.state.activeFlow!.slot_values[slot.id];

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-foreground">
        {slot.label}
        {slot.required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {slot.helper_text && (
        <p className="text-[10px] text-muted-foreground">{slot.helper_text}</p>
      )}

      {slot.type === "text" && (
        <div className="flex items-center gap-1.5">
          <Input
            value={(value as string) ?? ""}
            onChange={(e) => store.setSlot(slot.id, e.target.value)}
            placeholder={slot.placeholder}
            className="flex-1"
          />
          <VoiceFillButton
            currentValue={(value as string) ?? ""}
            onTranscribed={(merged) => store.setSlot(slot.id, merged)}
            onError={(message) => store.setError(message)}
            ariaLabel={`Voice fill for ${slot.label}`}
          />
        </div>
      )}

      {slot.type === "longtext" && (
        <div className="flex items-start gap-1.5">
          <textarea
            value={(value as string) ?? ""}
            onChange={(e) => store.setSlot(slot.id, e.target.value)}
            placeholder={slot.placeholder}
            rows={4}
            className="w-full flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs"
          />
          <VoiceFillButton
            currentValue={(value as string) ?? ""}
            onTranscribed={(merged) => store.setSlot(slot.id, merged)}
            onError={(message) => store.setError(message)}
            ariaLabel={`Voice fill for ${slot.label}`}
          />
        </div>
      )}

      {(slot.type === "number" || slot.type === "currency") && (
        <Input
          type="number"
          value={(value as number) ?? ""}
          onChange={(e) => store.setSlot(slot.id, Number(e.target.value))}
          placeholder={slot.placeholder}
        />
      )}

      {slot.type === "choice" && slot.choices && (
        <div className="flex flex-wrap gap-2">
          {slot.choices.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => store.setSlot(slot.id, c.value)}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                value === c.value
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                  : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/30"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {slot.type === "entity_picker" && <EntityPickerSlot slot={slot} />}
      {slot.type === "line_items" && <LineItemsSlot />}
    </div>
  );
}

interface PickerResult {
  id: string;
  label: string;
  updated_at?: string;
  affinity_score?: number;
}

function EntityPickerSlot({ slot }: { slot: IronSlotDefinition }) {
  const store = useIronStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const value = store.state.activeFlow!.slot_values[slot.id] as string | undefined;

  useEffect(() => {
    if (!slot.entity_table || !slot.entity_search_column) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      ironSearchEntities({
        table: slot.entity_table!,
        search_column: slot.entity_search_column!,
        query,
        limit: 10,
      })
        .then((rows) => setResults(rows))
        .catch((err) => {
          console.warn("entity search failed", err);
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, slot.entity_table, slot.entity_search_column]);

  return (
    <div className="space-y-1.5">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={slot.placeholder ?? `Search ${slot.entity_table ?? "records"}…`}
      />
      {value && (
        <p className="text-[10px] text-muted-foreground">
          Selected id: <code className="text-foreground">{value}</code>
        </p>
      )}
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {!loading && results.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded border border-border/60">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  store.setSlot(slot.id, r.id, r.updated_at);
                  // v1.8: Iron's own picks reinforce affinity. Fire-and-forget;
                  // failures are swallowed inside ironBumpMemory because affinity
                  // is a UX layer, not a correctness invariant.
                  if (slot.entity_table) {
                    void ironBumpMemory(slot.entity_table, r.id, "iron_pick");
                  }
                  setQuery(r.label);
                  setResults([]);
                }}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/30"
              >
                <span className="truncate">{r.label}</span>
                {r.affinity_score != null && r.affinity_score > 0.05 && (
                  <span
                    className="flex shrink-0 items-center gap-0.5 text-[9px] text-qep-orange"
                    title={`Iron remembers you've touched this recently (score ${r.affinity_score.toFixed(2)})`}
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    recent
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LineItemsSlot() {
  const store = useIronStore();
  const slots = store.state.activeFlow!.slot_values;
  const items = (Array.isArray(slots.line_items) ? slots.line_items : []) as IronLineItem[];

  function update(idx: number, patch: Partial<IronLineItem>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    store.setSlot("line_items", next);
    store.setTotalCents(computeIronFlowTotalCents({ line_items: next }));
  }

  function add() {
    const next: IronLineItem[] = [...items, { part_number: "", quantity: 1, unit_price: null }];
    store.setSlot("line_items", next);
  }

  function remove(idx: number) {
    const next = items.filter((_, i) => i !== idx);
    store.setSlot("line_items", next);
    store.setTotalCents(computeIronFlowTotalCents({ line_items: next }));
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No lines yet — add one below.</p>
      )}
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <Input
            value={it.part_number}
            onChange={(e) => update(idx, { part_number: e.target.value })}
            placeholder="Part #"
            className="flex-1"
          />
          <Input
            type="number"
            min={1}
            value={it.quantity}
            onChange={(e) => update(idx, { quantity: Number(e.target.value) || 1 })}
            placeholder="Qty"
            className="w-16"
          />
          <Input
            type="number"
            step="0.01"
            value={it.unit_price ?? ""}
            onChange={(e) =>
              update(idx, { unit_price: e.target.value === "" ? null : Number(e.target.value) })
            }
            placeholder="Price"
            className="w-24"
          />
          <button
            type="button"
            onClick={() => remove(idx)}
            className="rounded p-1 text-muted-foreground hover:bg-muted/30"
            aria-label="Remove line"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={add}>
        + Add line
      </Button>
    </div>
  );
}

/* ─── Review step + execute ──────────────────────────────────────────── */

function ReviewStep() {
  const store = useIronStore();
  const af = store.state.activeFlow!;
  const meta = af.flow.iron_metadata;
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highValueInput, setHighValueInput] = useState<string>("");

  const totalCents = computeIronFlowTotalCents(af.slot_values);
  const threshold = af.flow.high_value_threshold_cents ?? 0;
  const needsHighValue = threshold > 0 && totalCents >= threshold;

  // v1.2: narrate the review prompt on mount when narration is enabled OR
  // when the user reached this flow via voice. Cancels any in-flight speech
  // first (the user shouldn't hear "Routing to iron.pull_part" overlapping
  // with the review prompt).
  useEffect(() => {
    const shouldNarrate = store.state.narrationEnabled || store.state.lastInputMode === "voice";
    if (!shouldNarrate) return;
    if (!meta.voice_review_prompt) return;
    cancelIronSpeech();
    store.setAvatar("speaking");
    const text = substituteVoicePromptVars(meta.voice_review_prompt, af.slot_values, totalCents);
    void ironSpeak(text, {
      onEnd: () => store.setAvatar("flow_active"),
      onError: () => store.setAvatar("flow_active"),
    });
    return () => {
      cancelIronSpeech();
    };
    // Intentionally only on first render of ReviewStep — re-narrating on
    // every slot edit would be obnoxious.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function execute() {
    if (submitting) return;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const res = await ironExecuteFlowStep({
        flow_id: af.flow.id,
        conversation_id: af.conversation_id,
        idempotency_key: af.idempotency_key,
        slots: af.slot_values,
        client_slot_updated_at: af.client_slot_updated_at,
        high_value_confirmation_cents: needsHighValue ? Number(highValueInput) * 100 : undefined,
      });

      if (!res.ok) {
        if (res.error === "high_value_confirmation_required") {
          setErrorMessage(res.message ?? "Please type the exact amount to confirm.");
          return;
        }
        if (res.error === "stale_entity") {
          setErrorMessage(res.message ?? "A linked record changed — please refresh.");
          return;
        }
        setErrorMessage(res.error ?? res.message ?? "Iron flow failed.");
        return;
      }

      // Success — kick off the undo toast
      store.flowSucceeded({
        run_id: res.run_id ?? "",
        flow_label: af.flow.name,
        flow_slug: af.flow.slug,
        result: res.result ?? {},
        expires_at: res.undo_deadline ? new Date(res.undo_deadline).getTime() : Date.now() + 60_000,
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Iron call failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        Ready to {meta.short_label.toLowerCase()}
      </h3>
      <div className="space-y-1 rounded border border-border/60 bg-muted/10 p-2 text-[11px]">
        {meta.slot_schema
          .filter((s) => s.type !== "review")
          .map((s) => {
            const v = af.slot_values[s.id];
            if (v == null || (Array.isArray(v) && v.length === 0)) return null;
            const display = Array.isArray(v)
              ? `${v.length} item${v.length === 1 ? "" : "s"}`
              : String(v);
            return (
              <div key={s.id} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="text-foreground">{display}</span>
              </div>
            );
          })}
        {totalCents > 0 && (
          <div className="mt-1 flex justify-between border-t border-border/60 pt-1 font-semibold">
            <span className="text-muted-foreground">Total</span>
            <span className="text-foreground">${(totalCents / 100).toFixed(2)}</span>
          </div>
        )}
      </div>

      {needsHighValue && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
          <p className="text-amber-400">
            High-value flow over ${(threshold / 100).toFixed(2)}. Type the exact amount to confirm:
          </p>
          <Input
            value={highValueInput}
            onChange={(e) => setHighValueInput(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder={(totalCents / 100).toFixed(2)}
            className="mt-1.5"
          />
        </div>
      )}

      {errorMessage && (
        <div className="flex items-start gap-1.5 rounded border border-red-500/40 bg-red-500/5 p-2 text-[11px] text-red-300">
          <AlertOctagon className="mt-0.5 h-3 w-3 shrink-0" />
          {errorMessage}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" onClick={() => store.backSlot()}>
          <ChevronLeft className="mr-1 h-3 w-3" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => store.cancelFlow()}>
            <X className="mr-1 h-3 w-3" /> Cancel
          </Button>
          <Button size="sm" disabled={submitting} onClick={execute}>
            {submitting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
