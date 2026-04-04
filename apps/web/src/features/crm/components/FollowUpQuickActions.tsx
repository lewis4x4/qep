import { Button } from "@/components/ui/button";

export function FollowUpQuickActions({
  isPending,
  errorMessage,
  compact = false,
  onSetFollowUp,
}: {
  isPending: boolean;
  errorMessage: string | null;
  compact?: boolean;
  onSetFollowUp: (daysAhead: number) => void;
}) {
  const options = [
    { daysAhead: 1, label: "Tomorrow" },
    { daysAhead: 3, label: "3 Days" },
    { daysAhead: 7, label: "1 Week" },
  ];

  return (
    <div className="space-y-2">
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "justify-start" : ""}`}>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Set follow-up</span>
        {options.map((option) => (
          <Button
            key={option.daysAhead}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] px-3 text-xs"
            disabled={isPending}
            onClick={() => onSetFollowUp(option.daysAhead)}
          >
            {isPending ? "Saving..." : option.label}
          </Button>
        ))}
      </div>
      {errorMessage && (
        <p className="text-xs text-destructive" role="status" aria-live="polite">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
