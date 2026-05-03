/**
 * DecisionRoomArchetypeOverride — rep-authored reclassify control for a
 * named seat.
 *
 * The seat map infers archetype from title keywords, but inference is
 * lossy: "General Superintendent" pins to Machine Operator when the
 * actual person is this deal's champion. This control lets the rep
 * tell the system what they know. The override persists on
 * `crm_contacts.metadata.decision_room_override.archetype`; the seat
 * inferencer (decision-room-archetype::inferArchetypeForContact) treats
 * it as absolute truth on the next board rebuild.
 *
 * Persistence is read-modify-write because supabase-js can't express a
 * jsonb `||` merge. Rep-initiated, low-frequency — race risk acceptable.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, PencilLine, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { ARCHETYPE_DEFS } from "../lib/decision-room-archetype";
import type { SeatArchetype } from "../lib/decision-room-archetype";

interface Props {
  /** Seat id, shape `contact:<uuid>`. Non-contact ids are ignored. */
  seatId: string;
  /** Current inferred (or previously-overridden) archetype. */
  currentArchetype: SeatArchetype;
  /** Label currently shown for this seat — used in the confirmation toast. */
  currentLabel: string;
  /** Deal id so we can invalidate the right relationship query on save. */
  dealId: string;
}

function parseContactId(seatId: string): string | null {
  const [prefix, id] = seatId.split(":");
  return prefix === "contact" && id ? id : null;
}

const ARCHETYPE_OPTIONS: SeatArchetype[] = [
  "champion",
  "economic_buyer",
  "operations",
  "procurement",
  "operator",
  "maintenance",
  "executive_sponsor",
];

const ARCHETYPE_OPTION_SET = new Set<string>(ARCHETYPE_OPTIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSeatArchetype(value: string): SeatArchetype | null {
  if (!ARCHETYPE_OPTION_SET.has(value)) return null;
  return ARCHETYPE_OPTIONS.find((option) => option === value) ?? null;
}

export function DecisionRoomArchetypeOverride({
  seatId,
  currentArchetype,
  currentLabel,
  dealId,
}: Props) {
  const contactId = parseContactId(seatId);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<SeatArchetype>(currentArchetype);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (!contactId) return null;

  async function handleSave() {
    if (!contactId || saving || selected === currentArchetype) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      // Read-modify-write: supabase-js can't do a jsonb `||` merge, so we
      // pull current metadata, spread, and persist the patched object.
      const { data: row, error: readErr } = await supabase
        .from("crm_contacts")
        .select("metadata")
        .eq("id", contactId)
        .maybeSingle();
      if (readErr) throw readErr;
      const prev = isRecord(row?.metadata) ? row.metadata : {};
      const previousOverride = isRecord(prev.decision_room_override)
        ? prev.decision_room_override
        : {};
      const patched = {
        ...prev,
        decision_room_override: {
          ...previousOverride,
          archetype: selected,
          set_at: new Date().toISOString(),
        },
      };
      const { error: writeErr } = await supabase
        .from("crm_contacts")
        .update({ metadata: patched })
        .eq("id", contactId);
      if (writeErr) throw writeErr;

      toast({
        title: "Seat reclassified",
        description: `${currentLabel} → ${ARCHETYPE_DEFS[selected].label}. Coach will re-read with the new shape.`,
      });
      // The seat map reads from the relationship query; invalidate it so
      // the new archetype + downstream coach read pick up the change.
      await queryClient.invalidateQueries({
        queryKey: ["decision-room-simulator", dealId, "relationship"],
        refetchType: "active",
      });
      setEditing(false);
    } catch (err) {
      toast({
        title: "Couldn't reclassify seat",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setSelected(currentArchetype);
          setEditing(true);
        }}
        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition hover:border-qep-orange/40 hover:text-qep-orange"
        aria-label="Reclassify this seat"
      >
        <PencilLine className="h-3 w-3" />
        Reclassify
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-qep-orange/30 bg-qep-orange/5 p-1.5">
      <label className="sr-only" htmlFor={`archetype-override-${contactId}`}>
        Archetype
      </label>
      <select
        id={`archetype-override-${contactId}`}
        value={selected}
        onChange={(e) => {
          const next = parseSeatArchetype(e.target.value);
          if (next) setSelected(next);
        }}
        disabled={saving}
        className="h-7 rounded-md border border-white/15 bg-black/40 px-2 text-[11px] text-foreground focus:border-qep-orange focus:outline-none"
      >
        {ARCHETYPE_OPTIONS.map((a) => (
          <option key={a} value={a}>
            {ARCHETYPE_DEFS[a].label}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={saving}
        onClick={handleSave}
        className="h-7 gap-1 px-2 text-[11px]"
      >
        {saving ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving
          </>
        ) : (
          <>
            <Check className="h-3 w-3" />
            Save
          </>
        )}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={saving}
        onClick={() => setEditing(false)}
        className="h-7 gap-1 px-2 text-[11px]"
      >
        <X className="h-3 w-3" />
        Cancel
      </Button>
    </div>
  );
}
