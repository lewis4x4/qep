import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState<number>(0);

  return (
    <div className="inline-flex items-center gap-3 rounded-md border border-border p-3">
      <button
        type="button"
        onClick={() => setCount((value) => value - 1)}
        className="rounded border border-border px-3 py-1 text-sm"
        aria-label="Decrement counter"
      >
        -
      </button>

      <span className="min-w-8 text-center font-medium" aria-live="polite">
        {count}
      </span>

      <button
        type="button"
        onClick={() => setCount((value) => value + 1)}
        className="rounded border border-border px-3 py-1 text-sm"
        aria-label="Increment counter"
      >
        +
      </button>
    </div>
  );
}
