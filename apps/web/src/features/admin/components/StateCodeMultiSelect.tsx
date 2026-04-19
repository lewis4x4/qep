import { US_STATES, type StateCode } from "../lib/us-states";

interface StateCodeMultiSelectProps {
  selected: StateCode[];
  onChange: (next: StateCode[]) => void;
  disabled?: boolean;
  /** Optional: render pills as amber when the state is in multiple zones. */
  overlapStates?: Set<StateCode>;
}

/**
 * Grid of 51 toggleable state pills. Selected = primary bg; unselected = muted;
 * overlap-flagged = amber outline. Click toggles. Keyboard-accessible via native
 * <button> elements.
 */
export function StateCodeMultiSelect({
  selected,
  onChange,
  disabled,
  overlapStates,
}: StateCodeMultiSelectProps) {
  const selectedSet = new Set(selected);

  function toggle(code: StateCode) {
    if (disabled) return;
    if (selectedSet.has(code)) {
      onChange(selected.filter((c) => c !== code));
    } else {
      onChange([...selected, code].sort());
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {US_STATES.map((state) => {
        const isSelected = selectedSet.has(state.code);
        const isOverlap = overlapStates?.has(state.code);
        return (
          <button
            key={state.code}
            type="button"
            onClick={() => toggle(state.code)}
            disabled={disabled}
            title={state.name}
            aria-pressed={isSelected}
            className={[
              "min-w-[2.5rem] px-2 py-1 text-xs font-medium rounded border transition-colors",
              isSelected
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-foreground border-border hover:bg-muted",
              isOverlap ? "ring-2 ring-warning" : "",
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            {state.code}
          </button>
        );
      })}
    </div>
  );
}
