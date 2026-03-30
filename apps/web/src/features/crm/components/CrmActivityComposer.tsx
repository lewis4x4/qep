import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CrmActivityType } from "../lib/types";

interface CrmActivityComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    activityType: CrmActivityType;
    body: string;
    occurredAt: string;
  }) => Promise<void>;
  isPending: boolean;
  subjectLabel: string;
}

const ACTIVITY_OPTIONS: Array<{ value: CrmActivityType; label: string }> = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
  { value: "task", label: "Task" },
  { value: "sms", label: "SMS" },
];

export function CrmActivityComposer({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  subjectLabel,
}: CrmActivityComposerProps) {
  const [activityType, setActivityType] = useState<CrmActivityType>("call");
  const [body, setBody] = useState("");

  const canSubmit = useMemo(() => body.trim().length > 0 && !isPending, [body, isPending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    await onSubmit({
      activityType,
      body: body.trim(),
      occurredAt: new Date().toISOString(),
    });

    setBody("");
    setActivityType("call");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto w-full max-w-2xl rounded-t-2xl px-4 pb-6 pt-5 sm:px-6"
      >
        <SheetHeader className="mb-4">
          <SheetTitle>Log Activity</SheetTitle>
          <SheetDescription>
            Record an update for {subjectLabel}. Takes less than 45 seconds.
          </SheetDescription>
        </SheetHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="crm-activity-type" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
              Type
            </label>
            <select
              id="crm-activity-type"
              value={activityType}
              onChange={(event) => setActivityType(event.target.value as CrmActivityType)}
              className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
            >
              {ACTIVITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="crm-activity-body" className="mb-1.5 block text-sm font-medium text-[#0F172A]">
              Notes
            </label>
            <textarea
              id="crm-activity-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              placeholder="Key points, next steps, and customer intent"
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-sm leading-6 text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {isPending ? "Saving..." : "Save Activity"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
