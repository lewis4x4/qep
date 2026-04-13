import { useState } from "react";
import { MapPin, Mic, Calendar, FileText, X } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { LogVisitFlow } from "./LogVisitFlow";
import { VoiceNoteCapture } from "./VoiceNoteCapture";
import { ScheduleFollowUp } from "./ScheduleFollowUp";
import { QuickNote } from "./QuickNote";

type CaptureMode = null | "log_visit" | "voice_note" | "schedule" | "quick_note";

const ACTIONS = [
  {
    key: "log_visit" as const,
    label: "Log Visit",
    icon: MapPin,
    color: "text-blue-600 bg-blue-50 border-blue-200",
  },
  {
    key: "voice_note" as const,
    label: "Voice Note",
    icon: Mic,
    color: "text-purple-600 bg-purple-50 border-purple-200",
  },
  {
    key: "schedule" as const,
    label: "Schedule Follow-Up",
    icon: Calendar,
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
  {
    key: "quick_note" as const,
    label: "Quick Note",
    icon: FileText,
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
] as const;

export function CaptureSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<CaptureMode>(null);

  function handleClose() {
    setMode(null);
    onOpenChange(false);
  }

  function handleComplete() {
    setMode(null);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl px-4 pb-8 pt-3 max-h-[90vh] overflow-y-auto"
      >
        {/* Drag handle */}
        <div className="flex justify-center mb-4">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        {mode === null ? (
          <>
            {/* Action grid — 2x2, 80px+ tall tiles */}
            <div className="grid grid-cols-2 gap-3">
              {ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.key}
                    onClick={() => setMode(action.key)}
                    className={`flex flex-col items-center justify-center gap-2 h-24 rounded-2xl border ${action.color} hover:shadow-sm active:scale-[0.98] transition-all`}
                  >
                    <Icon className="w-7 h-7" />
                    <span className="text-sm font-semibold">{action.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div>
            {/* Back button */}
            <button
              onClick={() => setMode(null)}
              className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>

            {mode === "log_visit" && (
              <LogVisitFlow onComplete={handleComplete} />
            )}
            {mode === "voice_note" && (
              <VoiceNoteCapture onComplete={handleComplete} />
            )}
            {mode === "schedule" && (
              <ScheduleFollowUp onComplete={handleComplete} />
            )}
            {mode === "quick_note" && (
              <QuickNote onComplete={handleComplete} />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
