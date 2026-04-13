import { useState } from "react";
import {
  MapPin,
  Mic,
  Calendar,
  FileText,
  X,
  Flame,
  Wrench,
  AlertCircle,
  Truck,
  Search,
  Check,
  Package,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { LogVisitFlow } from "./LogVisitFlow";
import { VoiceNoteCapture } from "./VoiceNoteCapture";
import { ScheduleFollowUp } from "./ScheduleFollowUp";
import { QuickNote } from "./QuickNote";
import { fetchRepCustomers } from "../lib/sales-api";
import { cn } from "@/lib/utils";

type CaptureMode =
  | null
  | "log_visit"
  | "voice_note"
  | "schedule"
  | "quick_note";

/* ── Tag chip config ────────────────────────────────────── */
const TAGS = [
  { key: "hot", label: "Hot Lead", icon: Flame, activeColor: "text-red-400 border-red-400 bg-red-500/10" },
  { key: "quote", label: "Quote Request", icon: FileText, activeColor: "text-blue-400 border-blue-400 bg-blue-500/10" },
  { key: "service", label: "Service Issue", icon: Wrench, activeColor: "text-amber-400 border-amber-400 bg-amber-500/10" },
  { key: "competitor", label: "Competitor Intel", icon: AlertCircle, activeColor: "text-purple-400 border-purple-400 bg-purple-500/10" },
  { key: "trade", label: "Trade-In", icon: Truck, activeColor: "text-emerald-400 border-emerald-400 bg-emerald-500/10" },
  { key: "meeting", label: "Meeting Note", icon: Calendar, activeColor: "text-muted-foreground border-muted-foreground/40 bg-foreground/5" },
] as const;

/* ── Alternate actions ──────────────────────────────────── */
const ALT_ACTIONS = [
  { key: "log_visit" as const, icon: MapPin, label: "Log Visit", desc: "GPS + notes", iconBg: "bg-blue-500/10", iconColor: "text-blue-400" },
  { key: "schedule" as const, icon: Calendar, label: "Schedule", desc: "Follow-up", iconBg: "bg-emerald-500/10", iconColor: "text-emerald-400" },
  { key: "quick_note" as const, icon: FileText, label: "Quick Note", desc: "Text capture", iconBg: "bg-amber-500/10", iconColor: "text-amber-400" },
  { key: "new_quote" as const, icon: Package, label: "New Quote", desc: "Start builder", iconBg: "bg-purple-500/10", iconColor: "text-purple-400" },
] as const;

/* ── Customer avatar ────────────────────────────────────── */
function MiniAvatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className="rounded-full bg-gradient-to-br from-qep-orange/80 to-qep-orange flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <span className="text-white font-bold" style={{ fontSize: size * 0.38 }}>
        {initials}
      </span>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */
export function CaptureSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<CaptureMode>(null);
  const [recording, setRecording] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Fetch top customers for quick-attach pills
  const { data: customers } = useQuery({
    queryKey: ["sales", "customers"],
    queryFn: fetchRepCustomers,
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });
  const quickCustomers = (customers ?? []).slice(0, 5);

  function handleClose() {
    setMode(null);
    setRecording(false);
    setSelectedCustomer(null);
    setSelectedTag(null);
    onOpenChange(false);
  }

  function handleComplete() {
    setMode(null);
    setRecording(false);
    setSelectedCustomer(null);
    setSelectedTag(null);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[22px] px-0 pb-6 pt-0 max-h-[90vh] overflow-y-auto bg-[hsl(var(--card))] border-t border-white/[0.08]"
        style={{ boxShadow: "0 -12px 40px rgba(0,0,0,0.6)" }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1.5">
          <div className="w-10 h-1 rounded-full bg-white/[0.12]" />
        </div>

        {mode === null ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-4 pt-2">
              <div>
                <h2 className="text-lg font-extrabold text-foreground tracking-[-0.01em]">
                  Quick Capture
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tap to record. Iron handles the rest.
                </p>
              </div>
              <button
                onClick={handleClose}
                className="w-[34px] h-[34px] rounded-[10px] border border-white/[0.06] bg-[hsl(var(--card))] flex items-center justify-center hover:border-white/20 transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Voice Hero */}
            <div className="px-5 pb-4">
              <button
                onClick={() => {
                  if (recording) {
                    setRecording(false);
                    setMode("voice_note");
                  } else {
                    setRecording(true);
                  }
                }}
                className="w-full rounded-[18px] border-none cursor-pointer flex items-center gap-4 text-left transition-all duration-200 active:scale-[0.99]"
                style={{
                  padding: "20px 18px",
                  background: recording
                    ? "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)"
                    : "linear-gradient(135deg, #E87722 0%, #FF8A3D 100%)",
                  boxShadow: recording
                    ? "0 12px 30px rgba(239,68,68,0.4)"
                    : "0 12px 30px rgba(232,119,34,0.25)",
                }}
              >
                {/* Mic circle */}
                <div className="relative w-[60px] h-[60px] rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  {recording && (
                    <div className="absolute -inset-1 rounded-full border-2 border-white/50 animate-ping" />
                  )}
                  <Mic className="w-7 h-7 text-white" strokeWidth={2.5} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className="text-[17px] font-extrabold text-white tracking-[-0.01em]">
                    {recording ? "Recording..." : "Hold to record"}
                  </p>
                  <p className="text-xs text-white/85 mt-0.5 font-medium">
                    {recording
                      ? "Release to transcribe"
                      : "Iron auto-extracts deals, contacts, follow-ups"}
                  </p>
                </div>

                {/* AI badge */}
                <span className="px-2.5 py-1 rounded-[20px] bg-white/20 text-[10px] font-extrabold text-white uppercase tracking-[0.06em]">
                  {recording ? "LIVE" : "AI"}
                </span>
              </button>
            </div>

            {/* Attach to Customer */}
            {quickCustomers.length > 0 && (
              <div className="px-5 pb-3.5">
                <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">
                  Attach to Customer
                </p>
                <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
                  {quickCustomers.map((c) => {
                    const active = selectedCustomer === c.customer_id;
                    return (
                      <button
                        key={c.customer_id}
                        onClick={() =>
                          setSelectedCustomer(active ? null : c.customer_id)
                        }
                        className={cn(
                          "shrink-0 flex items-center gap-2 py-2 pl-2 pr-3 rounded-full border transition-all duration-150",
                          active
                            ? "border-qep-orange bg-qep-orange/10"
                            : "border-white/[0.06] bg-[hsl(var(--card))]",
                        )}
                      >
                        <MiniAvatar name={c.company_name} />
                        <span
                          className={cn(
                            "text-xs font-bold whitespace-nowrap",
                            active ? "text-qep-orange" : "text-foreground",
                          )}
                        >
                          {c.company_name.split(" ").slice(0, 2).join(" ")}
                        </span>
                        {active && (
                          <Check className="w-[13px] h-[13px] text-qep-orange" />
                        )}
                      </button>
                    );
                  })}
                  <button className="shrink-0 flex items-center gap-1.5 py-2 px-3 rounded-full border border-dashed border-white/[0.12] text-muted-foreground text-xs font-semibold">
                    <Search className="w-3 h-3" />
                    Find customer
                  </button>
                </div>
              </div>
            )}

            {/* Tag This Capture */}
            <div className="px-5 pb-3.5">
              <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">
                Tag This Capture
              </p>
              <div className="flex flex-wrap gap-1.5">
                {TAGS.map((t) => {
                  const Icon = t.icon;
                  const active = selectedTag === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() =>
                        setSelectedTag(active ? null : t.key)
                      }
                      className={cn(
                        "flex items-center gap-1.5 px-[11px] py-[7px] rounded-full border text-xs font-bold transition-all duration-150",
                        active
                          ? t.activeColor
                          : "border-white/[0.06] bg-[hsl(var(--card))] text-foreground",
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-3 h-3",
                          active ? "" : "text-muted-foreground",
                        )}
                      />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Or Capture Another Way */}
            <div className="px-5 pb-3">
              <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">
                Or Capture Another Way
              </p>
              <div className="grid grid-cols-4 gap-2">
                {ALT_ACTIONS.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.key}
                      onClick={() => {
                        if (a.key === "new_quote") {
                          // Could navigate to quote builder
                          handleClose();
                        } else {
                          setMode(a.key);
                        }
                      }}
                      className="flex flex-col items-center gap-1.5 py-3.5 px-1.5 rounded-[14px] border border-white/[0.06] bg-[hsl(var(--card))] hover:border-white/20 transition-all active:scale-[0.98]"
                    >
                      <div
                        className={`w-9 h-9 rounded-[10px] ${a.iconBg} flex items-center justify-center`}
                      >
                        <Icon
                          className={`w-[17px] h-[17px] ${a.iconColor}`}
                          strokeWidth={2.2}
                        />
                      </div>
                      <span className="text-[11px] font-bold text-foreground text-center leading-tight">
                        {a.label}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60 text-center -mt-0.5">
                        {a.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recent Captures — static for now, will wire to real data */}
            <div className="mx-5 pt-2 mt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em]">
                  Recent Captures
                </p>
                <button className="text-[11px] text-qep-orange font-bold">
                  View all
                </button>
              </div>

              {quickCustomers.length > 0 && (
                <div className="space-y-0">
                  {quickCustomers.slice(0, 2).map((c, i) => (
                    <div
                      key={c.customer_id}
                      className={`flex items-center gap-2.5 py-2.5 ${
                        i === 0 ? "border-b border-white/[0.06]" : ""
                      }`}
                    >
                      <div className="w-8 h-8 rounded-[9px] bg-qep-orange/10 flex items-center justify-center shrink-0">
                        {i === 0 ? (
                          <Mic className="w-3.5 h-3.5 text-qep-orange" />
                        ) : (
                          <MapPin className="w-3.5 h-3.5 text-blue-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-foreground">
                          {c.company_name}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {i === 0 ? "Voice note" : "Visit logged"}
                          {c.last_interaction
                            ? ` · ${c.last_interaction}`
                            : ""}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground/60 shrink-0">
                        {c.days_since_contact != null
                          ? `${c.days_since_contact}d ago`
                          : "Recently"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="px-5">
            {/* Back button */}
            <button
              onClick={() => setMode(null)}
              className="flex items-center gap-1 text-sm text-qep-orange font-semibold mb-4 mt-2"
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
